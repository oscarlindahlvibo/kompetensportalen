import { and, eq, isNull, or } from "drizzle-orm";
import { getDb } from "@/db";
import { chapters, enrollments, lessons, questions } from "@/db/schema";
import { ensureDbUser, requireApiIdentity } from "@/lib/server-auth";
import { enrollmentIsAccessible } from "@/lib/platform";
import { encodeCourseAssetKey } from "@/lib/course-assets";
import { downloadCourseAsset } from "@/lib/course-storage";

export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  context: { params: Promise<{ key: string[] }> },
) {
  const identity = await requireApiIdentity();
  if (identity instanceof Response) return identity;
  const { key: parts } = await context.params;
  const key = parts.join("/");
  if (!key || key.includes("..")) return new Response("Not found", { status: 404 });
  const db = getDb();
  const user = await ensureDbUser(db, identity);
  const owned = await db
    .select({ enrollment: enrollments, lesson: lessons, question: questions })
    .from(enrollments)
    .innerJoin(chapters, eq(chapters.courseVersionId, enrollments.courseVersionId))
    .innerJoin(lessons, eq(lessons.chapterId, chapters.id))
    .leftJoin(questions, and(eq(questions.courseId, enrollments.courseId), or(eq(questions.chapterId, chapters.id), isNull(questions.chapterId))))
    .where(eq(enrollments.userId, user.id));
  const allowed = owned.some(({ enrollment, lesson, question }) => {
    if (!enrollmentIsAccessible(enrollment)) return false;
    try {
      const body = JSON.parse(lesson.bodyJson) as { imageUrl?: string; videoUrl?: string; documentUrl?: string; assetRef?: string };
      return [body.imageUrl, body.videoUrl, body.documentUrl, body.assetRef, question?.imageUrl]
        .some((value) => value === `r2://${key}` || value === `course-assets://${key}` || value === key || value === `/api/course-assets/${encodeCourseAssetKey(key)}`);
    } catch {
      return false;
    }
  });
  if (!allowed) return new Response("Not found", { status: 404 });
  const asset = await downloadCourseAsset(key);
  if (!asset) return new Response("Not found", { status: 404 });
  return new Response(asset.body, {
    headers: {
      "content-type": asset.contentType,
      "cache-control": "private, max-age=300",
    },
  });
}
