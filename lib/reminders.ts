import { mutationChanges } from "@/lib/db-compat";
import { and, eq, gt, gte, inArray, lt, lte } from "drizzle-orm";
import { getDb } from "@/db";
import { companyMembers, competencies, certificates, courses, enrollments } from "@/db/schema";
import { queueTemplatedNotification } from "@/lib/notifications";

type Database = ReturnType<typeof getDb>;

export async function syncValidityStatuses(db: Database, now = new Date()) {
  const today = now.toISOString().slice(0, 10);
  const ninetyDays = new Date(now.getTime() + 90 * 86400000)
    .toISOString()
    .slice(0, 10);
  const timestamp = now.toISOString();
  const expiredCompetencies = await db
    .update(competencies)
    .set({ status: "expired" })
    .where(and(inArray(competencies.status, ["valid", "expiring"]), lt(competencies.validUntil, today)))
    ;
  const expiringCompetencies = await db
    .update(competencies)
    .set({ status: "expiring" })
    .where(and(eq(competencies.status, "valid"), gte(competencies.validUntil, today), lte(competencies.validUntil, ninetyDays)))
    ;
  const validCompetencies = await db
    .update(competencies)
    .set({ status: "valid" })
    .where(and(eq(competencies.status, "expiring"), gte(competencies.validUntil, today), gt(competencies.validUntil, ninetyDays)))
    ;
  const expiredCertificates = await db
    .update(certificates)
    .set({ status: "expired" })
    .where(and(eq(certificates.status, "issued"), lt(certificates.validUntil, today)))
    ;
  const expiredEnrollments = await db
    .update(enrollments)
    .set({ status: "expired", updatedAt: timestamp })
    .where(and(inArray(enrollments.status, ["not_started", "in_progress", "completed"]), lt(enrollments.validUntil, today)))
    ;
  return {
    expiredCompetencies: mutationChanges(expiredCompetencies) ?? 0,
    expiringCompetencies: mutationChanges(expiringCompetencies) ?? 0,
    validCompetencies: mutationChanges(validCompetencies) ?? 0,
    expiredCertificates: mutationChanges(expiredCertificates) ?? 0,
    expiredEnrollments: mutationChanges(expiredEnrollments) ?? 0,
  };
}

export async function queueExpiringReminders(db: Database, days: number) {
  const today = new Date();
  const targetDate = new Date(today.getTime() + days * 86400000)
    .toISOString()
    .slice(0, 10);
  const rows = await db
    .select({ competency: competencies, course: courses })
    .from(competencies)
    .innerJoin(courses, eq(courses.id, competencies.courseId))
    .where(
      and(
        inArray(competencies.status, ["valid", "expiring"]),
        eq(competencies.validUntil, targetDate),
      ),
    );
  let queued = 0;
  for (const row of rows) {
    const variables = {
      courseName: row.course.name,
      validUntil: row.competency.validUntil,
      days,
      renewUrl: `/utbildningar/${row.course.slug}`,
    };
    const participantResult = await queueTemplatedNotification(db, {
      userId: row.competency.userId,
      type: "competence_expiring",
      variables,
      fallbackSubject: `Din utbildning ${row.course.name} löper ut om ${days} dagar`,
      fallbackBody: `Din utbildning ${row.course.name} löper ut ${row.competency.validUntil}. Förnya utbildningen på Mina sidor.`,
      scheduledFor: `competence-expiry:${row.competency.id}:${days}`,
    });
    if (participantResult.queued) queued += 1;
    const companyAdmins = await db
      .select({ userId: companyMembers.userId })
      .from(certificates)
      .innerJoin(enrollments, eq(enrollments.id, certificates.enrollmentId))
      .innerJoin(companyMembers, and(eq(companyMembers.companyId, enrollments.companyId), eq(companyMembers.role, "admin")))
      .where(eq(certificates.id, row.competency.certificateId));
    for (const admin of companyAdmins) {
      if (admin.userId === row.competency.userId) continue;
      const companyResult = await queueTemplatedNotification(db, {
        userId: admin.userId,
        type: "company_competence_expiring",
        variables,
        fallbackSubject: `En medarbetares ${row.course.name} löper ut om ${days} dagar`,
        fallbackBody: `En medarbetares utbildning ${row.course.name} löper ut ${row.competency.validUntil}.`,
        scheduledFor: `company-competence-expiry:${row.competency.id}:${admin.userId}:${days}`,
      });
      if (companyResult.queued) queued += 1;
    }
  }
  return { matched: rows.length, queued, days, until: targetDate };
}
