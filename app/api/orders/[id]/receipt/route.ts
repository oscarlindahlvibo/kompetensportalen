import { and, eq } from "drizzle-orm";
import { getDb } from "@/db";
import { companies, companyMembers, courses, orderItems, orders } from "@/db/schema";
import { ensureDbUser, requireApiIdentity } from "@/lib/server-auth";

export const dynamic = "force-dynamic";

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const identity = await requireApiIdentity();
  if (identity instanceof Response) return identity;
  const { id } = await context.params;
  const db = getDb();
  const user = await ensureDbUser(db, identity);
  const order = (await db.select({ order: orders, company: companies }).from(orders).leftJoin(companies, eq(companies.id, orders.companyId)).where(eq(orders.id, id)).limit(1))[0];
  if (!order) return Response.json({ error: "order_not_found" }, { status: 404 });
  const ownsOrder = order.order.buyerUserId === user.id;
  const companyAccess = order.order.companyId
    ? Boolean((await db.select().from(companyMembers).where(and(eq(companyMembers.companyId, order.order.companyId), eq(companyMembers.userId, user.id), eq(companyMembers.role, "admin"))).limit(1))[0])
    : false;
  if (!ownsOrder && !companyAccess) return Response.json({ error: "order_access_denied" }, { status: 403 });
  const items = await db.select({ item: orderItems, course: courses }).from(orderItems).innerJoin(courses, eq(courses.id, orderItems.courseId)).where(eq(orderItems.orderId, id));
  const rows = items.map(({ item, course }) => `<tr><td>${escapeHtml(course.name)}</td><td>${item.quantity}</td><td>${money(item.unitPriceSek)}</td><td>${money(item.unitPriceSek * item.quantity - item.discountSek)}</td></tr>`).join("");
  const html = `<!doctype html><html lang="sv"><head><meta charset="utf-8"><title>Kvitto ${escapeHtml(id.slice(0, 8).toUpperCase())}</title><style>body{font:16px system-ui,sans-serif;max-width:760px;margin:40px auto;color:#17232b}h1{font-size:32px}table{width:100%;border-collapse:collapse;margin:28px 0}th,td{text-align:left;padding:10px;border-bottom:1px solid #d7dee0}td:nth-child(n+2),th:nth-child(n+2){text-align:right}.total{font-size:20px;font-weight:700;text-align:right}.muted{color:#607078}</style></head><body><p class="muted">WPE Sweden AB · Kompetensportalen.se</p><h1>Kvitto</h1><p>Order <strong>${escapeHtml(id)}</strong><br>Datum ${escapeHtml(order.order.createdAt)}<br>Status ${escapeHtml(order.order.status)}</p>${order.company ? `<p>Företag: ${escapeHtml(order.company.name)}<br>${escapeHtml(order.company.organizationNumber)}</p>` : ""}<table><thead><tr><th>Utbildning</th><th>Antal</th><th>Styckpris</th><th>Summa</th></tr></thead><tbody>${rows}</tbody></table><p>Subtotal: ${money(order.order.subtotalSek)}<br>Rabatt: -${money(order.order.discountSek)}<br>Moms: ${money(order.order.vatSek)}</p><p class="total">Totalt: ${money(order.order.totalSek)}</p></body></html>`;
  return new Response(html, { headers: { "content-type": "text/html; charset=utf-8", "content-disposition": `inline; filename="kvitto-${id.slice(0, 8)}.html"` } });
}

function money(value: number) { return `${value.toLocaleString("sv-SE")} kr`; }
function escapeHtml(value: string) { return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#39;"); }
