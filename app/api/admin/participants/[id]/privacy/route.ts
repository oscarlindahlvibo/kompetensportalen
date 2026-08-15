import { eq, or } from "drizzle-orm";
import { getDb } from "@/db";
import {
  auditLogs,
  certificates,
  companyMembers,
  consents,
  courseLicenses,
  enrollments,
  examAttempts,
  identityVerifications,
  lessonProgress,
  notifications,
  orderItems,
  orders,
  payments,
  profiles,
  quizAttempts,
  users,
} from "@/db/schema";
import { decryptPersonalIdentity } from "@/lib/pii";
import {
  ensureDbUser,
  requireApiIdentity,
  requireMutationIdentity,
  requirePermission,
  requestMetadata,
} from "@/lib/server-auth";

export const dynamic = "force-dynamic";

async function getTarget(id: string) {
  return (
    await getDb()
      .select()
      .from(users)
      .where(eq(users.id, id))
      .limit(1)
  )[0];
}

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const identity = await requireApiIdentity();
  if (identity instanceof Response) return identity;
  const { id } = await context.params;
  const db = getDb();
  const actor = await ensureDbUser(db, identity);
  requirePermission(actor.role, "privacy:read");
  const target = await getTarget(id);
  if (!target) return Response.json({ error: "participant_not_found" }, { status: 404 });
  const [profile, userEnrollments, userCertificates, attempts, progress, quizzes, userOrders, userOrderItems, userPayments, memberships, licenses, verifications, userConsents, userNotifications, userAuditLogs] = await Promise.all([
    db.select().from(profiles).where(eq(profiles.userId, id)).limit(1),
    db.select().from(enrollments).where(eq(enrollments.userId, id)),
    db.select().from(certificates).where(eq(certificates.userId, id)),
    db.select().from(examAttempts).innerJoin(enrollments, eq(enrollments.id, examAttempts.enrollmentId)).where(eq(enrollments.userId, id)),
    db.select().from(lessonProgress).innerJoin(enrollments, eq(enrollments.id, lessonProgress.enrollmentId)).where(eq(enrollments.userId, id)),
    db.select().from(quizAttempts).innerJoin(enrollments, eq(enrollments.id, quizAttempts.enrollmentId)).where(eq(enrollments.userId, id)),
    db.select().from(orders).where(eq(orders.buyerUserId, id)),
    db.select().from(orderItems).innerJoin(orders, eq(orders.id, orderItems.orderId)).where(eq(orders.buyerUserId, id)),
    db.select().from(payments).innerJoin(orders, eq(orders.id, payments.orderId)).where(eq(orders.buyerUserId, id)),
    db.select().from(companyMembers).where(eq(companyMembers.userId, id)),
    db.select().from(courseLicenses).where(eq(courseLicenses.assignedToUserId, id)),
    db.select().from(identityVerifications).where(eq(identityVerifications.userId, id)),
    db.select().from(consents).where(eq(consents.userId, id)),
    db.select().from(notifications).where(eq(notifications.userId, id)),
    db.select().from(auditLogs).where(or(eq(auditLogs.actorUserId, id), eq(auditLogs.targetId, id))),
  ]);
  const metadata = await requestMetadata();
  await db.insert(auditLogs).values({
    id: crypto.randomUUID(),
    actorUserId: actor.id,
    targetType: "user",
    targetId: id,
    action: "gdpr.admin_export",
    beforeJson: null,
    afterJson: JSON.stringify({ exportedAt: new Date().toISOString() }),
    ipHash: metadata.ip,
    userAgent: metadata.userAgent,
  });
  return Response.json({
    exportedAt: new Date().toISOString(),
    user: { id: target.id, email: target.email, role: target.role, status: target.status },
    profile: profile[0]
      ? { ...profile[0], personalIdentityEncrypted: undefined, personalIdentity: await decryptPersonalIdentity(profile[0].personalIdentityEncrypted) }
      : null,
    enrollments: userEnrollments,
    certificates: userCertificates,
    examAttempts: attempts,
    quizAttempts: quizzes,
    lessonProgress: progress,
    orders: userOrders,
    orderItems: userOrderItems,
    payments: userPayments,
    companyMemberships: memberships,
    courseLicenses: licenses,
    identityVerifications: verifications,
    consents: userConsents,
    notifications: userNotifications,
    auditLogs: userAuditLogs,
  });
}

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const identity = await requireMutationIdentity(request);
  if (identity instanceof Response) return identity;
  const { id } = await context.params;
  const db = getDb();
  const actor = await ensureDbUser(db, identity);
  requirePermission(actor.role, "privacy:write");
  const target = await getTarget(id);
  if (!target) return Response.json({ error: "participant_not_found" }, { status: 404 });
  if (target.role === "super_admin") return Response.json({ error: "admin_account_protected" }, { status: 409 });
  const anonymizedEmail = `anonymized-${target.id}-${Date.now()}@invalid.local`;
  await db.update(users).set({ email: anonymizedEmail, status: "anonymized", updatedAt: new Date().toISOString() }).where(eq(users.id, id));
  await db.update(profiles).set({ firstName: "Anonymiserad", lastName: "Deltagare", phone: null, personalIdentityEncrypted: null, identityLast4: null, gdprState: "anonymized", updatedAt: new Date().toISOString() }).where(eq(profiles.userId, id));
  const metadata = await requestMetadata();
  await db.insert(auditLogs).values({
    id: crypto.randomUUID(),
    actorUserId: actor.id,
    targetType: "user",
    targetId: id,
    action: "gdpr.admin_anonymize",
    beforeJson: JSON.stringify({ email: target.email, status: target.status }),
    afterJson: JSON.stringify({ userId: id, status: "anonymized" }),
    ipHash: metadata.ip,
    userAgent: metadata.userAgent,
  });
  return Response.json({ ok: true, preserved: "Historiska enrollments, prov, certifikat och revisionsspår bevaras." });
}
