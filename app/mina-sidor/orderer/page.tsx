/* eslint-disable @next/next/no-html-link-for-pages */
import { desc, eq } from "drizzle-orm";
import { requireChatGPTUser } from "@/app/chatgpt-auth";
import { PageShell } from "@/app/components/site-chrome";
import { getDb } from "@/db";
import { courses, orderItems, orders } from "@/db/schema";
import { ensureDbUser } from "@/lib/server-auth";

export const dynamic = "force-dynamic";

export default async function OrderHistoryPage() {
  const identity = await requireChatGPTUser("/mina-sidor/orderer");
  const db = getDb();
  const user = await ensureDbUser(db, identity);
  const rows = await db.select({ order: orders, item: orderItems, course: courses }).from(orders).leftJoin(orderItems, eq(orderItems.orderId, orders.id)).leftJoin(courses, eq(courses.id, orderItems.courseId)).where(eq(orders.buyerUserId, user.id)).orderBy(desc(orders.createdAt));
  return <PageShell><section className="subpage-hero account-hero"><p className="eyebrow">Mina sidor · Orderhistorik</p><h1>Dina<br />ordrar.</h1><p>Betalningar, fakturor och köpta platser sparas separat från kursens progress.</p></section><section className="section order-history"><p className="eyebrow">Orderhistorik</p>{rows.length ? rows.map(({ order, item, course }) => <article className="order-row" key={`${order.id}-${item?.id ?? "empty"}`}><div><strong>{order.id.slice(0, 8).toUpperCase()}</strong><span>{order.createdAt}</span></div><span>{item ? `${item.quantity} × ${course?.name ?? "Utbildning"}` : "-"}</span><b>{order.totalSek.toLocaleString("sv-SE")} kr</b><em>{order.status}</em><a className="text-link" href={`/api/orders/${order.id}/receipt`}>Kvitto ↗</a></article>) : <p>Du har inga ordrar ännu.</p>}<a className="text-link" href="/utbildningar">Till kurskatalogen <span>→</span></a></section></PageShell>;
}
