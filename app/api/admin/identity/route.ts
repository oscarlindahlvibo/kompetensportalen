import { eq } from "drizzle-orm";
import { getDb } from "@/db";
import {
  auditLogs,
  courses,
  enrollments,
  identityVerifications,
  profiles,
} from "@/db/schema";
import { identityDataIsReadyForId06 } from "@/lib/platform";
import { ensureDbUser, requireMutationIdentity, requirePermission, requestMetadata } from "@/lib/server-auth";
import { CertificationError, issueCertificateForEnrollment } from "@/lib/certification";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const identity = await requireMutationIdentity(request);
  if (identity instanceof Response) return identity;
  const db = getDb();
  const actor = await ensureDbUser(db, identity);
  requirePermission(actor.role, "certification:write");
  const body = (await request.json()) as {
    enrollmentId?: string;
    status?: "identity_pending" | "identity_verified" | "rejected";
    reference?: string;
    notes?: string;
  };
  if (!body.enrollmentId || !body.status)
    return Response.json({ error: "enrollment_and_status_required" }, { status: 400 });
  if (!["identity_pending", "identity_verified", "rejected"].includes(body.status))
    return Response.json({ error: "invalid_identity_status" }, { status: 400 });
  if (body.reference !== undefined && body.reference.length > 200)
    return Response.json({ error: "identity_reference_too_long" }, { status: 400 });
  if (body.notes !== undefined && body.notes.length > 5000)
    return Response.json({ error: "identity_notes_too_long" }, { status: 400 });

  const row = (
    await db
      .select({ enrollment: enrollments, course: courses })
      .from(enrollments)
      .innerJoin(courses, eq(courses.id, enrollments.courseId))
      .where(eq(enrollments.id, body.enrollmentId))
      .limit(1)
  )[0];
  if (!row) return Response.json({ error: "enrollment_not_found" }, { status: 404 });

  if (body.status === "identity_verified" && row.course.id06Enabled) {
    const profile = (
      await db
        .select({ personalIdentityEncrypted: profiles.personalIdentityEncrypted })
        .from(profiles)
        .where(eq(profiles.userId, row.enrollment.userId))
        .limit(1)
    )[0];
    if (!identityDataIsReadyForId06(profile))
      return Response.json({ error: "personal_identity_required" }, { status: 409 });
  }

  const current = (
    await db
      .select()
      .from(identityVerifications)
      .where(eq(identityVerifications.enrollmentId, body.enrollmentId))
      .limit(1)
  )[0];
  const verification = current ?? {
    id: crypto.randomUUID(),
    userId: row.enrollment.userId,
    enrollmentId: row.enrollment.id,
    status: "identity_pending" as const,
    method: "admin_check" as const,
    reference: null,
    verifiedByUserId: null,
    verifiedAt: null,
    notes: null,
  };
  if (!current) await db.insert(identityVerifications).values(verification);
  await db
    .update(identityVerifications)
    .set({
      status: body.status,
      method: current?.method ?? "admin_check",
      reference: body.reference?.trim() || null,
      notes: body.notes?.trim() || null,
      verifiedAt: body.status === "identity_verified" ? new Date().toISOString() : null,
      verifiedByUserId: body.status === "identity_verified" ? actor.id : null,
      updatedAt: new Date().toISOString(),
    })
    .where(eq(identityVerifications.id, verification.id));
  let certificate: unknown = null;
  if (body.status === "identity_verified") {
    try {
      certificate = (await issueCertificateForEnrollment(db, row.enrollment.id, actor.id)).certificate;
    } catch (error) {
      // Verification may be approved before the participant has passed the exam.
      if (!(error instanceof CertificationError) || error.status >= 500) throw error;
    }
  }
  const metadata = await requestMetadata();
  await db.insert(auditLogs).values({
    id: crypto.randomUUID(),
    actorUserId: actor.id,
    targetType: "identity_verification",
    targetId: verification.id,
    action: current ? "status_changed" : "verification_created",
    beforeJson: current ? JSON.stringify({ status: current.status }) : null,
    afterJson: JSON.stringify({ status: body.status, enrollmentId: row.enrollment.id }),
    ipHash: metadata.ip,
    userAgent: metadata.userAgent,
  });
  return Response.json({ ok: true, verificationId: verification.id, status: body.status, certificate });
}
