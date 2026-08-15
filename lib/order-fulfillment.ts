import { mutationChanges } from "@/lib/db-compat";
import { and, desc, eq } from "drizzle-orm";
import {
  courseLicenses,
  courseVersions,
  enrollments,
  orderItems,
  courses,
  orders,
} from "@/db/schema";
import { getDb } from "@/db";
import { queueTemplatedNotification } from "@/lib/notifications";

type Database = ReturnType<typeof getDb>;

export function shouldActivateInvoiceLicenses(
  company: { activateInvoiceLicensesImmediately: boolean } | null,
) {
  return company?.activateInvoiceLicensesImmediately === true;
}

export async function fulfillPaidOrder(
  db: Database,
  order: typeof orders.$inferSelect,
) {
  const items = await db
    .select()
    .from(orderItems)
    .where(eq(orderItems.orderId, order.id));
  const prepared: Array<{
    item: typeof orderItems.$inferSelect;
    course: typeof courses.$inferSelect;
    version: typeof courseVersions.$inferSelect;
  }> = [];
  for (const item of items) {
    const course = (
      await db
        .select()
        .from(courses)
        .where(eq(courses.id, item.courseId))
        .limit(1)
    )[0];
    if (!course) throw new Error(`course_missing:${item.courseId}`);
    const version = item.courseVersionId
      ? (await db.select().from(courseVersions).where(and(eq(courseVersions.id, item.courseVersionId), eq(courseVersions.courseId, item.courseId))).limit(1))[0]
      : (await db.select().from(courseVersions).where(and(eq(courseVersions.courseId, item.courseId), eq(courseVersions.status, "published"))).orderBy(desc(courseVersions.publishedAt)).limit(1))[0];
    if (!version) throw new Error(`published_version_missing:${item.courseId}`);
    prepared.push({ item, course, version });
  }
  let created = 0;
  for (const { item, course, version } of prepared) {
    if (order.buyerType === "company" && !order.companyId)
      throw new Error("company_order_missing_company");
    if (order.buyerType === "private" && !order.buyerUserId)
      throw new Error("private_order_missing_buyer");
    for (let index = 0; index < item.quantity; index += 1) {
      const suffix = `${item.id}:${index}`;
      if (order.buyerType === "company" && order.companyId) {
        const result = await db
          .insert(courseLicenses)
          .values({
            id: stableOrderRowId("lic", order.id, suffix),
            companyId: order.companyId,
            orderItemId: item.id,
            courseId: item.courseId,
            courseVersionId: version.id,
            status: "available",
          })
          .onConflictDoNothing()
          ;
        created += mutationChanges(result) ?? 0;
      } else if (order.buyerUserId) {
        const issuedAt = new Date().toISOString();
        const result = await db
          .insert(enrollments)
          .values({
            id: stableOrderRowId("enr", order.id, suffix),
            userId: order.buyerUserId,
            courseId: item.courseId,
            courseVersionId: version.id,
            orderItemId: item.id,
            status: "not_started",
            progressPercent: 0,
            validFrom: issuedAt.slice(0, 10),
            validUntil: addMonthsIso(issuedAt, course.validityMonths),
          })
          .onConflictDoNothing()
          ;
        created += mutationChanges(result) ?? 0;
      }
    }
  }
  if (order.buyerUserId)
    await queueTemplatedNotification(db, {
      userId: order.buyerUserId,
      type: "order_confirmation",
      variables: {
        orderId: order.id,
        totalSek: order.totalSek,
        accountUrl: "/mina-sidor",
      },
      fallbackSubject: `Orderbekräftelse ${order.id}`,
      fallbackBody: `Din order ${order.id} är registrerad. Ordervärde: ${order.totalSek} kr.`,
      scheduledFor: `order:${order.id}`,
    });
  return { created };
}

export function stableOrderRowId(
  prefix: string,
  orderId: string,
  suffix: string,
) {
  let hash = 2166136261;
  for (const char of `${orderId}:${suffix}`)
    hash = Math.imul(hash ^ char.charCodeAt(0), 16777619);
  return `${prefix}_${(hash >>> 0).toString(36)}`;
}

export function addMonthsIso(iso: string, months: number | null) {
  if (!months || months < 1) return null;
  const source = new Date(iso);
  const date = new Date(Date.UTC(source.getUTCFullYear(), source.getUTCMonth() + months, 1));
  const lastDay = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0)).getUTCDate();
  date.setUTCDate(Math.min(source.getUTCDate(), lastDay));
  return date.toISOString().slice(0, 10);
}
