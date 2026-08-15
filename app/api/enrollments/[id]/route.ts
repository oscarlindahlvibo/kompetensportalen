import { and, asc, eq } from "drizzle-orm";
import { getDb } from "@/db";
import { chapters, courseVersions, enrollments, lessons } from "@/db/schema";
import { ensureDbUser, requireApiIdentity } from "@/lib/server-auth";
import { enrollmentIsAccessible } from "@/lib/platform";

export const dynamic = "force-dynamic";

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const user = await requireApiIdentity();
  if (user instanceof Response) return user;
  const { id } = await context.params;
  const db = getDb();
  const dbUser = await ensureDbUser(db, user);
  const rows = await db.select({ enrollment: enrollments, version: courseVersions }).from(enrollments).innerJoin(courseVersions, eq(courseVersions.id, enrollments.courseVersionId)).where(and(eq(enrollments.id, id), eq(enrollments.userId, dbUser.id))).limit(1);
  const row = rows[0];
  if (!row) return Response.json({ error: "enrollment_not_found" }, { status: 404 });
  const accessible = enrollmentIsAccessible(row.enrollment);
  const chapterRows = accessible
    ? await db.select({ chapter: chapters, lesson: lessons }).from(chapters).innerJoin(lessons, eq(lessons.chapterId, chapters.id)).where(eq(chapters.courseVersionId, row.enrollment.courseVersionId)).orderBy(asc(chapters.sortOrder), asc(lessons.sortOrder))
    : [];
  return Response.json({
    enrollment: row.enrollment,
    accessible,
    // Never expose the immutable import snapshot to participants. It may contain
    // answer keys and other authoring-only examination data.
    version: {
      id: row.version.id,
      courseId: row.version.courseId,
      version: row.version.version,
      status: row.version.status,
      changelog: row.version.changelog,
      publishedAt: row.version.publishedAt,
    },
    chapters: chapterRows.map((item) => ({ ...item.chapter, lesson: { id: item.lesson.id, title: item.lesson.title, type: item.lesson.type, required: item.lesson.required } })),
  });
}
