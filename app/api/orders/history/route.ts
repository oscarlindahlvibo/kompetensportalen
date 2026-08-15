import { desc, eq } from "drizzle-orm";
import { getDb } from "@/db";
import { courses, orderItems, orders } from "@/db/schema";
import { ensureDbUser, requireApiIdentity } from "@/lib/server-auth";

export const dynamic = "force-dynamic";

export async function GET() {
  const identity = await requireApiIdentity();
  if (identity instanceof Response) return identity;
  const db = getDb();
  const user = await ensureDbUser(db, identity);
  const userOrders = await db.select().from(orders).where(eq(orders.buyerUserId, user.id)).orderBy(desc(orders.createdAt));
  const items = userOrders.length ? await db.select({ item: orderItems, course: courses }).from(orderItems).leftJoin(courses, eq(courses.id, orderItems.courseId)) : [];
  return Response.json({ orders: userOrders.map((order) => ({ ...order, items: items.filter((row) => row.item.orderId === order.id).map((row) => ({ ...row.item, courseName: row.course?.name ?? "Utbildning" })) })) });
}
