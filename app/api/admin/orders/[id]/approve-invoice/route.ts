import { mutationChanges } from "@/lib/db-compat";
import { and, eq } from "drizzle-orm";
import { getDb } from "@/db";
import { auditLogs, orders, payments } from "@/db/schema";
import { ensureDbUser, requireMutationIdentity, requirePermission, requestMetadata } from "@/lib/server-auth";
import { fulfillPaidOrder } from "@/lib/order-fulfillment";
import { consumeReservedDiscountUse, restoreConsumedDiscountUse } from "@/lib/discounts";

export const dynamic = "force-dynamic";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const identity = await requireMutationIdentity(request);
  if (identity instanceof Response) return identity;
  const { id } = await context.params;
  const db = getDb();
  const actor = await ensureDbUser(db, identity);
  requirePermission(actor.role, "order:write");
  const order = (await db.select().from(orders).where(eq(orders.id, id)).limit(1))[0];
  if (!order || !order.companyId) return Response.json({ error: "invoice_order_not_found" }, { status: 404 });
  if (order.status === "paid") return Response.json({ ok: true, status: "paid", idempotent: true });
  if (order.status !== "invoice_pending") return Response.json({ error: "invoice_order_not_processable" }, { status: 409 });
  const claim = await db.update(orders).set({ status: "payment_processing", updatedAt: new Date().toISOString() }).where(and(eq(orders.id, id), eq(orders.status, "invoice_pending")));
  if ((mutationChanges(claim) ?? 0) !== 1) {
    const current = (await db.select({ status: orders.status }).from(orders).where(eq(orders.id, id)).limit(1))[0];
    if (current?.status === "paid") return Response.json({ ok: true, status: "paid", idempotent: true });
    return Response.json({ error: "invoice_order_processing" }, { status: 409 });
  }
  const discountConsumed = order.discountCodeId
    ? await consumeReservedDiscountUse(db, order.discountCodeId)
    : false;
  if (order.discountCodeId && !discountConsumed) {
    await db.update(orders).set({ status: "invoice_pending", updatedAt: new Date().toISOString() }).where(and(eq(orders.id, id), eq(orders.status, "payment_processing")));
    return Response.json({ error: "discount_code_consumption_failed" }, { status: 409 });
  }
  try {
    await fulfillPaidOrder(db, { ...order, status: "payment_processing" });
  } catch {
    if (discountConsumed) await restoreConsumedDiscountUse(db, order.discountCodeId!);
    await db.update(orders).set({ status: "invoice_pending", updatedAt: new Date().toISOString() }).where(and(eq(orders.id, id), eq(orders.status, "payment_processing")));
    return Response.json({ error: "invoice_fulfillment_failed" }, { status: 500 });
  }
  const settled = await db.update(orders).set({ status: "paid", updatedAt: new Date().toISOString() }).where(and(eq(orders.id, id), eq(orders.status, "payment_processing")));
  if ((mutationChanges(settled) ?? 0) !== 1) {
    const current = (await db.select({ status: orders.status }).from(orders).where(eq(orders.id, id)).limit(1))[0];
    return Response.json({ ok: true, status: current?.status ?? "unknown" });
  }
  await db.update(payments).set({ status: "paid", paidAt: new Date().toISOString(), updatedAt: new Date().toISOString() }).where(and(eq(payments.orderId, id), eq(payments.provider, "invoice")));
  const metadata = await requestMetadata();
  await db.insert(auditLogs).values({ id: crypto.randomUUID(), actorUserId: actor.id, targetType: "order", targetId: id, action: "invoice.approved", beforeJson: JSON.stringify({ status: "invoice_pending" }), afterJson: JSON.stringify({ status: "paid" }), ipHash: metadata.ip, userAgent: metadata.userAgent });
  return Response.json({ ok: true, status: "paid" });
}
