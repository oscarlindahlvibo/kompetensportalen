import { and, desc, eq } from "drizzle-orm";
import { getDb } from "@/db";
import { auditLogs, chapters, courseInterest, courseVersionGoverningDocuments, courseVersions, courses, examConfigs, lessons, products, qualityReviews } from "@/db/schema";
import { ensureDbUser, requireMutationIdentity, requirePermission } from "@/lib/server-auth";
import { queueTemplatedNotification } from "@/lib/notifications";

export const dynamic = "force-dynamic";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const identity = await requireMutationIdentity(request);
  if (identity instanceof Response) return identity;
  const { id } = await context.params;
  const body = await request.json() as { versionId?: string };
  if (!body.versionId) return Response.json({ error: "version_required" }, { status: 400 });
  const db = getDb();
  const actor = await ensureDbUser(db, identity);
  requirePermission(actor.role, "course:write");
  const version = (await db.select().from(courseVersions).where(and(eq(courseVersions.id, body.versionId), eq(courseVersions.courseId, id))).limit(1))[0];
  if (!version) return Response.json({ error: "version_not_found" }, { status: 404 });
  if (version.status === "published")
    return Response.json({ ok: true, versionId: version.id, status: "published" });
  const chapterRows = await db.select().from(chapters).where(eq(chapters.courseVersionId, version.id));
  const lessonRows = chapterRows.length
    ? (await Promise.all(chapterRows.map((chapter) => db.select().from(lessons).where(eq(lessons.chapterId, chapter.id))))).flat()
    : [];
  if (!chapterRows.length || !lessonRows.length)
    return Response.json({ error: "version_content_required" }, { status: 409 });
  const course = (await db.select().from(courses).where(eq(courses.id, id)).limit(1))[0];
  if (course?.id06Enabled) {
    if (!course.requiresIdentityVerification)
      return Response.json({ error: "id06_identity_verification_required" }, { status: 409 });
    const exam = (await db.select().from(examConfigs).where(eq(examConfigs.courseVersionId, version.id)).limit(1))[0];
    if (!exam || exam.questionCount < 1 || !lessonRows.some((lesson) => lesson.type === "exam"))
      return Response.json({ error: "id06_exam_required" }, { status: 409 });
    const governingDocuments = await db.select({ id: courseVersionGoverningDocuments.id }).from(courseVersionGoverningDocuments).where(eq(courseVersionGoverningDocuments.courseVersionId, version.id)).limit(1);
    if (!governingDocuments[0])
      return Response.json({ error: "governing_documents_required" }, { status: 409 });
    const review = (await db.select().from(qualityReviews).where(eq(qualityReviews.courseId, version.courseId)).orderBy(desc(qualityReviews.createdAt)).limit(1))[0];
    if (!review || !review.contentReviewed || !review.examReviewed || !review.certificateReviewed || !review.id06CodeVerified || !review.publicationApproved)
      return Response.json({ error: "quality_review_incomplete" }, { status: 409 });
  }
  const previousPublished = (await db.select({ id: courseVersions.id }).from(courseVersions).where(and(eq(courseVersions.courseId, id), eq(courseVersions.status, "published"))));
  await db.update(courseVersions).set({ status: "retired" }).where(and(eq(courseVersions.courseId, id), eq(courseVersions.status, "published")));
  await db.update(courseVersions).set({ status: "published", publishedAt: new Date().toISOString() }).where(eq(courseVersions.id, version.id));
  const product = (await db.select().from(products).where(eq(products.courseId, id)).limit(1))[0];
  if (product) {
    await db.update(products).set({ name: course?.name ?? product.name, priceSek: course?.basePriceSek ?? product.priceSek, active: true }).where(eq(products.id, product.id));
  } else if (course) {
    await db.insert(products).values({
      id: `product_${course.id}`,
      courseId: course.id,
      sku: `COURSE-${course.slug.toUpperCase().replace(/[^A-Z0-9]+/g, "-")}`.slice(0, 80),
      name: course.name,
      priceSek: course.basePriceSek,
      active: true,
    });
  }
  await db.update(courses).set({ status: "published" }).where(eq(courses.id, id));
  const interested = await db.select().from(courseInterest).where(and(eq(courseInterest.courseId, id), eq(courseInterest.status, "subscribed")));
  for (const subscriber of interested) {
    await queueTemplatedNotification(db, {
      recipientEmail: subscriber.email,
      type: "course_released",
      variables: { courseName: course?.name ?? "Utbildningen", courseUrl: `/utbildningar/${course?.slug ?? id}` },
      fallbackSubject: `${course?.name ?? "Utbildningen"} är nu tillgänglig`,
      fallbackBody: `${course?.name ?? "Utbildningen"} är nu tillgänglig.`,
      scheduledFor: `course-released:${id}:${subscriber.id}`,
    });
    await db.update(courseInterest).set({ status: "notified" }).where(eq(courseInterest.id, subscriber.id));
  }
  await db.insert(auditLogs).values({
    id: crypto.randomUUID(),
    actorUserId: actor.id,
    targetType: "course_version",
    targetId: version.id,
    action: "course_version.published",
    beforeJson: JSON.stringify({ status: version.status, previousPublishedVersionIds: previousPublished.map((item) => item.id) }),
    afterJson: JSON.stringify({ status: "published", courseId: id }),
    ipHash: null,
    userAgent: null,
  });
  return Response.json({ ok: true, versionId: version.id, status: "published" });
}
