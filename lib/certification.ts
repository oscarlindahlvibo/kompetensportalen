import { and, eq } from "drizzle-orm";
import {
  auditLogs,
  certificates,
  chapters,
  competencies,
  courses,
  enrollments,
  examAttempts,
  identityVerifications,
  id06Registrations,
  lessonProgress,
  lessons,
  profiles,
} from "@/db/schema";
import { getDb } from "@/db";
import {
  enrollmentIsAccessible,
  courseNeedsIdentityVerification,
  hasCompletedRequiredLessons,
  identityDataIsReadyForId06,
} from "@/lib/platform";
import { addMonthsIso } from "@/lib/order-fulfillment";
import { queueTemplatedNotification } from "@/lib/notifications";

type Database = ReturnType<typeof getDb>;

export class CertificationError extends Error {
  constructor(public readonly code: string, public readonly status = 409) {
    super(code);
  }
}

/**
 * Issues the certificate only when the enrollment's immutable version has
 * passed every required lesson, examination and identity requirement.
 * The enrollment unique constraint makes retries safe.
 */
export async function issueCertificateForEnrollment(
  db: Database,
  enrollmentId: string,
  actorUserId: string | null = null,
  metadata: { ipHash?: string | null; userAgent?: string | null } = {},
) {
  const row = (
    await db
      .select({ enrollment: enrollments, course: courses })
      .from(enrollments)
      .innerJoin(courses, eq(courses.id, enrollments.courseId))
      .where(eq(enrollments.id, enrollmentId))
      .limit(1)
  )[0];
  if (!row) throw new CertificationError("enrollment_not_found", 404);
  if (!enrollmentIsAccessible(row.enrollment))
    throw new CertificationError("enrollment_inactive");

  const passed = await db
    .select({ id: examAttempts.id })
    .from(examAttempts)
    .where(and(eq(examAttempts.enrollmentId, enrollmentId), eq(examAttempts.passed, true)))
    .limit(1);
  if (!passed[0]) throw new CertificationError("exam_not_passed");

  const requiredLessons = await db
    .select({ lesson: lessons })
    .from(lessons)
    .innerJoin(chapters, eq(chapters.id, lessons.chapterId))
    .where(and(eq(chapters.courseVersionId, row.enrollment.courseVersionId), eq(lessons.required, true)));
  const completedLessons = requiredLessons.length
    ? await db
        .select({ lessonId: lessonProgress.lessonId })
        .from(lessonProgress)
        .where(and(eq(lessonProgress.enrollmentId, enrollmentId), eq(lessonProgress.status, "completed")))
    : [];
  if (!hasCompletedRequiredLessons(requiredLessons.map(({ lesson }) => lesson.id), completedLessons.map(({ lessonId }) => lessonId)))
    throw new CertificationError("required_lessons_incomplete");

  if (courseNeedsIdentityVerification(row.course)) {
    const verified = await db
      .select({ id: identityVerifications.id })
      .from(identityVerifications)
      .where(and(eq(identityVerifications.enrollmentId, enrollmentId), eq(identityVerifications.status, "identity_verified")))
      .limit(1);
    if (!verified[0]) throw new CertificationError("identity_not_verified");
  }
  if (row.course.id06Enabled && !row.course.competenceCode)
    throw new CertificationError("id06_competence_code_missing");
  if (row.course.id06Enabled) {
    const profile = (
      await db
        .select({ personalIdentityEncrypted: profiles.personalIdentityEncrypted })
        .from(profiles)
        .where(eq(profiles.userId, row.enrollment.userId))
        .limit(1)
    )[0];
    if (!identityDataIsReadyForId06(profile))
      throw new CertificationError("personal_identity_required");
  }

  const existing = await db.select().from(certificates).where(eq(certificates.enrollmentId, enrollmentId)).limit(1);
  if (existing[0]) {
    if (existing[0].status === "revoked")
      throw new CertificationError("certificate_revoked");
    await ensureCertificateSideEffects(db, existing[0], row.enrollment, row.course);
    return { certificate: existing[0], idempotent: true };
  }

  const issuedAt = new Date();
  const certificate = {
    id: crypto.randomUUID(),
    enrollmentId,
    userId: row.enrollment.userId,
    courseId: row.enrollment.courseId,
    courseVersionId: row.enrollment.courseVersionId,
    certificateNumber: `KP-${issuedAt.getFullYear()}-${crypto.randomUUID().slice(0, 8).toUpperCase()}`,
    verificationCode: crypto.randomUUID().replaceAll("-", "").slice(0, 12).toUpperCase(),
    issuedAt: issuedAt.toISOString(),
    validUntil: addMonthsIso(issuedAt.toISOString(), row.course.validityMonths),
    status: "issued" as const,
  };
  try {
    await db.insert(certificates).values(certificate);
  } catch {
    const concurrent = await db.select().from(certificates).where(eq(certificates.enrollmentId, enrollmentId)).limit(1);
    if (concurrent[0]) return { certificate: concurrent[0], idempotent: true };
    throw new CertificationError("certificate_insert_failed", 500);
  }
  await ensureCertificateSideEffects(db, certificate, row.enrollment, row.course);
  await db.insert(auditLogs).values({
    id: crypto.randomUUID(),
    actorUserId,
    targetType: "certificate",
    targetId: certificate.id,
    action: "issued",
    beforeJson: null,
    afterJson: JSON.stringify({ enrollmentId, courseVersionId: row.enrollment.courseVersionId, automatic: true }),
    ipHash: metadata.ipHash ?? null,
    userAgent: metadata.userAgent ?? null,
  });
  await queueTemplatedNotification(db, {
    userId: certificate.userId,
    type: "certificate_issued",
    variables: {
      courseName: row.course.name,
      certificateNumber: certificate.certificateNumber,
      certificateUrl: `/verify/${certificate.verificationCode}`,
      validUntil: certificate.validUntil,
      enrollmentId,
    },
    fallbackSubject: `Ditt certifikat för ${row.course.name} är utfärdat`,
    fallbackBody: `Ditt certifikat ${certificate.certificateNumber} för ${row.course.name} är utfärdat.`,
    scheduledFor: `certificate:${certificate.id}`,
  });
  return { certificate, idempotent: false };
}

async function ensureCertificateSideEffects(
  db: Database,
  certificate: typeof certificates.$inferInsert,
  enrollment: typeof enrollments.$inferSelect,
  course: typeof courses.$inferSelect,
) {
  await db.insert(competencies).values({
    id: crypto.randomUUID(),
    userId: enrollment.userId,
    courseId: enrollment.courseId,
    certificateId: certificate.id!,
    validFrom: certificate.issuedAt!.slice(0, 10),
    validUntil: certificate.validUntil?.slice(0, 10) ?? null,
    status: "valid",
  }).onConflictDoNothing();
  if (course.id06Enabled)
    await db.insert(id06Registrations).values({
      id: crypto.randomUUID(),
      certificateId: certificate.id!,
      enrollmentId: enrollment.id,
      competenceCode: course.competenceCode ?? "",
      competenceName: course.name,
      status: "ready_for_id06",
    }).onConflictDoNothing();
  await db.update(enrollments).set({ status: "completed", completedAt: certificate.issuedAt }).where(eq(enrollments.id, enrollment.id));
}
