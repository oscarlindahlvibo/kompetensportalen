import { and, eq } from "drizzle-orm";
import { getDb } from "@/db";
import { auditLogs, identityVerifications, profiles } from "@/db/schema";
import { bankIdResultIsVerified, configuredBankIdAdapter } from "@/lib/integrations";
import { decryptPersonalIdentity, encryptPersonalIdentity, normalizePersonalIdentity } from "@/lib/pii";
import { ensureDbUser, requireApiIdentity } from "@/lib/server-auth";
import { sameOriginGuard } from "@/lib/request-security";
import { CertificationError, issueCertificateForEnrollment } from "@/lib/certification";
import { rateLimit } from "@/lib/rate-limit";
import { runtimeEnv } from "@/lib/runtime-env";

export const dynamic = "force-dynamic";

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const originError = sameOriginGuard(request);
  if (originError) return originError;
  const limited = rateLimit(request, "identity-verification-collect", 30);
  if (limited) return limited;
  const identity = await requireApiIdentity();
  if (identity instanceof Response) return identity;
  const { id } = await context.params;
  const db = getDb();
  const user = await ensureDbUser(db, identity);
  const current = (
    await db
      .select()
      .from(identityVerifications)
      .where(
        and(
          eq(identityVerifications.id, id),
          eq(identityVerifications.userId, user.id),
        ),
      )
      .limit(1)
  )[0];
  if (!current)
    return Response.json(
      { error: "identity_verification_not_found" },
      { status: 404 },
    );
  if (current.method !== "bankid")
    return Response.json(
      { error: "bankid_verification_required" },
      { status: 409 },
    );
  if (current.status !== "identity_pending" || !current.reference)
    return Response.json(
      { error: "identity_verification_not_pending" },
      { status: 409 },
    );
  const adapter = configuredBankIdAdapter(
    runtimeEnv() as Record<string, string | undefined>,
  );
  if (!adapter)
    return Response.json({ error: "bankid_not_configured" }, { status: 503 });
  let result;
  try {
    result = await adapter.collectVerification(current.reference);
  } catch {
    return Response.json({ error: "bankid_collect_failed" }, { status: 502 });
  }
  if (result.status === "pending")
    return Response.json({
      status: "identity_pending",
      providerStatus: "pending",
    });
  if (result.status === "failed") {
    await db
      .update(identityVerifications)
      .set({
        status: "rejected",
        notes: "BankID-verifieringen misslyckades.",
        updatedAt: new Date().toISOString(),
      })
      .where(eq(identityVerifications.id, id));
    await db
      .insert(auditLogs)
      .values({
        id: crypto.randomUUID(),
        actorUserId: user.id,
        targetType: "identity_verification",
        targetId: id,
        action: "bankid_failed",
        beforeJson: JSON.stringify({ status: current.status }),
        afterJson: JSON.stringify({ status: "rejected" }),
        ipHash: null,
        userAgent: null,
      });
    return Response.json({ status: "rejected" });
  }
  if (!bankIdResultIsVerified(result))
    return Response.json(
      { error: "bankid_personal_identity_missing" },
      { status: 409 },
    );
  let personalIdentity: string;
  try {
    personalIdentity = normalizePersonalIdentity(result.personalNumber!);
  } catch {
    return Response.json(
      { error: "bankid_personal_identity_invalid" },
      { status: 502 },
    );
  }
  const currentProfile = (
    await db
      .select()
      .from(profiles)
      .where(eq(profiles.userId, user.id))
      .limit(1)
  )[0];
  if (currentProfile?.personalIdentityEncrypted) {
    let existingIdentity: string;
    try {
      existingIdentity = (await decryptPersonalIdentity(
        currentProfile.personalIdentityEncrypted,
      )) ?? "";
    } catch {
      return Response.json({ error: "stored_identity_unreadable" }, { status: 409 });
    }
    if (existingIdentity !== personalIdentity)
      return Response.json({ error: "bankid_identity_mismatch" }, { status: 409 });
  }
  const encrypted = await encryptPersonalIdentity(personalIdentity);
  const nameParts = (result.fullName ?? "").trim().split(/\s+/).filter(Boolean);
  const firstName: string = nameParts[0] ?? currentProfile?.firstName ?? "";
  const lastName: string =
    nameParts.slice(1).join(" ") || currentProfile?.lastName || "";
  if (currentProfile) {
    await db
      .update(profiles)
      .set({
        personalIdentityEncrypted: encrypted,
        identityLast4: personalIdentity.slice(-4),
        ...(result.fullName ? { firstName, lastName } : {}),
        updatedAt: new Date().toISOString(),
      })
      .where(eq(profiles.userId, user.id));
  } else {
    await db
      .insert(profiles)
      .values({
        userId: user.id,
        firstName,
        lastName,
        personalIdentityEncrypted: encrypted,
        identityLast4: personalIdentity.slice(-4),
      });
  }
  await db
    .update(identityVerifications)
    .set({
      status: "identity_verified",
      verifiedAt: new Date().toISOString(),
      reference: result.reference ?? current.reference,
      notes: "Verifierad via BankID-adapter.",
      updatedAt: new Date().toISOString(),
    })
    .where(eq(identityVerifications.id, id));
  let certificate: unknown = null;
  if (current.enrollmentId) {
    try {
      certificate = (await issueCertificateForEnrollment(db, current.enrollmentId, user.id)).certificate;
    } catch (error) {
      // BankID may complete before the participant has passed the exam.
      if (!(error instanceof CertificationError) || error.status >= 500) throw error;
    }
  }
  await db
    .insert(auditLogs)
    .values({
      id: crypto.randomUUID(),
      actorUserId: user.id,
      targetType: "identity_verification",
      targetId: id,
      action: "bankid_verified",
      beforeJson: JSON.stringify({ status: current.status }),
      afterJson: JSON.stringify({
        status: "identity_verified",
        identityLast4: personalIdentity.slice(-4),
      }),
      ipHash: null,
      userAgent: null,
    });
  return Response.json({
    status: "identity_verified",
    identityLast4: personalIdentity.slice(-4),
    certificate,
  });
}
