import { getDb } from "@/db";
import { auditLogs, courses, products } from "@/db/schema";
import { ensureDbUser, requireApiIdentity, requireMutationIdentity, requirePermission } from "@/lib/server-auth";

export const dynamic = "force-dynamic";

type CourseInput = {
  slug?: string;
  name?: string;
  shortDescription?: string;
  fullDescription?: string;
  category?: string;
  basePriceSek?: number;
  campaignPriceSek?: number | null;
  vatRate?: number;
  validityMonths?: number | null;
  estimatedMinutes?: number;
  targetAudience?: string | null;
  prerequisites?: string | null;
  regulatoryFramework?: string | null;
  status?: "draft" | "coming_soon" | "published" | "archived";
  competenceCode?: string | null;
  requiresIdentityVerification?: boolean;
  id06Enabled?: boolean;
  imageUrl?: string | null;
  bannerUrl?: string | null;
  seoTitle?: string | null;
  seoDescription?: string | null;
  tags?: string[];
};

export async function GET() {
  const identity = await requireApiIdentity();
  if (identity instanceof Response) return identity;
  const db = getDb();
  const actor = await ensureDbUser(db, identity);
  requirePermission(actor.role, "course:read");
  const rows = await db.select().from(courses).orderBy(courses.name);
  return Response.json({ courses: rows.map((course) => ({ ...course, tags: JSON.parse(course.tagsJson) })) });
}

export async function POST(request: Request) {
  const identity = await requireMutationIdentity(request);
  if (identity instanceof Response) return identity;
  const input = await request.json() as CourseInput;
  if (!input.slug || !input.name || !input.shortDescription || !input.fullDescription || !input.category) return Response.json({ error: "required_course_fields_missing" }, { status: 400 });
  if (input.status === "published") return Response.json({ error: "direct_publish_not_allowed" }, { status: 400 });
  if (!Number.isInteger(input.basePriceSek) || (input.basePriceSek ?? 0) < 0) return Response.json({ error: "invalid_price" }, { status: 400 });
  if (input.campaignPriceSek !== undefined && input.campaignPriceSek !== null && (!Number.isInteger(input.campaignPriceSek) || input.campaignPriceSek < 0)) return Response.json({ error: "invalid_campaign_price" }, { status: 400 });
  if (input.vatRate !== undefined && (!Number.isFinite(input.vatRate) || input.vatRate < 0 || input.vatRate > 1)) return Response.json({ error: "invalid_vat_rate" }, { status: 400 });
  if (input.validityMonths !== undefined && input.validityMonths !== null && (!Number.isInteger(input.validityMonths) || input.validityMonths < 1)) return Response.json({ error: "invalid_validity" }, { status: 400 });
  if (input.estimatedMinutes !== undefined && (!Number.isInteger(input.estimatedMinutes) || input.estimatedMinutes < 0)) return Response.json({ error: "invalid_estimated_minutes" }, { status: 400 });
  const db = getDb();
  const actor = await ensureDbUser(db, identity);
  requirePermission(actor.role, "course:write");
  const id = crypto.randomUUID();
  const course = { id, slug: input.slug.trim().toLowerCase(), name: input.name.trim(), shortDescription: input.shortDescription.trim(), fullDescription: input.fullDescription.trim(), category: input.category.trim(), status: input.status ?? "draft", basePriceSek: input.basePriceSek!, vatRate: input.vatRate ?? 0.25, campaignPriceSek: input.campaignPriceSek ?? null, validityMonths: input.validityMonths ?? null, estimatedMinutes: input.estimatedMinutes ?? 0, targetAudience: input.targetAudience ?? null, prerequisites: input.prerequisites ?? null, regulatoryFramework: input.regulatoryFramework ?? null, competenceCode: input.competenceCode ?? null, requiresIdentityVerification: input.requiresIdentityVerification ?? false, id06Enabled: input.id06Enabled ?? false, tagsJson: JSON.stringify(input.tags ?? []), imageUrl: input.imageUrl ?? null, bannerUrl: input.bannerUrl ?? null, seoTitle: input.seoTitle ?? null, seoDescription: input.seoDescription ?? null };
  await db.insert(courses).values(course);
  await db.insert(products).values({ id: crypto.randomUUID(), courseId: id, sku: `COURSE-${course.slug.toUpperCase().replace(/[^A-Z0-9]+/g, "-")}`, name: course.name, priceSek: course.basePriceSek, active: true });
  await db.insert(auditLogs).values({ id: crypto.randomUUID(), actorUserId: actor.id, targetType: "course", targetId: id, action: "course.created", beforeJson: null, afterJson: JSON.stringify({ slug: course.slug, status: course.status }), ipHash: null, userAgent: null });
  return Response.json({ course }, { status: 201 });
}
