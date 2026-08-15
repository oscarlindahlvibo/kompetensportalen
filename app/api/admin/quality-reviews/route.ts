import { eq } from "drizzle-orm";
import { getDb } from "@/db";
import { auditLogs, qualityReviews } from "@/db/schema";
import { ensureDbUser, requireApiIdentity, requireMutationIdentity, requirePermission, requestMetadata } from "@/lib/server-auth";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const identity = await requireApiIdentity();
  if (identity instanceof Response) return identity;
  const courseId = new URL(request.url).searchParams.get("courseId");
  const db = getDb();
  const actor = await ensureDbUser(db, identity);
  requirePermission(actor.role, "course:read");
  return Response.json({ reviews: await db.select().from(qualityReviews).where(courseId ? eq(qualityReviews.courseId, courseId) : undefined) });
}

export async function POST(request: Request) {
  const identity = await requireMutationIdentity(request);
  if (identity instanceof Response) return identity;
  const input = await request.json() as { courseId?: string; latestReviewAt?: string | null; nextReviewAt?: string | null; notes?: string | null; contentReviewed?: boolean; examReviewed?: boolean; certificateReviewed?: boolean; id06CodeVerified?: boolean; publicationApproved?: boolean };
  if (!input.courseId) return Response.json({ error: "course_id_required" }, { status: 400 });
  const db = getDb();
  const actor = await ensureDbUser(db, identity);
  requirePermission(actor.role, "course:write");
  const review = { id: crypto.randomUUID(), courseId: input.courseId, educationOwnerUserId: actor.id, contentOwnerUserId: actor.id, latestReviewAt: input.latestReviewAt ?? null, nextReviewAt: input.nextReviewAt ?? null, notes: input.notes ?? null, contentReviewed: input.contentReviewed ?? false, examReviewed: input.examReviewed ?? false, certificateReviewed: input.certificateReviewed ?? false, id06CodeVerified: input.id06CodeVerified ?? false, publicationApproved: input.publicationApproved ?? false };
  await db.insert(qualityReviews).values(review);
  const metadata = await requestMetadata();
  await db.insert(auditLogs).values({ id: crypto.randomUUID(), actorUserId: actor.id, targetType: "quality_review", targetId: review.id, action: "quality_review.created", beforeJson: null, afterJson: JSON.stringify({ courseId: review.courseId, latestReviewAt: review.latestReviewAt, nextReviewAt: review.nextReviewAt }), ipHash: metadata.ip, userAgent: metadata.userAgent });
  return Response.json({ review }, { status: 201 });
}

export async function PATCH(request: Request) {
  const identity = await requireMutationIdentity(request);
  if (identity instanceof Response) return identity;
  const input = await request.json() as { id?: string; latestReviewAt?: string | null; nextReviewAt?: string | null; notes?: string | null; contentReviewed?: boolean; examReviewed?: boolean; certificateReviewed?: boolean; id06CodeVerified?: boolean; publicationApproved?: boolean };
  if (!input.id) return Response.json({ error: "review_id_required" }, { status: 400 });
  const db = getDb();
  const actor = await ensureDbUser(db, identity);
  requirePermission(actor.role, "course:write");
  const current = (await db.select().from(qualityReviews).where(eq(qualityReviews.id, input.id)).limit(1))[0];
  if (!current) return Response.json({ error: "review_not_found" }, { status: 404 });
  const next = { latestReviewAt: input.latestReviewAt ?? current.latestReviewAt, nextReviewAt: input.nextReviewAt ?? current.nextReviewAt, notes: input.notes ?? current.notes, contentReviewed: input.contentReviewed ?? current.contentReviewed, examReviewed: input.examReviewed ?? current.examReviewed, certificateReviewed: input.certificateReviewed ?? current.certificateReviewed, id06CodeVerified: input.id06CodeVerified ?? current.id06CodeVerified, publicationApproved: input.publicationApproved ?? current.publicationApproved };
  await db.update(qualityReviews).set(next).where(eq(qualityReviews.id, current.id));
  const metadata = await requestMetadata();
  await db.insert(auditLogs).values({ id: crypto.randomUUID(), actorUserId: actor.id, targetType: "quality_review", targetId: current.id, action: "quality_review.updated", beforeJson: JSON.stringify({ latestReviewAt: current.latestReviewAt, nextReviewAt: current.nextReviewAt, notes: current.notes, contentReviewed: current.contentReviewed, examReviewed: current.examReviewed, certificateReviewed: current.certificateReviewed, id06CodeVerified: current.id06CodeVerified, publicationApproved: current.publicationApproved }), afterJson: JSON.stringify(next), ipHash: metadata.ip, userAgent: metadata.userAgent });
  return Response.json({ review: { ...current, ...next } });
}
