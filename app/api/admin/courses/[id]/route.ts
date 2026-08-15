import { eq } from "drizzle-orm";
import { getDb } from "@/db";
import { auditLogs, courses, products } from "@/db/schema";
import { ensureDbUser, requireMutationIdentity, requirePermission } from "@/lib/server-auth";

export const dynamic = "force-dynamic";

const statuses = new Set(["draft", "coming_soon", "archived"]);

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  const identity = await requireMutationIdentity(request);
  if (identity instanceof Response) return identity;
  const { id } = await context.params;
  const input = await request.json() as Partial<typeof courses.$inferInsert>;
  const db = getDb();
  const actor = await ensureDbUser(db, identity);
  requirePermission(actor.role, "course:write");
  if (input.status === "published") return Response.json({ error: "use_publish_endpoint" }, { status: 400 });
  if (input.status !== undefined && !statuses.has(input.status)) return Response.json({ error: "invalid_course_status" }, { status: 400 });
  const current = (await db.select().from(courses).where(eq(courses.id, id)).limit(1))[0];
  if (!current) return Response.json({ error: "course_not_found" }, { status: 404 });
  const next = {
    ...(input.name === undefined ? {} : { name: input.name.trim() }),
    ...(input.shortDescription === undefined ? {} : { shortDescription: input.shortDescription.trim() }),
    ...(input.fullDescription === undefined ? {} : { fullDescription: input.fullDescription.trim() }),
    ...(input.category === undefined ? {} : { category: input.category.trim() }),
    ...(input.status === undefined ? {} : { status: input.status }),
    ...(input.basePriceSek === undefined ? {} : { basePriceSek: input.basePriceSek }),
    ...(input.vatRate === undefined ? {} : { vatRate: input.vatRate }),
    ...(input.campaignPriceSek === undefined ? {} : { campaignPriceSek: input.campaignPriceSek }),
    ...(input.validityMonths === undefined ? {} : { validityMonths: input.validityMonths }),
    ...(input.estimatedMinutes === undefined ? {} : { estimatedMinutes: input.estimatedMinutes }),
    ...(input.targetAudience === undefined ? {} : { targetAudience: input.targetAudience }),
    ...(input.prerequisites === undefined ? {} : { prerequisites: input.prerequisites }),
    ...(input.regulatoryFramework === undefined ? {} : { regulatoryFramework: input.regulatoryFramework }),
    ...(input.competenceCode === undefined ? {} : { competenceCode: input.competenceCode }),
    ...(input.requiresIdentityVerification === undefined ? {} : { requiresIdentityVerification: input.requiresIdentityVerification }),
    ...(input.id06Enabled === undefined ? {} : { id06Enabled: input.id06Enabled }),
    ...(input.imageUrl === undefined ? {} : { imageUrl: input.imageUrl }),
    ...(input.bannerUrl === undefined ? {} : { bannerUrl: input.bannerUrl }),
    ...(input.seoTitle === undefined ? {} : { seoTitle: input.seoTitle }),
    ...(input.seoDescription === undefined ? {} : { seoDescription: input.seoDescription }),
    ...(input.tagsJson === undefined ? {} : { tagsJson: input.tagsJson }),
    updatedAt: new Date().toISOString(),
  };
  if (next.name !== undefined && !next.name) return Response.json({ error: "course_name_required" }, { status: 400 });
  if (next.basePriceSek !== undefined && (!Number.isInteger(next.basePriceSek) || next.basePriceSek < 0)) return Response.json({ error: "invalid_price" }, { status: 400 });
  if (next.campaignPriceSek !== undefined && next.campaignPriceSek !== null && (!Number.isInteger(next.campaignPriceSek) || next.campaignPriceSek < 0)) return Response.json({ error: "invalid_campaign_price" }, { status: 400 });
  if (next.vatRate !== undefined && (!Number.isFinite(next.vatRate) || next.vatRate < 0 || next.vatRate > 1)) return Response.json({ error: "invalid_vat_rate" }, { status: 400 });
  if (next.validityMonths !== undefined && next.validityMonths !== null && (!Number.isInteger(next.validityMonths) || next.validityMonths < 1)) return Response.json({ error: "invalid_validity" }, { status: 400 });
  if (next.estimatedMinutes !== undefined && (!Number.isInteger(next.estimatedMinutes) || next.estimatedMinutes < 0)) return Response.json({ error: "invalid_estimated_minutes" }, { status: 400 });
  await db.update(courses).set(next).where(eq(courses.id, id));
  if (next.name !== undefined || next.basePriceSek !== undefined)
    await db.update(products).set({
      ...(next.name === undefined ? {} : { name: next.name }),
      ...(next.basePriceSek === undefined ? {} : { priceSek: next.basePriceSek }),
    }).where(eq(products.courseId, id));
  await db.insert(auditLogs).values({ id: crypto.randomUUID(), actorUserId: actor.id, targetType: "course", targetId: id, action: "course.updated", beforeJson: JSON.stringify({ status: current.status, name: current.name }), afterJson: JSON.stringify({ status: next.status ?? current.status, name: next.name ?? current.name }), ipHash: null, userAgent: null });
  return Response.json({ course: { ...current, ...next } });
}
