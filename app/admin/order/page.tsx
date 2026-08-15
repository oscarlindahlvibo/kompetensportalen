import { desc, eq } from "drizzle-orm";
import { requireChatGPTUser } from "@/app/chatgpt-auth";
import { PageShell } from "@/app/components/site-chrome";
import { getDb } from "@/db";
import { companies, orders, users } from "@/db/schema";
import { ensureDbUser, requirePermission } from "@/lib/server-auth";
import OrderManager from "@/app/admin/order/order-manager";

export const dynamic = "force-dynamic";

export default async function OrdersPage() {
  const identity = await requireChatGPTUser("/admin/order");
  const db = getDb();
  const actor = await ensureDbUser(db, identity);
  requirePermission(actor.role, "order:read");
  const rows = await db.select({ order: orders, buyer: users, company: companies }).from(orders).leftJoin(users, eq(users.id, orders.buyerUserId)).leftJoin(companies, eq(companies.id, orders.companyId)).orderBy(desc(orders.createdAt));
  return <PageShell><section className="subpage-hero admin-hero"><p className="eyebrow">Administration · Försäljning</p><h1>Order och<br />betalningar.</h1><p>Betalda, väntande och fakturerade order. Utbildningsplatser aktiveras först enligt betalningsstatus och företagsregler.</p></section><section className="section admin-table-section"><div className="section-heading"><div><p className="eyebrow">Order</p><h2>{rows.length} order</h2></div></div><OrderManager initialRows={rows.map(({ order, buyer, company }) => ({ id: order.id, shortId: order.id.slice(0, 8).toUpperCase(), buyer: buyer?.email ?? company?.contactEmail ?? "-", buyerType: order.buyerType, status: order.status, totalSek: order.totalSek, createdAt: order.createdAt }))} /></section></PageShell>;
}
