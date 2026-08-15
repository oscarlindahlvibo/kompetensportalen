import { and, desc, eq } from "drizzle-orm";
import { getDb } from "@/db";
import { courses, courseVersions } from "@/db/schema";
import { ensureApvCatalog } from "@/lib/catalog";

export async function GET(_request: Request, context: { params: Promise<{ slug: string }> }) {
  const { slug } = await context.params;
  const db = getDb();
  await ensureApvCatalog(db);
  const rows = await db.select({ course: courses, version: courseVersions }).from(courses).leftJoin(courseVersions, and(eq(courseVersions.courseId, courses.id), eq(courseVersions.status, "published"))).where(eq(courses.slug, slug)).orderBy(desc(courseVersions.publishedAt), desc(courseVersions.createdAt)).limit(1);
  const row = rows[0];
  if (!row || row.course.status === "draft" || row.course.status === "archived") return Response.json({ error: "course_not_found" }, { status: 404 });
  return Response.json({ course: { ...row.course, tags: JSON.parse(row.course.tagsJson) }, version: row.version ? { id: row.version.id, version: row.version.version, publishedAt: row.version.publishedAt } : null, contentLocked: true });
}
