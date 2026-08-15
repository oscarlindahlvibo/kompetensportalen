import { and, desc, eq, inArray } from "drizzle-orm";
import { getDb } from "@/db";
import {
  auditLogs,
  chapters,
  certificates,
  companies,
  courses,
  courseVersions,
  enrollments,
  examAttempts,
  id06Registrations,
  identityVerifications,
  lessonProgress,
  lessons,
  profiles,
  quizAttempts,
  users,
} from "@/db/schema";
import {
  ensureDbUser,
  requireApiIdentity,
  requirePermission,
  requestMetadata,
} from "@/lib/server-auth";

export const dynamic = "force-dynamic";

function csvCell(value: string | number | boolean | null | undefined) {
  return `"${String(value ?? "").replaceAll('"', '""')}"`;
}

export async function GET(request: Request) {
  const identity = await requireApiIdentity();
  if (identity instanceof Response) return identity;
  const db = getDb();
  const actor = await ensureDbUser(db, identity);
  requirePermission(actor.role, "certification:read");
  const url = new URL(request.url);
  const courseId = url.searchParams.get("courseId");
  const companyId = url.searchParams.get("companyId");
  const conditions = [
    ...(courseId ? [eq(enrollments.courseId, courseId)] : []),
    ...(companyId ? [eq(enrollments.companyId, companyId)] : []),
  ];
  const base = await db
    .select({
      enrollment: enrollments,
      user: users,
      profile: profiles,
      company: companies,
      course: courses,
      version: courseVersions,
      certificate: certificates,
    })
    .from(enrollments)
    .innerJoin(users, eq(users.id, enrollments.userId))
    .leftJoin(profiles, eq(profiles.userId, enrollments.userId))
    .leftJoin(companies, eq(companies.id, enrollments.companyId))
    .innerJoin(courses, eq(courses.id, enrollments.courseId))
    .innerJoin(
      courseVersions,
      eq(courseVersions.id, enrollments.courseVersionId),
    )
    .leftJoin(certificates, eq(certificates.enrollmentId, enrollments.id))
    .where(conditions.length ? and(...conditions) : undefined)
    .orderBy(desc(enrollments.createdAt));
  const enrollmentIds = base.map((row) => row.enrollment.id);
  const versionIds = [...new Set(base.map((row) => row.enrollment.courseVersionId))];
  const versionLessons = versionIds.length
    ? await db
        .select({ versionId: chapters.courseVersionId, required: lessons.required })
        .from(lessons)
        .innerJoin(chapters, eq(chapters.id, lessons.chapterId))
        .where(inArray(chapters.courseVersionId, versionIds))
    : [];
  const requiredByVersion = new Map<string, number>();
  for (const lesson of versionLessons)
    if (lesson.required)
      requiredByVersion.set(lesson.versionId, (requiredByVersion.get(lesson.versionId) ?? 0) + 1);
  const progress = enrollmentIds.length
    ? await db
        .select({ progress: lessonProgress, lesson: lessons })
        .from(lessonProgress)
        .innerJoin(lessons, eq(lessons.id, lessonProgress.lessonId))
        .where(inArray(lessonProgress.enrollmentId, enrollmentIds))
    : [];
  const quizzes = enrollmentIds.length
    ? await db
        .select()
        .from(quizAttempts)
        .where(inArray(quizAttempts.enrollmentId, enrollmentIds))
        .orderBy(desc(quizAttempts.submittedAt))
    : [];
  const exams = enrollmentIds.length
    ? await db
        .select()
        .from(examAttempts)
        .where(inArray(examAttempts.enrollmentId, enrollmentIds))
        .orderBy(desc(examAttempts.startedAt))
    : [];
  const identities = enrollmentIds.length
    ? await db
        .select()
        .from(identityVerifications)
        .where(inArray(identityVerifications.enrollmentId, enrollmentIds))
        .orderBy(desc(identityVerifications.createdAt))
    : [];
  const id06 = enrollmentIds.length
    ? await db
        .select()
        .from(id06Registrations)
        .where(inArray(id06Registrations.enrollmentId, enrollmentIds))
    : [];
  const progressByEnrollment = new Map<
    string,
    { completed: number }
  >();
  for (const row of progress) {
    const current = progressByEnrollment.get(row.progress.enrollmentId) ?? {
      completed: 0,
    };
    if (row.progress.status === "completed") current.completed += 1;
    progressByEnrollment.set(row.progress.enrollmentId, current);
  }
  const quizByEnrollment = new Map<string, typeof quizzes>();
  for (const attempt of quizzes)
    quizByEnrollment.set(attempt.enrollmentId, [
      ...(quizByEnrollment.get(attempt.enrollmentId) ?? []),
      attempt,
    ]);
  const examByEnrollment = new Map<string, typeof exams>();
  for (const attempt of exams)
    examByEnrollment.set(attempt.enrollmentId, [
      ...(examByEnrollment.get(attempt.enrollmentId) ?? []),
      attempt,
    ]);
  const identityByEnrollment = new Map<string, (typeof identities)[number]>();
  for (const verification of identities)
    if (
      !identityByEnrollment.has(verification.enrollmentId ?? "") ||
      verification.status === "identity_verified"
    )
      identityByEnrollment.set(verification.enrollmentId ?? "", verification);
  const id06ByEnrollment = new Map(
    id06.map((registration) => [registration.enrollmentId, registration]),
  );
  const rows = base.map(
    ({ enrollment, user, profile, company, course, version, certificate }) => {
      const progressData = progressByEnrollment.get(enrollment.id) ?? {
        completed: 0,
      };
      const examAttemptsForEnrollment =
        examByEnrollment.get(enrollment.id) ?? [];
      const quizAttemptsForEnrollment =
        quizByEnrollment.get(enrollment.id) ?? [];
      const latestExam = examAttemptsForEnrollment[0];
      const identityVerification = identityByEnrollment.get(enrollment.id);
      const registration = id06ByEnrollment.get(enrollment.id);
      return {
        enrollmentId: enrollment.id,
        participantEmail: user.email,
        company: company?.name ?? null,
        course: course.name,
        courseVersion: version.version,
        status: enrollment.status,
        progressPercent: enrollment.progressPercent,
        purchasedAt: enrollment.purchasedAt,
        startedAt: enrollment.startedAt,
        completedAt: enrollment.completedAt,
        validFrom: enrollment.validFrom,
        validUntil: enrollment.validUntil,
        completedLessons: progressData.completed,
        requiredLessons: requiredByVersion.get(enrollment.courseVersionId) ?? 0,
        quizAttempts: quizAttemptsForEnrollment.length,
        examAttempts: examAttemptsForEnrollment.length,
        latestExamScorePercent: latestExam?.scorePercent ?? null,
        latestExamPassed: latestExam?.passed ?? false,
        identityStatus: identityVerification?.status ?? null,
        identityMethod: identityVerification?.method ?? null,
        identityLast4: profile?.identityLast4 ?? null,
        certificateNumber: certificate?.certificateNumber ?? null,
        certificateIssuedAt: certificate?.issuedAt ?? null,
        certificateValidUntil: certificate?.validUntil ?? null,
        id06Status: registration?.status ?? null,
        id06Reference: registration?.id06Reference ?? null,
        examSnapshots: examAttemptsForEnrollment.map((attempt) => ({
          id: attempt.id,
          attemptNumber: attempt.attemptNumber,
          status: attempt.status,
          startedAt: attempt.startedAt,
          finishedAt: attempt.finishedAt,
          scorePercent: attempt.scorePercent,
          passed: attempt.passed,
          courseVersionId: attempt.courseVersionId,
          questionSnapshotJson: attempt.questionSnapshotJson,
        })),
      };
    },
  );
  const metadata = await requestMetadata();
  await db
    .insert(auditLogs)
    .values({
      id: crypto.randomUUID(),
      actorUserId: actor.id,
      targetType: "enrollments",
      targetId: actor.id,
      action: "enrollment_exported",
      beforeJson: null,
      afterJson: JSON.stringify({
        count: rows.length,
        courseId,
        companyId,
        format: url.searchParams.get("format") ?? "csv",
      }),
      ipHash: metadata.ip,
      userAgent: metadata.userAgent,
    });
  if (url.searchParams.get("format") === "json")
    return Response.json({ exportedAt: new Date().toISOString(), rows });
  const headers = [
    "Enrollment ID",
    "Deltagare",
    "Företag",
    "Utbildning",
    "Kursversion",
    "Status",
    "Progress %",
    "Köpt",
    "Påbörjad",
    "Slutförd",
    "Giltig från",
    "Giltig till",
    "Slutförda lektioner",
    "Obligatoriska lektioner",
    "Quizförsök",
    "Slutprovsförsök",
    "Senaste prov %",
    "Senaste prov godkänt",
    "Identitetsstatus",
    "Identitetsmetod",
    "Personnummer sista 4",
    "Certifikat",
    "Certifikat utfärdat",
    "Certifikat giltigt till",
    "ID06-status",
    "ID06-referens",
  ];
  const lines = [headers.map(csvCell).join(";")];
  for (const row of rows)
    lines.push(
      [
        row.enrollmentId,
        row.participantEmail,
        row.company,
        row.course,
        row.courseVersion,
        row.status,
        row.progressPercent,
        row.purchasedAt,
        row.startedAt,
        row.completedAt,
        row.validFrom,
        row.validUntil,
        row.completedLessons,
        row.requiredLessons,
        row.quizAttempts,
        row.examAttempts,
        row.latestExamScorePercent,
        row.latestExamPassed,
        row.identityStatus,
        row.identityMethod,
        row.identityLast4 ? `••••••${row.identityLast4}` : null,
        row.certificateNumber,
        row.certificateIssuedAt,
        row.certificateValidUntil,
        row.id06Status,
        row.id06Reference,
      ]
        .map(csvCell)
        .join(";"),
    );
  return new Response(`\uFEFF${lines.join("\n")}`, {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="elevdokumentation-${new Date().toISOString().slice(0, 10)}.csv"`,
    },
  });
}
