import { and, desc, eq } from "drizzle-orm";
import { getDb } from "@/db";
import { companies, companyMembers, courseVersions, courses, discountCodes, orders, orderItems, payments, priceRules, products } from "@/db/schema";
import { calculateOrderTotals, effectiveCoursePrice, parseCourseIds } from "@/lib/platform";
import { ensureDbUser, requireApiIdentity } from "@/lib/server-auth";
import { ensureApvCatalog } from "@/lib/catalog";
import { fulfillPaidOrder, shouldActivateInvoiceLicenses } from "@/lib/order-fulfillment";
import { releaseDiscountUse, reserveDiscountUse } from "@/lib/discounts";
import { rateLimit } from "@/lib/rate-limit";
import { sameOriginGuard } from "@/lib/request-security";
import { envString } from "@/lib/runtime-env";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const originError = sameOriginGuard(request);
  if (originError) return originError;
  const limited = rateLimit(request, "order", 20);
  if (limited) return limited;
  const user = await requireApiIdentity();
  if (user instanceof Response) return user;
  const body = await request.json() as { courseId?: string; courseSlug?: string; quantity?: number; companyId?: string; discountCode?: string; paymentMethod?: "stripe" | "invoice" };
  if (!body.courseId && !body.courseSlug) return Response.json({ error: "course_required" }, { status: 400 });
  const quantity = body.quantity ?? 1;
  if (!Number.isInteger(quantity) || quantity < 1 || quantity > 10000) return Response.json({ error: "invalid_quantity" }, { status: 400 });
  const db = getDb();
  await ensureApvCatalog(db);
  const dbUser = await ensureDbUser(db, user);
  let company: typeof companies.$inferSelect | null = null;
  if (body.companyId) {
    company = (await db.select().from(companies).where(eq(companies.id, body.companyId)).limit(1))[0] ?? null;
    const membership = await db.select().from(companyMembers).where(and(eq(companyMembers.companyId, body.companyId), eq(companyMembers.userId, dbUser.id), eq(companyMembers.role, "admin"))).limit(1);
    if (!company || !membership[0]) return Response.json({ error: "company_access_denied" }, { status: 403 });
  }
  const rows = await db.select({ course: courses, product: products }).from(courses).leftJoin(products, and(eq(products.courseId, courses.id), eq(products.active, true))).where(body.courseId ? eq(courses.id, body.courseId) : eq(courses.slug, body.courseSlug!)).limit(1);
  const row = rows[0];
  if (!row || row.course.status !== "published") return Response.json({ error: "course_not_purchasable" }, { status: 400 });
  const version = (await db.select().from(courseVersions).where(and(eq(courseVersions.courseId, row.course.id), eq(courseVersions.status, "published"))).orderBy(desc(courseVersions.publishedAt), desc(courseVersions.createdAt)).limit(1))[0];
  if (!version) return Response.json({ error: "published_version_missing" }, { status: 409 });
  const rules = await db.select().from(priceRules).where(and(eq(priceRules.active, true), eq(priceRules.courseId, row.course.id)));
  const rule = rules.filter((candidate) => quantity >= candidate.minQuantity && (candidate.maxQuantity === null || quantity <= candidate.maxQuantity)).sort((a, b) => b.minQuantity - a.minQuantity)[0];
  const unitPriceSek = rule?.fixedUnitPriceSek ?? effectiveCoursePrice(row.course, row.product?.priceSek ?? row.course.basePriceSek);
  const automaticDiscount = rule?.discountPercent ? Math.round(unitPriceSek * quantity * rule.discountPercent / 100) : 0;
  let codeDiscount = 0;
  let discountCodeId: string | null = null;
  if (body.discountCode) {
    const codeRows = await db.select().from(discountCodes).where(and(eq(discountCodes.code, body.discountCode.trim().toUpperCase()), eq(discountCodes.active, true))).limit(1);
    const code = codeRows[0];
    const now = Date.now();
    const inWindow = code && (!code.startsAt || Date.parse(code.startsAt) <= now) && (!code.endsAt || Date.parse(code.endsAt) >= now) && (code.maxUses === null || code.uses < code.maxUses) && (!code.minimumOrderSek || unitPriceSek * quantity >= code.minimumOrderSek);
    const allowedCourses = parseCourseIds(code?.courseIdsJson);
    if (inWindow && (!allowedCourses.length || allowedCourses.includes(row.course.id))) { codeDiscount = code.type === "percent" ? Math.round(unitPriceSek * quantity * code.value / 100) : code.value; discountCodeId = code.id; }
  }
  const totals = calculateOrderTotals({ unitPriceSek, quantity, discountSek: automaticDiscount + codeDiscount, vatRate: row.course.vatRate });
  const orderId = crypto.randomUUID();
  const itemId = crypto.randomUUID();
  if (!row.product) return Response.json({ error: "product_not_configured" }, { status: 503 });
  const invoiceOrder = body.paymentMethod === "invoice";
  if (invoiceOrder && (!company || !company.invoicePurchaseEnabled)) return Response.json({ error: "invoice_purchase_not_enabled" }, { status: 403 });
  const orderStatus = invoiceOrder ? "invoice_pending" : "checkout_pending";
  const discountReserved = discountCodeId ? await reserveDiscountUse(db, discountCodeId) : false;
  if (discountCodeId && !discountReserved) return Response.json({ error: "discount_code_unavailable" }, { status: 409 });
  try {
    await db.insert(orders).values({ id: orderId, buyerUserId: dbUser.id, companyId: body.companyId ?? null, buyerType: body.companyId ? "company" : "private", status: orderStatus, discountCodeId, ...totals });
    await db.insert(orderItems).values({ id: itemId, orderId, productId: row.product.id, courseId: row.course.id, courseVersionId: version.id, quantity, unitPriceSek, discountSek: totals.discountSek });
  } catch (error) {
    if (discountReserved) await releaseDiscountUse(db, discountCodeId!);
    await db.delete(orders).where(eq(orders.id, orderId));
    throw error;
  }
  if (invoiceOrder) {
    await db.insert(payments).values({ id: crypto.randomUUID(), orderId, provider: "invoice", status: "pending", amountSek: totals.totalSek });
    let licensesActivatedImmediately = false;
    if (shouldActivateInvoiceLicenses(company)) {
      const invoiceOrderRow = (await db.select().from(orders).where(eq(orders.id, orderId)).limit(1))[0];
      if (invoiceOrderRow) {
        await fulfillPaidOrder(db, invoiceOrderRow);
        licensesActivatedImmediately = true;
      }
    }
    return Response.json({ orderId, status: orderStatus, totals, payment: { provider: "invoice", approvalRequired: true, licensesActivatedImmediately } }, { status: 201 });
  }
  const stripeKey = envString("STRIPE_SECRET_KEY");
  if (!stripeKey) {
    if (discountReserved) await releaseDiscountUse(db, discountCodeId!);
    await db.update(orders).set({ status: "cancelled", updatedAt: new Date().toISOString() }).where(eq(orders.id, orderId));
    return Response.json({ orderId, status: "cancelled", totals, payment: { provider: "stripe", configurationRequired: true } }, { status: 201 });
  }
  const form = new URLSearchParams({ mode: "payment", success_url: `${request.headers.get("origin") ?? "https://kompetensportalen.se"}/mina-sidor?order=${orderId}`, cancel_url: `${request.headers.get("origin") ?? "https://kompetensportalen.se"}/utbildningar/${row.course.slug}`, client_reference_id: orderId, "metadata[order_id]": orderId, "line_items[0][quantity]": "1", "line_items[0][price_data][currency]": "sek", "line_items[0][price_data][unit_amount]": String(totals.totalSek * 100), "line_items[0][price_data][product_data][name]": `${row.product.name} (${quantity} plats${quantity === 1 ? "" : "er"})` });
  const stripeResponse = await fetch("https://api.stripe.com/v1/checkout/sessions", { method: "POST", headers: { Authorization: `Bearer ${stripeKey}`, "Content-Type": "application/x-www-form-urlencoded" }, body: form });
  if (!stripeResponse.ok) {
    if (discountReserved) await releaseDiscountUse(db, discountCodeId!);
    await db.update(orders).set({ status: "cancelled", updatedAt: new Date().toISOString() }).where(eq(orders.id, orderId));
    return Response.json({ orderId, status: "cancelled", totals, payment: { provider: "stripe", configurationRequired: false, error: "checkout_session_failed" } }, { status: 502 });
  }
  const session = await stripeResponse.json() as { id?: string; url?: string };
  await db.update(orders).set({ stripeCheckoutSessionId: session.id ?? null }).where(eq(orders.id, orderId));
  return Response.json({ orderId, status: "checkout_pending", totals, payment: { provider: "stripe", url: session.url, sessionId: session.id } }, { status: 201 });
}
