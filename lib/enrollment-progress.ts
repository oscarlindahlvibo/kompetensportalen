import { and, eq } from "drizzle-orm";
import { chapters, enrollments, lessonProgress, lessons } from "@/db/schema";
import { calculateProgressPercent } from "@/lib/platform";

type Database = ReturnType<typeof import("@/db").getDb>;

export async function recalculateEnrollmentProgress(
  db: Database,
  enrollmentId: string,
) {
  const enrollment = (
    await db
      .select({ enrollment: enrollments })
      .from(enrollments)
      .where(eq(enrollments.id, enrollmentId))
      .limit(1)
  )[0]?.enrollment;
  if (!enrollment) return null;

  const allLessons = await db
    .select({ lesson: lessons })
    .from(lessons)
    .innerJoin(chapters, eq(chapters.id, lessons.chapterId))
    .where(eq(chapters.courseVersionId, enrollment.courseVersionId));
  const completed = await db
    .select({ lessonId: lessonProgress.lessonId })
    .from(lessonProgress)
    .where(and(eq(lessonProgress.enrollmentId, enrollmentId), eq(lessonProgress.status, "completed")));
  const completedIds = new Set(
    completed.map((item) => item.lessonId),
  );
  const progressPercent = calculateProgressPercent(
    allLessons.length,
    allLessons.filter(({ lesson }) => completedIds.has(lesson.id)).length,
  );
  const now = new Date().toISOString();
  await db
    .update(enrollments)
    .set({
      status: progressPercent === 100 ? "completed" : "in_progress",
      progressPercent,
      startedAt: enrollment.startedAt ?? now,
      completedAt: progressPercent === 100 ? enrollment.completedAt ?? now : null,
      updatedAt: now,
    })
    .where(eq(enrollments.id, enrollmentId));
  return progressPercent;
}
