import { desc, eq } from "drizzle-orm";
import Link from "next/link";
import { requireChatGPTUser } from "@/app/chatgpt-auth";
import { PageShell } from "@/app/components/site-chrome";
import { getDb } from "@/db";
import { certificates, courseVersions, courses, enrollments, examAttempts, id06Registrations, users } from "@/db/schema";
import { ensureDbUser, requirePermission } from "@/lib/server-auth";

export const dynamic = "force-dynamic";

export default async function EnrollmentsPage() {
  const identity = await requireChatGPTUser("/admin/enrollments");
  const db = getDb();
  const actor = await ensureDbUser(db, identity);
  requirePermission(actor.role, "participant:read");
  const rows = await db
    .select({ enrollment: enrollments, user: users, course: courses, version: courseVersions, exam: examAttempts, certificate: certificates, id06: id06Registrations })
    .from(enrollments)
    .innerJoin(users, eq(users.id, enrollments.userId))
    .innerJoin(courses, eq(courses.id, enrollments.courseId))
    .innerJoin(courseVersions, eq(courseVersions.id, enrollments.courseVersionId))
    .leftJoin(examAttempts, eq(examAttempts.enrollmentId, enrollments.id))
    .leftJoin(certificates, eq(certificates.enrollmentId, enrollments.id))
    .leftJoin(id06Registrations, eq(id06Registrations.enrollmentId, enrollments.id))
    .orderBy(desc(enrollments.createdAt));
  const byEnrollment = new Map<string, typeof rows[number]>();
  for (const row of rows) {
    const current = byEnrollment.get(row.enrollment.id);
    if (!current || (row.exam?.startedAt ?? "") > (current.exam?.startedAt ?? "")) byEnrollment.set(row.enrollment.id, row);
  }
  const enrollmentRows = [...byEnrollment.values()];
  return <PageShell><section className="subpage-hero admin-hero"><p className="eyebrow">Administration · Enrollments</p><h1>Varje<br />genomförande.</h1><p>Här visas elevdokumentation per enrollment. Kursversion, progress, provresultat, certifikat och ID06-status hålls separerade mellan genomföranden.</p></section><section className="section admin-table-section"><div className="section-heading"><div><p className="eyebrow">Elevdokumentation</p><h2>{enrollmentRows.length} enrollments</h2></div><a className="button button-light" href="/api/admin/enrollments/export">Exportera CSV <span>↓</span></a></div><div className="admin-table">{enrollmentRows.length ? enrollmentRows.map(({ enrollment, user, course, version, exam, certificate, id06 }) => <div className="admin-table-row enrollment-admin-row" key={enrollment.id}><div><strong>{user.email}</strong><span>{course.name} · version {version.version}</span></div><span>{enrollment.status}</span><span>{enrollment.progressPercent}%</span><span>{exam ? `Prov ${exam.scorePercent ?? 0}% · ${exam.passed ? "godkänt" : "underkänt"}` : "Prov saknas"}</span><span>{certificate?.certificateNumber ?? "Certifikat saknas"}</span><span>{id06?.status ?? "ID06 saknas"}</span><span>{enrollment.validUntil ?? "Ingen slutdag"}</span><Link className="button button-light" href={`/admin/enrollments/${enrollment.id}`}>Öppna</Link></div>) : <p>Inga enrollments ännu.</p>}</div></section></PageShell>;
}
