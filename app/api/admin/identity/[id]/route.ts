import { eq } from "drizzle-orm";
import { getDb } from "@/db";
import {
  auditLogs,
  courses,
  enrollments,
  identityVerifications,
  profiles,
  users,
} from "@/db/schema";
import { requireMutationIdentity, requirePermission } from "@/lib/server-auth";
import { identityDataIsReadyForId06 } from "@/lib/platform";
import { CertificationError, issueCertificateForEnrollment } from "@/lib/certification";

export const dynamic = "force-dynamic";

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const identity = await requireMutationIdentity(request);
  if (identity instanceof Response) return identity;
  const { id } = await context.params;
  const body = (await request.json()) as {
    status?: "identity_pending" | "identity_verified" | "rejected";
    reference?: string;
    notes?: string;
  };
  if (!body.status)
    return Response.json({ error: "status_required" }, { status: 400 });
  const db = getDb();
  const admins = await db
    .select()
    .from(users)
    .where(eq(users.email, identity.email))
    .limit(1);
  requirePermission(
    (admins[0]?.role ?? "participant") as Parameters<
      typeof requirePermission
    >[0],
    "certification:write",
  );
  const current = (
    await db
      .select()
      .from(identityVerifications)
      .where(eq(identityVerifications.id, id))
      .limit(1)
  )[0];
  if (!current)
    return Response.json(
      { error: "identity_verification_not_found" },
      { status: 404 },
    );
  if (body.status === "identity_verified") {
    if (!current.enrollmentId)
      return Response.json({ error: "enrollment_required" }, { status: 409 });
    const enrollmentRow = (
      await db
        .select({ enrollment: enrollments, course: courses })
        .from(enrollments)
        .innerJoin(courses, eq(courses.id, enrollments.courseId))
        .where(eq(enrollments.id, current.enrollmentId))
        .limit(1)
    )[0];
    if (enrollmentRow?.course.id06Enabled) {
      const profile = (
        await db
          .select({
            personalIdentityEncrypted: profiles.personalIdentityEncrypted,
          })
          .from(profiles)
          .where(eq(profiles.userId, enrollmentRow.enrollment.userId))
          .limit(1)
      )[0];
      if (!identityDataIsReadyForId06(profile))
        return Response.json(
          { error: "personal_identity_required" },
          { status: 409 },
        );
    }
  }
  await db
    .update(identityVerifications)
    .set({
      status: body.status,
      reference: body.reference ?? current.reference,
      notes: body.notes ?? current.notes,
      verifiedAt:
        body.status === "identity_verified" ? new Date().toISOString() : null,
      verifiedByUserId:
        body.status === "identity_verified" ? (admins[0]?.id ?? null) : null,
    })
    .where(eq(identityVerifications.id, id));
  let certificate: unknown = null;
  if (body.status === "identity_verified" && current.enrollmentId) {
    try {
      certificate = (await issueCertificateForEnrollment(db, current.enrollmentId, admins[0]?.id ?? null)).certificate;
    } catch (error) {
      // Identity approval can legitimately precede the exam or required lessons.
      if (!(error instanceof CertificationError) || error.status >= 500) throw error;
    }
  }
  await db
    .insert(auditLogs)
    .values({
      id: crypto.randomUUID(),
      actorUserId: admins[0]?.id ?? null,
      targetType: "identity_verification",
      targetId: id,
      action: "status_changed",
      beforeJson: JSON.stringify({ status: current.status }),
      afterJson: JSON.stringify({ status: body.status }),
      ipHash: null,
      userAgent: null,
    });
  return Response.json({ ok: true, status: body.status, certificate });
}
