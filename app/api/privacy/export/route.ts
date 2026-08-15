import { getDb } from "@/db";
import { eq, or } from "drizzle-orm";
import { auditLogs, certificates, companyMembers, consents, courseLicenses, enrollments, examAttempts, identityVerifications, lessonProgress, notifications, orderItems, orders, payments, profiles, quizAttempts } from "@/db/schema";
import { ensureDbUser, requireApiIdentity, requestMetadata } from "@/lib/server-auth";
import { decryptPersonalIdentity } from "@/lib/pii";

export const dynamic = "force-dynamic";

export async function GET() {
  const identity = await requireApiIdentity();
  if (identity instanceof Response) return identity;
  const db = getDb();
  const user = await ensureDbUser(db, identity);
  const [profile, userEnrollments, userCertificates, attempts, progress, quizzes, userOrders, userOrderItems, userPayments, memberships, licenses, verifications, userConsents, userNotifications, userAuditLogs] = await Promise.all([
    db.select().from(profiles).where(eq(profiles.userId, user.id)).limit(1),
    db.select().from(enrollments).where(eq(enrollments.userId, user.id)),
    db.select().from(certificates).where(eq(certificates.userId, user.id)),
    db.select().from(examAttempts).innerJoin(enrollments, eq(enrollments.id, examAttempts.enrollmentId)).where(eq(enrollments.userId, user.id)),
    db.select().from(lessonProgress).innerJoin(enrollments, eq(enrollments.id, lessonProgress.enrollmentId)).where(eq(enrollments.userId, user.id)),
    db.select().from(quizAttempts).innerJoin(enrollments, eq(enrollments.id, quizAttempts.enrollmentId)).where(eq(enrollments.userId, user.id)),
    db.select().from(orders).where(eq(orders.buyerUserId, user.id)),
    db.select().from(orderItems).innerJoin(orders, eq(orders.id, orderItems.orderId)).where(eq(orders.buyerUserId, user.id)),
    db.select().from(payments).innerJoin(orders, eq(orders.id, payments.orderId)).where(eq(orders.buyerUserId, user.id)),
    db.select().from(companyMembers).where(eq(companyMembers.userId, user.id)),
    db.select().from(courseLicenses).where(eq(courseLicenses.assignedToUserId, user.id)),
    db.select().from(identityVerifications).where(eq(identityVerifications.userId, user.id)),
    db.select().from(consents).where(eq(consents.userId, user.id)),
    db.select().from(notifications).where(eq(notifications.userId, user.id)),
    db.select().from(auditLogs).where(or(eq(auditLogs.actorUserId, user.id), eq(auditLogs.targetId, user.id))),
  ]);
  const metadata = await requestMetadata();
  await db.update(profiles).set({ gdprState: "export_requested", updatedAt: new Date().toISOString() }).where(eq(profiles.userId, user.id));
  await db.insert(auditLogs).values({ id: crypto.randomUUID(), actorUserId: user.id, targetType: "user", targetId: user.id, action: "gdpr.export", afterJson: JSON.stringify({ exportedAt: new Date().toISOString() }), ipHash: metadata.ip, userAgent: metadata.userAgent });
  const exportedProfile = profile[0] ? { ...profile[0], personalIdentityEncrypted: undefined, personalIdentity: await decryptPersonalIdentity(profile[0].personalIdentityEncrypted) } : null;
  return Response.json({
    exportedAt: new Date().toISOString(),
    user: { id: user.id, email: user.email, role: user.role, status: user.status },
    profile: exportedProfile,
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
