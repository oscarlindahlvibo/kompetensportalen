import { eq } from "drizzle-orm";
import { getDb } from "@/db";
import { discountCodes } from "@/db/schema";
import { ensureDbUser, requireApiIdentity, requireMutationIdentity, requirePermission } from "@/lib/server-auth";

export const dynamic = "force-dynamic";

export async function GET() {
  const identity = await requireApiIdentity();
  if (identity instanceof Response) return identity;
  const db = getDb();
  const actor = await ensureDbUser(db, identity);
  requirePermission(actor.role, "course:read");
  return Response.json({ codes: await db.select().from(discountCodes) });
}

export async function POST(request: Request) {
  const identity = await requireMutationIdentity(request);
  if (identity instanceof Response) return identity;
  const body = await request.json() as Partial<typeof discountCodes.$inferInsert>;
  const codeValue = body.code?.trim().toUpperCase() ?? "";
  const value = typeof body.value === "number" ? body.value : 0;
  if (!/^[A-Z0-9_-]{2,64}$/.test(codeValue) || (body.type !== "percent" && body.type !== "fixed") || !Number.isInteger(value) || value < 1)
    return Response.json({ error: "invalid_discount_code" }, { status: 400 });
  if (body.type === "percent" && value > 100)
    return Response.json({ error: "percent_must_be_100_or_less" }, { status: 400 });
  if (body.maxUses !== null && body.maxUses !== undefined && (!Number.isInteger(body.maxUses) || body.maxUses < 1))
    return Response.json({ error: "invalid_max_uses" }, { status: 400 });
  if (body.minimumOrderSek !== null && body.minimumOrderSek !== undefined && (!Number.isInteger(body.minimumOrderSek) || body.minimumOrderSek < 0))
    return Response.json({ error: "invalid_minimum_order" }, { status: 400 });
  const startsAt = body.startsAt ?? null;
  const endsAt = body.endsAt ?? null;
  if ((startsAt && !Number.isFinite(Date.parse(startsAt))) || (endsAt && !Number.isFinite(Date.parse(endsAt))) || (startsAt && endsAt && Date.parse(endsAt) < Date.parse(startsAt)))
    return Response.json({ error: "invalid_discount_dates" }, { status: 400 });
  let courseIdsJson = "[]";
  try {
    const courseIds = body.courseIdsJson ? JSON.parse(body.courseIdsJson) : [];
    if (!Array.isArray(courseIds) || courseIds.some((courseId) => typeof courseId !== "string" || !courseId.trim()))
      return Response.json({ error: "invalid_course_scope" }, { status: 400 });
    courseIdsJson = JSON.stringify(courseIds);
  } catch {
    return Response.json({ error: "invalid_course_scope" }, { status: 400 });
  }
  const db = getDb();
  const actor = await ensureDbUser(db, identity);
  requirePermission(actor.role, "course:write");
  const code = { id: crypto.randomUUID(), code: codeValue, type: body.type, value, startsAt, endsAt, maxUses: body.maxUses ?? null, uses: 0, courseIdsJson, minimumOrderSek: body.minimumOrderSek ?? null, active: body.active ?? true };
  try {
    await db.insert(discountCodes).values(code);
  } catch {
    return Response.json({ error: "discount_code_already_exists" }, { status: 409 });
  }
  return Response.json({ code }, { status: 201 });
}

export async function PATCH(request: Request) {
  const identity = await requireMutationIdentity(request);
  if (identity instanceof Response) return identity;
  const body = await request.json() as { id?: string; active?: boolean };
  if (!body.id || typeof body.active !== "boolean") return Response.json({ error: "invalid_discount_update" }, { status: 400 });
  const db = getDb();
  const actor = await ensureDbUser(db, identity);
  requirePermission(actor.role, "course:write");
  await db.update(discountCodes).set({ active: body.active }).where(eq(discountCodes.id, body.id));
  return Response.json({ ok: true });
}
