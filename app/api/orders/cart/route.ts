import { and, desc, eq } from "drizzle-orm";
import { getDb } from "@/db";
import { companies, companyMembers, courseVersions, courses, discountCodes, orderItems, orders, payments, priceRules, products } from "@/db/schema";
import { ensureApvCatalog } from "@/lib/catalog";
import { allocateCartDiscounts, calculateCartTotals, effectiveCoursePrice, parseCourseIds } from "@/lib/platform";
import { ensureDbUser, requireApiIdentity } from "@/lib/server-auth";
import { fulfillPaidOrder, shouldActivateInvoiceLicenses } from "@/lib/order-fulfillment";
import { releaseDiscountUse, reserveDiscountUse } from "@/lib/discounts";
import { rateLimit } from "@/lib/rate-limit";
import { sameOriginGuard } from "@/lib/request-security";
import { envString } from "@/lib/runtime-env";

export const dynamic = "force-dynamic";
type CartItem = { courseId?: string; courseSlug?: string; quantity?: number };

export async function POST(request: Request) {
  const originError = sameOriginGuard(request);
  if (originError) return originError;
  const limited = rateLimit(request, "cart-order", 20);
  if (limited) return limited;
  const identity = await requireApiIdentity();
  if (identity instanceof Response) return identity;
  const body = await request.json() as { items?: CartItem[]; discountCode?: string; companyId?: string; paymentMethod?: "stripe" | "invoice" };
  if (!body.items?.length || body.items.length > 100) return Response.json({ error: "cart_items_required" }, { status: 400 });
  const db = getDb();
  await ensureApvCatalog(db);
  const user = await ensureDbUser(db, identity);
  let company: typeof companies.$inferSelect | null = null;
  if (body.companyId) {
    company = (await db.select().from(companies).where(eq(companies.id, body.companyId)).limit(1))[0] ?? null;
    const membership = await db.select().from(companyMembers).where(and(eq(companyMembers.companyId, body.companyId), eq(companyMembers.userId, user.id), eq(companyMembers.role, "admin"))).limit(1);
    if (!company || !membership[0]) return Response.json({ error: "company_access_denied" }, { status: 403 });
  }
  const invoiceOrder = body.paymentMethod === "invoice";
  if (invoiceOrder && (!company || !company.invoicePurchaseEnabled)) return Response.json({ error: "invoice_purchase_not_enabled" }, { status: 403 });
  const normalized = [] as { course: typeof courses.$inferSelect; product: typeof products.$inferSelect; version: typeof courseVersions.$inferSelect; quantity: number; unitPriceSek: number; discountSek: number }[];
  for (const item of body.items) {
    const quantity = item.quantity ?? 1;
    if (!Number.isInteger(quantity) || quantity < 1 || quantity > 10000) return Response.json({ error: "invalid_quantity" }, { status: 400 });
    const rows = await db.select({ course: courses, product: products }).from(courses).leftJoin(products, and(eq(products.courseId, courses.id), eq(products.active, true))).where(item.courseId ? eq(courses.id, item.courseId) : eq(courses.slug, item.courseSlug ?? "")).limit(1);
    const row = rows[0];
    if (!row || row.course.status !== "published" || !row.product) return Response.json({ error: "course_not_purchasable" }, { status: 400 });
    const version = (await db.select().from(courseVersions).where(and(eq(courseVersions.courseId, row.course.id), eq(courseVersions.status, "published"))).orderBy(desc(courseVersions.publishedAt), desc(courseVersions.createdAt)).limit(1))[0];
    if (!version) return Response.json({ error: "published_version_missing" }, { status: 409 });
    const rules = await db.select().from(priceRules).where(and(eq(priceRules.active, true), eq(priceRules.courseId, row.course.id)));
    const rule = rules.filter((candidate) => quantity >= candidate.minQuantity && (candidate.maxQuantity === null || quantity <= candidate.maxQuantity)).sort((a, b) => b.minQuantity - a.minQuantity)[0];
    const unitPriceSek = rule?.fixedUnitPriceSek ?? effectiveCoursePrice(row.course, row.product.priceSek);
    const discountSek = rule?.discountPercent ? Math.round(unitPriceSek * quantity * rule.discountPercent / 100) : 0;
    normalized.push({ course: row.course, product: row.product, version, quantity, unitPriceSek, discountSek });
  }
  const subtotalSek = normalized.reduce((total, item) => total + item.unitPriceSek * item.quantity, 0);
  let codeDiscount = 0;
  let discountCodeId: string | null = null;
  if (body.discountCode) {
    const code = (await db.select().from(discountCodes).where(and(eq(discountCodes.code, body.discountCode.trim().toUpperCase()), eq(discountCodes.active, true))).limit(1))[0];
    const now = Date.now();
    const allowedCourses = parseCourseIds(code?.courseIdsJson);
    const courseAllowed = !allowedCourses.length || normalized.every((item) => allowedCourses.includes(item.course.id));
    const valid = code && courseAllowed && (!code.startsAt || Date.parse(code.startsAt) <= now) && (!code.endsAt || Date.parse(code.endsAt) >= now) && (code.maxUses === null || code.uses < code.maxUses) && (!code.minimumOrderSek || subtotalSek >= code.minimumOrderSek);
    if (valid) codeDiscount = code.type === "percent" ? Math.round(subtotalSek * code.value / 100) : code.value;
    if (valid) discountCodeId = code.id;
  }
  const totals = calculateCartTotals(
    normalized.map((item) => ({
      unitPriceSek: item.unitPriceSek,
      quantity: item.quantity,
      automaticDiscountSek: item.discountSek,
      vatRate: item.course.vatRate,
    })),
    codeDiscount,
  );
  const lineDiscounts = allocateCartDiscounts(normalized, codeDiscount);
  const orderLines = normalized.map((item, index) => ({ ...item, totalDiscountSek: lineDiscounts[index] ?? item.discountSek }));
  const orderId = crypto.randomUUID();
  const orderStatus = invoiceOrder ? "invoice_pending" : "checkout_pending";
  const discountReserved = discountCodeId ? await reserveDiscountUse(db, discountCodeId) : false;
  if (discountCodeId && !discountReserved) return Response.json({ error: "discount_code_unavailable" }, { status: 409 });
  try {
    await db.insert(orders).values({ id: orderId, buyerUserId: user.id, companyId: body.companyId ?? null, buyerType: body.companyId ? "company" : "private", status: orderStatus, discountCodeId, ...totals });
    for (const item of orderLines) await db.insert(orderItems).values({ id: crypto.randomUUID(), orderId, productId: item.product.id, courseId: item.course.id, courseVersionId: item.version.id, quantity: item.quantity, unitPriceSek: item.unitPriceSek, discountSek: item.totalDiscountSek });
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
  const stripeSecret = envString("STRIPE_SECRET_KEY");
  if (!stripeSecret) {
    if (discountReserved) await releaseDiscountUse(db, discountCodeId!);
    await db.update(orders).set({ status: "cancelled", updatedAt: new Date().toISOString() }).where(eq(orders.id, orderId));
    return Response.json({ orderId, status: "cancelled", totals, payment: { provider: "stripe", configurationRequired: true } }, { status: 201 });
  }
  const form = new URLSearchParams({ mode: "payment", success_url: `${request.headers.get("origin") ?? "https://kompetensportalen.se"}/mina-sidor?order=${orderId}`, cancel_url: `${request.headers.get("origin") ?? "https://kompetensportalen.se"}/utbildningar`, client_reference_id: orderId, "metadata[order_id]": orderId, "line_items[0][quantity]": "1", "line_items[0][price_data][currency]": "sek", "line_items[0][price_data][unit_amount]": String(totals.totalSek * 100), "line_items[0][price_data][product_data][name]": `Kompetensportalen · ${normalized.length} utbildning${normalized.length === 1 ? "" : "ar"}` });
  const response = await fetch("https://api.stripe.com/v1/checkout/sessions", { method: "POST", headers: { Authorization: `Bearer ${stripeSecret}`, "Content-Type": "application/x-www-form-urlencoded" }, body: form });
  if (!response.ok) {
    if (discountReserved) await releaseDiscountUse(db, discountCodeId!);
    await db.update(orders).set({ status: "cancelled", updatedAt: new Date().toISOString() }).where(eq(orders.id, orderId));
    return Response.json({ orderId, status: "cancelled", totals, payment: { provider: "stripe", error: "checkout_session_failed" } }, { status: 502 });
  }
  const session = await response.json() as { id?: string; url?: string };
  await db.update(orders).set({ stripeCheckoutSessionId: session.id ?? null }).where(eq(orders.id, orderId));
  return Response.json({ orderId, status: "checkout_pending", totals, payment: { provider: "stripe", url: session.url, sessionId: session.id } }, { status: 201 });
}
