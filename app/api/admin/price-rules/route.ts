import { eq } from "drizzle-orm";
import { getChatGPTUser } from "@/app/chatgpt-auth";
import { getDb } from "@/db";
import { auditLogs, courses, priceRules } from "@/db/schema";
import { ensureDbUser, requirePermission } from "@/lib/server-auth";
import { sameOriginGuard } from "@/lib/request-security";

export const dynamic = "force-dynamic";

export async function GET() {
  const identity = await getChatGPTUser();
  if (!identity) return Response.json({ error: "authentication_required" }, { status: 401 });
  const db = getDb();
  const actor = await ensureDbUser(db, identity);
  requirePermission(actor.role, "course:read");
  return Response.json({ rules: await db.select().from(priceRules) });
}

export async function POST(request: Request) {
  const originError = sameOriginGuard(request);
  if (originError) return originError;
  const identity = await getChatGPTUser();
  if (!identity) return Response.json({ error: "authentication_required" }, { status: 401 });
  const input = await request.json() as Partial<typeof priceRules.$inferInsert>;
  const minQuantity = typeof input.minQuantity === "number" ? input.minQuantity : 0;
  const label = input.label?.trim() ?? "";
  if (!input.courseId || !Number.isInteger(minQuantity) || minQuantity < 1 || (input.maxQuantity !== null && input.maxQuantity !== undefined && (!Number.isInteger(input.maxQuantity) || input.maxQuantity < minQuantity)) || !label)
    return Response.json({ error: "invalid_price_rule" }, { status: 400 });
  if (input.discountPercent !== null && input.discountPercent !== undefined && (!Number.isInteger(input.discountPercent) || input.discountPercent < 0 || input.discountPercent > 100))
    return Response.json({ error: "invalid_discount_percent" }, { status: 400 });
  if (input.fixedUnitPriceSek !== null && input.fixedUnitPriceSek !== undefined && (!Number.isInteger(input.fixedUnitPriceSek) || input.fixedUnitPriceSek < 0))
    return Response.json({ error: "invalid_fixed_unit_price" }, { status: 400 });
  if (input.discountPercent !== null && input.discountPercent !== undefined && input.fixedUnitPriceSek !== null && input.fixedUnitPriceSek !== undefined)
    return Response.json({ error: "price_rule_values_are_mutually_exclusive" }, { status: 400 });
  if (input.discountPercent == null && input.fixedUnitPriceSek == null)
    return Response.json({ error: "price_rule_value_required" }, { status: 400 });
  const db = getDb();
  const actor = await ensureDbUser(db, identity);
  requirePermission(actor.role, "course:write");
  const course = (await db.select({ id: courses.id }).from(courses).where(eq(courses.id, input.courseId)).limit(1))[0];
  if (!course) return Response.json({ error: "course_not_found" }, { status: 404 });
  const rule = { id: crypto.randomUUID(), courseId: input.courseId, minQuantity, maxQuantity: input.maxQuantity ?? null, discountPercent: input.discountPercent ?? null, fixedUnitPriceSek: input.fixedUnitPriceSek ?? null, label, active: input.active ?? true };
  await db.insert(priceRules).values(rule);
  await db.insert(auditLogs).values({ id: crypto.randomUUID(), actorUserId: actor.id, targetType: "price_rule", targetId: rule.id, action: "price_rule.created", beforeJson: null, afterJson: JSON.stringify({ courseId: rule.courseId, minQuantity: rule.minQuantity, maxQuantity: rule.maxQuantity, discountPercent: rule.discountPercent, fixedUnitPriceSek: rule.fixedUnitPriceSek }), ipHash: null, userAgent: null });
  return Response.json({ rule }, { status: 201 });
}

export async function PATCH(request: Request) {
  const originError = sameOriginGuard(request);
  if (originError) return originError;
  const identity = await getChatGPTUser();
  if (!identity) return Response.json({ error: "authentication_required" }, { status: 401 });
  const input = await request.json() as { id?: string; active?: boolean };
  if (!input.id || typeof input.active !== "boolean") return Response.json({ error: "invalid_price_rule_update" }, { status: 400 });
  const db = getDb();
  const actor = await ensureDbUser(db, identity);
  requirePermission(actor.role, "course:write");
  await db.update(priceRules).set({ active: input.active }).where(eq(priceRules.id, input.id));
  return Response.json({ ok: true });
}
