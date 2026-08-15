import { mutationChanges } from "@/lib/db-compat";
import { and, eq, inArray, or } from "drizzle-orm";
import { envString } from "@/lib/runtime-env";
import { getDb } from "@/db";
import { auditLogs, courseLicenses, enrollments, orderItems, orders, payments } from "@/db/schema";
import { fulfillPaidOrder } from "@/lib/order-fulfillment";
import { isConfirmedStripePayment, isFullStripeRefund, stripeEventAmountSek } from "@/lib/stripe";
import { consumeReservedDiscountUse, releaseDiscountUse, restoreConsumedDiscountUse } from "@/lib/discounts";

export const dynamic = "force-dynamic";

type StripeEvent = {
  type?: string;
  data?: {
    object?: {
      id?: string;
      payment_intent?: string;
      client_reference_id?: string;
      amount_total?: number;
      amount_received?: number;
      currency?: string;
      payment_status?: string;
      amount?: number;
      amount_refunded?: number;
      refunded?: boolean;
      metadata?: { order_id?: string };
    };
  };
};

export async function POST(request: Request) {
  const raw = await request.text();
  const secret = envString("STRIPE_WEBHOOK_SECRET");
  const signature = request.headers.get("stripe-signature");
  if (
    !secret ||
    !signature ||
    !(await verifyStripeSignature(raw, signature, secret))
  )
    return Response.json({ error: "invalid_webhook" }, { status: 400 });
  let event: StripeEvent;
  try {
    event = JSON.parse(raw);
  } catch {
    return Response.json({ error: "invalid_json" }, { status: 400 });
  }
  const refundEvent = isFullStripeRefund(event);
  const checkoutExpired = event.type === "checkout.session.expired";
  if (!refundEvent && !checkoutExpired &&
    !event.type?.includes("checkout.session.completed") &&
    !event.type?.includes("payment_intent.succeeded"))
    return Response.json({ received: true });
  const object = event.data?.object ?? {};
  const db = getDb();
  const orderReference = object.metadata?.order_id ?? object.client_reference_id;
  const orderRows = orderReference
    ? await db.select().from(orders).where(eq(orders.id, orderReference)).limit(1)
    : object.payment_intent
      ? await db.select().from(orders).where(or(eq(orders.stripePaymentIntentId, object.payment_intent), eq(orders.stripeCheckoutSessionId, object.id ?? ""))).limit(1)
      : [];
  const order = orderRows[0];
  if (!order)
    return Response.json({ error: "order_not_found" }, { status: 404 });
  if (checkoutExpired) {
    const cancelled = await db
      .update(orders)
      .set({ status: "cancelled", updatedAt: new Date().toISOString() })
      .where(and(eq(orders.id, order.id), eq(orders.status, "checkout_pending")))
      ;
    if ((mutationChanges(cancelled) ?? 0) === 1 && order.discountCodeId)
      await releaseDiscountUse(db, order.discountCodeId);
    return Response.json({ received: true, cancelled: (mutationChanges(cancelled) ?? 0) === 1 });
  }
  if (refundEvent) {
    if (object.currency?.toLowerCase() !== "sek" || object.amount_refunded !== order.totalSek * 100)
      return Response.json({ error: "refund_amount_mismatch" }, { status: 409 });
    const refundClaim = await db
      .update(orders)
      .set({ status: "refunded", updatedAt: new Date().toISOString() })
      .where(
        and(
          eq(orders.id, order.id),
          inArray(orders.status, ["paid", "payment_processing", "checkout_pending"]),
        ),
      )
      ;
    if ((mutationChanges(refundClaim) ?? 0) !== 1) {
      const current = (await db.select({ status: orders.status }).from(orders).where(eq(orders.id, order.id)).limit(1))[0];
      if (current?.status === "refunded") return Response.json({ received: true, idempotent: true });
      return Response.json({ error: "order_not_refundable" }, { status: 409 });
    }
    const items = await db.select().from(orderItems).where(eq(orderItems.orderId, order.id));
    const itemIds = items.map((item) => item.id);
    if (itemIds.length) {
      await db.update(enrollments).set({ status: "cancelled", updatedAt: new Date().toISOString() }).where(inArray(enrollments.orderItemId, itemIds));
      await db.update(courseLicenses).set({ status: "revoked", updatedAt: new Date().toISOString() }).where(inArray(courseLicenses.orderItemId, itemIds));
    }
    if (order.status === "checkout_pending" && order.discountCodeId)
      await releaseDiscountUse(db, order.discountCodeId);
    await db.update(payments).set({ status: "refunded", rawEventJson: raw, updatedAt: new Date().toISOString() }).where(eq(payments.orderId, order.id));
    await db.insert(auditLogs).values({ id: crypto.randomUUID(), actorUserId: null, targetType: "order", targetId: order.id, action: "order.refunded", beforeJson: JSON.stringify({ status: order.status }), afterJson: JSON.stringify({ status: "refunded", amountSek: order.totalSek }), ipHash: null, userAgent: null });
    return Response.json({ received: true, refunded: true });
  }
  if (order.status === "paid")
    return Response.json({ received: true, idempotent: true });
  if (!isConfirmedStripePayment(event))
    return Response.json({ error: "payment_not_confirmed" }, { status: 409 });
  const amountSek = stripeEventAmountSek(event);
  if (
    amountSek !== order.totalSek * 100 ||
    object.currency?.toLowerCase() !== "sek"
  )
    return Response.json({ error: "payment_amount_mismatch" }, { status: 409 });
  const now = new Date().toISOString();
  const claim = await db
    .update(orders)
    .set({
      status: "payment_processing",
      stripeCheckoutSessionId: object.id ?? order.stripeCheckoutSessionId,
      stripePaymentIntentId: object.payment_intent ?? object.id ?? order.stripePaymentIntentId,
      updatedAt: now,
    })
    .where(and(eq(orders.id, order.id), eq(orders.status, "checkout_pending")))
    ;
  if ((mutationChanges(claim) ?? 0) !== 1) {
    const current = (await db.select().from(orders).where(eq(orders.id, order.id)).limit(1))[0];
    if (current?.status === "paid")
      return Response.json({ received: true, idempotent: true });
    if (current?.status === "payment_processing")
      return Response.json({ received: true, processing: true }, { status: 202 });
    return Response.json({ error: "order_not_processable" }, { status: 409 });
  }
  const discountConsumed = order.discountCodeId
    ? await consumeReservedDiscountUse(db, order.discountCodeId)
    : false;
  if (order.discountCodeId && !discountConsumed) {
    await db.update(orders).set({ status: "checkout_pending", updatedAt: new Date().toISOString() }).where(and(eq(orders.id, order.id), eq(orders.status, "payment_processing")));
    return Response.json({ error: "discount_code_consumption_failed" }, { status: 409 });
  }
  try {
    await fulfillPaidOrder(db, { ...order, status: "payment_processing" });
  } catch {
    if (discountConsumed) await restoreConsumedDiscountUse(db, order.discountCodeId!);
    await db
      .update(orders)
      .set({ status: "checkout_pending", updatedAt: new Date().toISOString() })
      .where(and(eq(orders.id, order.id), eq(orders.status, "payment_processing")));
    return Response.json({ error: "fulfillment_failed" }, { status: 500 });
  }
  const settled = await db
    .update(orders)
    .set({
      status: "paid",
      stripeCheckoutSessionId: object.id ?? null,
      stripePaymentIntentId: object.payment_intent ?? object.id ?? null,
      updatedAt: new Date().toISOString(),
    })
    .where(and(eq(orders.id, order.id), eq(orders.status, "payment_processing")));
  if ((mutationChanges(settled) ?? 0) !== 1) {
    const current = (await db.select({ status: orders.status }).from(orders).where(eq(orders.id, order.id)).limit(1))[0];
    return Response.json({ received: true, status: current?.status ?? "unknown" });
  }
  const providerReference = object.id ?? null;
  const existingPayment = await db
    .select()
    .from(payments)
    .where(eq(payments.orderId, order.id))
    .limit(1);
  if (existingPayment[0]) {
    await db
      .update(payments)
      .set({
        status: "paid",
        providerReference,
        amountSek: order.totalSek,
        paidAt: new Date().toISOString(),
        rawEventJson: raw,
        updatedAt: new Date().toISOString(),
      })
      .where(eq(payments.id, existingPayment[0].id));
  } else {
    await db.insert(payments).values({
      id: crypto.randomUUID(),
      orderId: order.id,
      provider: "stripe",
      status: "paid",
      providerReference,
      amountSek: order.totalSek,
      paidAt: new Date().toISOString(),
      rawEventJson: raw,
    });
  }
  return Response.json({ received: true });
}

async function verifyStripeSignature(
  payload: string,
  header: string,
  secret: string,
) {
  const timestamp = header
    .split(",")
    .map((part) => part.trim())
    .find((part) => part.startsWith("t="))
    ?.slice(2);
  const expected = header
    .split(",")
    .map((part) => part.trim())
    .filter((part) => part.startsWith("v1="))
    .map((part) => part.slice(3));
  const tolerance = Number(
    envString("WEBHOOK_SIGNING_TOLERANCE_SECONDS") ?? "300",
  );
  if (
    !timestamp ||
    !expected.length ||
    !Number.isFinite(Number(timestamp)) ||
    Math.abs(Date.now() / 1000 - Number(timestamp)) > tolerance
  )
    return false;
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["verify"],
  );
  const encoded = new TextEncoder().encode(`${timestamp}.${payload}`);
  for (const value of expected) {
    if (!/^[a-f0-9]{64}$/i.test(value)) continue;
    const bytes = new Uint8Array(
      value.match(/.{2}/g)!.map((pair) => Number.parseInt(pair, 16)),
    );
    if (await crypto.subtle.verify("HMAC", key, bytes, encoded)) return true;
  }
  return false;
}
