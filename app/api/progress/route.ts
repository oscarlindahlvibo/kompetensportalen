import { and, eq } from "drizzle-orm";
import { getDb } from "@/db";
import { auditLogs, chapters, courseVersions, courses, enrollments, lessonProgress, lessons } from "@/db/schema";
import { ensureDbUser, requireApiIdentity, requestMetadata } from "@/lib/server-auth";
import { canManuallyCompleteLesson, enrollmentIsAccessible, nextLessonProgressStatus } from "@/lib/platform";
import { recalculateEnrollmentProgress } from "@/lib/enrollment-progress";
import { queueTemplatedNotification } from "@/lib/notifications";
import { sameOriginGuard } from "@/lib/request-security";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const originError = sameOriginGuard(request);
  if (originError) return originError;
  const user = await requireApiIdentity();
  if (user instanceof Response) return user;
  const body = await request.json() as { enrollmentId?: string; lessonId?: string; status?: "started" | "completed" };
  if (!body.enrollmentId || !body.lessonId || !body.status) return Response.json({ error: "invalid_payload" }, { status: 400 });
  const db = getDb();
  const dbUser = await ensureDbUser(db, user);
  const ownership = await db.select({ enrollment: enrollments, lesson: lessons }).from(enrollments)
    .innerJoin(courseVersions, eq(courseVersions.id, enrollments.courseVersionId))
    .innerJoin(chapters, eq(chapters.courseVersionId, courseVersions.id))
    .innerJoin(lessons, and(eq(lessons.chapterId, chapters.id), eq(lessons.id, body.lessonId)))
    .where(and(eq(enrollments.id, body.enrollmentId), eq(enrollments.userId, dbUser.id))).limit(1);
  if (!ownership[0]) return Response.json({ error: "forbidden" }, { status: 403 });
  if (!enrollmentIsAccessible(ownership[0].enrollment)) return Response.json({ error: "enrollment_inactive" }, { status: 409 });
  if (body.status === "completed" && !canManuallyCompleteLesson(ownership[0].lesson.type))
    return Response.json({ error: "assessment_completion_requires_submission" }, { status: 409 });
  const existing = await db.select().from(lessonProgress).where(and(eq(lessonProgress.enrollmentId, body.enrollmentId), eq(lessonProgress.lessonId, body.lessonId))).limit(1);
  const course = (await db.select({ name: courses.name }).from(courses).where(eq(courses.id, ownership[0].enrollment.courseId)).limit(1))[0];
  if (!existing[0] && course)
    await queueTemplatedNotification(db, {
      userId: dbUser.id,
      type: "course_started",
      variables: { courseName: course.name, courseUrl: `/utbildning/${body.enrollmentId}` },
      fallbackSubject: `Du har påbörjat ${course.name}`,
      fallbackBody: `Du har påbörjat ${course.name}. Öppna utbildningen för att fortsätta.`,
      scheduledFor: `course-started:${body.enrollmentId}`,
    });
  const now = new Date().toISOString();
  const nextStatus = nextLessonProgressStatus(existing[0]?.status === "not_started" ? null : existing[0]?.status ?? null, body.status);
  const statusChanged = !existing[0] || existing[0].status !== nextStatus;
  if (existing[0]) await db.update(lessonProgress).set({ status: nextStatus, completedAt: nextStatus === "completed" ? existing[0].completedAt ?? now : null }).where(eq(lessonProgress.id, existing[0].id));
  else await db.insert(lessonProgress).values({ id: crypto.randomUUID(), enrollmentId: body.enrollmentId, lessonId: body.lessonId, status: nextStatus, completedAt: nextStatus === "completed" ? now : null });
  const progressPercent = await recalculateEnrollmentProgress(db, body.enrollmentId) ?? 0;
  if (statusChanged) {
    const progress = existing[0] ?? (await db.select().from(lessonProgress).where(and(eq(lessonProgress.enrollmentId, body.enrollmentId), eq(lessonProgress.lessonId, body.lessonId))).limit(1))[0];
    const metadata = await requestMetadata();
    await db.insert(auditLogs).values({
      id: crypto.randomUUID(),
      actorUserId: dbUser.id,
      targetType: "lesson_progress",
      targetId: progress?.id ?? body.lessonId,
      action: "lesson_progress.changed",
      beforeJson: JSON.stringify({ enrollmentId: body.enrollmentId, lessonId: body.lessonId, courseVersionId: ownership[0].enrollment.courseVersionId, status: existing[0]?.status ?? null }),
      afterJson: JSON.stringify({ enrollmentId: body.enrollmentId, lessonId: body.lessonId, courseVersionId: ownership[0].enrollment.courseVersionId, status: nextStatus, progressPercent }),
      ipHash: metadata.ip,
      userAgent: metadata.userAgent,
    });
  }
  return Response.json({ ok: true, progressPercent });
}
