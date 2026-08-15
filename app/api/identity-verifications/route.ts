import { and, eq } from "drizzle-orm";
import { getDb } from "@/db";
import { auditLogs, enrollments, identityVerifications } from "@/db/schema";
import { ensureDbUser, requireApiIdentity } from "@/lib/server-auth";
import { enrollmentIsAccessible } from "@/lib/platform";
import { configuredBankIdAdapter } from "@/lib/integrations";
import { sameOriginGuard } from "@/lib/request-security";
import { rateLimit } from "@/lib/rate-limit";
import { runtimeEnv } from "@/lib/runtime-env";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const originError = sameOriginGuard(request);
  if (originError) return originError;
  const limited = rateLimit(request, "identity-verification-start", 10);
  if (limited) return limited;
  const identity = await requireApiIdentity();
  if (identity instanceof Response) return identity;
  const body = (await request.json()) as {
    enrollmentId?: string;
    method?: "manual_bankid_document" | "bankid";
  };
  if (!body.enrollmentId)
    return Response.json({ error: "enrollment_required" }, { status: 400 });
  if (
    body.method === "bankid" &&
    !configuredBankIdAdapter(
      runtimeEnv() as Record<string, string | undefined>,
    )
  )
    return Response.json({ error: "bankid_not_configured" }, { status: 503 });
  const db = getDb();
  const user = await ensureDbUser(db, identity);
  const enrollment = (
    await db
      .select()
      .from(enrollments)
      .where(
        and(
          eq(enrollments.id, body.enrollmentId),
          eq(enrollments.userId, user.id),
        ),
      )
      .limit(1)
  )[0];
  if (!enrollment)
    return Response.json({ error: "enrollment_not_found" }, { status: 404 });
  if (!enrollmentIsAccessible(enrollment))
    return Response.json({ error: "enrollment_inactive" }, { status: 409 });
  const current = (
    await db
      .select()
      .from(identityVerifications)
      .where(
        and(
          eq(identityVerifications.enrollmentId, enrollment.id),
          eq(identityVerifications.userId, user.id),
        ),
      )
      .limit(1)
  )[0];
  if (current)
    return Response.json({ verification: current, idempotent: true });
  const verification = {
    id: crypto.randomUUID(),
    userId: user.id,
    enrollmentId: enrollment.id,
    status: "identity_pending" as const,
    method: body.method ?? ("manual_bankid_document" as const),
    reference: null,
    notes: null,
  };
  await db.insert(identityVerifications).values(verification);
  let bankid: { orderRef: string; autoStartToken?: string } | undefined;
  if (verification.method === "bankid") {
    try {
      bankid = await configuredBankIdAdapter(
        runtimeEnv() as Record<string, string | undefined>,
      )!.startVerification({ userId: user.id, enrollmentId: enrollment.id });
      await db
        .update(identityVerifications)
        .set({
          reference: bankid.orderRef,
          updatedAt: new Date().toISOString(),
        })
        .where(eq(identityVerifications.id, verification.id));
    } catch {
      await db
        .update(identityVerifications)
        .set({
          status: "rejected",
          notes: "BankID-provider kunde inte starta verifieringen.",
          updatedAt: new Date().toISOString(),
        })
        .where(eq(identityVerifications.id, verification.id));
      return Response.json({ error: "bankid_start_failed" }, { status: 502 });
    }
  }
  await db
    .insert(auditLogs)
    .values({
      id: crypto.randomUUID(),
      actorUserId: user.id,
      targetType: "identity_verification",
      targetId: verification.id,
      action: "verification_requested",
      beforeJson: null,
      afterJson: JSON.stringify({
        enrollmentId: enrollment.id,
        method: verification.method,
      }),
      ipHash: null,
      userAgent: null,
    });
  return Response.json(
    {
      verification: { ...verification, reference: bankid?.orderRef ?? null },
      bankid,
    },
    { status: 201 },
  );
}
