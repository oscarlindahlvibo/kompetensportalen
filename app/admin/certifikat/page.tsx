import { and, eq } from "drizzle-orm";
import { requireChatGPTUser } from "@/app/chatgpt-auth";
import { PageShell } from "@/app/components/site-chrome";
import { getDb } from "@/db";
import { certificates, courses, enrollments, examAttempts, identityVerifications, users } from "@/db/schema";
import { ensureDbUser, requirePermission } from "@/lib/server-auth";
import { hasPermission } from "@/lib/platform";
import CertificateQueue from "@/app/admin/certifikat/certificate-queue";

export const dynamic = "force-dynamic";

export default async function CertificatesPage() {
  const identity = await requireChatGPTUser("/admin/certifikat");
  const db = getDb();
  const actor = await ensureDbUser(db, identity);
  requirePermission(actor.role, "certification:read");
  const rows = await db.select({ enrollment: enrollments, user: users, course: courses, exam: examAttempts, identity: identityVerifications, certificate: certificates }).from(enrollments).innerJoin(users, eq(users.id, enrollments.userId)).innerJoin(courses, eq(courses.id, enrollments.courseId)).leftJoin(examAttempts, and(eq(examAttempts.enrollmentId, enrollments.id), eq(examAttempts.passed, true))).leftJoin(identityVerifications, eq(identityVerifications.enrollmentId, enrollments.id)).leftJoin(certificates, eq(certificates.enrollmentId, enrollments.id));
  const unique = new Map(rows.map((row) => [row.enrollment.id, row]));
  return <PageShell><section className="subpage-hero admin-hero"><p className="eyebrow">Administration · Certifiering</p><h1>Utfärda<br />kompetens.</h1><p>Granska godkänt prov och identitetskontroll innan certifikat och ID06-kö skapas.</p></section><CertificateQueue canRevoke={hasPermission(actor.role, "certification:write")} rows={[...unique.values()].map(({ enrollment, user, course, exam, identity, certificate }) => ({ enrollmentId: enrollment.id, participant: user.email, course: course.name, examPassed: Boolean(exam), identityVerificationId: identity?.id ?? null, identityStatus: identity?.status ?? null, identityReference: identity?.reference ?? null, identityNotes: identity?.notes ?? null, certificateId: certificate?.id ?? null, certificateNumber: certificate?.certificateNumber ?? null, certificateStatus: certificate?.status ?? null }))} /></PageShell>;
}
