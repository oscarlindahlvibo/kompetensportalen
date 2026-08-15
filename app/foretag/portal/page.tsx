import { and, eq, inArray } from "drizzle-orm";
import { requireChatGPTUser } from "@/app/chatgpt-auth";
import { PageShell } from "@/app/components/site-chrome";
import { getDb } from "@/db";
import { certificates, companies, companyMembers, competencies, courseLicenses, courses, enrollments, examAttempts as examAttemptsTable, users } from "@/db/schema";
import { ensureDbUser } from "@/lib/server-auth";
import LicenseManager from "@/app/foretag/portal/license-manager";
import { competencyIsExpiring, competencyIsValid } from "@/lib/platform";

export const dynamic = "force-dynamic";

export default async function CompanyPortal() {
  const identity = await requireChatGPTUser("/foretag/portal");
  const db = getDb();
  const actor = await ensureDbUser(db, identity);
  const memberships = await db.select({ membership: companyMembers, company: companies }).from(companyMembers).innerJoin(companies, eq(companies.id, companyMembers.companyId)).where(and(eq(companyMembers.userId, actor.id), eq(companyMembers.role, "admin"))).limit(1);
  const membership = memberships[0];
  if (!membership) return <PageShell><section className="subpage-hero"><p className="eyebrow">Företagsportal</p><h1>Ingen företagsbehörighet.</h1><p>Kontot saknar företagsadministratörsroll.</p></section></PageShell>;
  const members = await db.select({ member: companyMembers, user: users }).from(companyMembers).innerJoin(users, eq(users.id, companyMembers.userId)).where(and(eq(companyMembers.companyId, membership.company.id), eq(companyMembers.role, "employee")));
  const memberIds = members.map((item) => item.user.id);
  const [employeeEnrollments, validCompetencies, publishedCourses] = memberIds.length ? await Promise.all([
    db.select({ enrollment: enrollments, course: courses, user: users, certificate: certificates }).from(enrollments).innerJoin(courses, eq(courses.id, enrollments.courseId)).innerJoin(users, eq(users.id, enrollments.userId)).leftJoin(certificates, eq(certificates.enrollmentId, enrollments.id)).where(and(eq(enrollments.companyId, membership.company.id), inArray(enrollments.userId, memberIds))),
    db.select().from(competencies).where(inArray(competencies.userId, memberIds)),
    db.select().from(courses).where(eq(courses.status, "published")),
  ]) : [[], [], []];
  const enrollmentIds = employeeEnrollments.map((item) => item.enrollment.id);
  const examAttempts = enrollmentIds.length ? await db.select().from(examAttemptsTable).where(inArray(examAttemptsTable.enrollmentId, enrollmentIds)).orderBy(examAttemptsTable.startedAt) : [];
  const validCount = validCompetencies.filter((item) => competencyIsValid(item)).length;
  const soon = validCompetencies.filter((item) => competencyIsExpiring(item)).length;
  const matrixRows = members.flatMap(({ user }) => publishedCourses.map((course) => {
    const enrollment = employeeEnrollments.filter((item) => item.user.id === user.id && item.course.id === course.id).sort((a, b) => b.enrollment.createdAt.localeCompare(a.enrollment.createdAt))[0];
    const competency = validCompetencies.filter((item) => item.userId === user.id && item.courseId === course.id).sort((a, b) => (b.validUntil ?? "9999").localeCompare(a.validUntil ?? "9999"))[0];
    const latestExam = enrollment ? examAttempts.filter((attempt) => attempt.enrollmentId === enrollment.enrollment.id).sort((a, b) => b.startedAt.localeCompare(a.startedAt))[0] : undefined;
    const status = competency ? competencyIsExpiring(competency) ? "Går ut inom 90 dagar" : competencyIsValid(competency) ? "Giltig" : "Utgången" : enrollment ? enrollment.enrollment.status === "completed" ? "Saknar certifikat" : "Under utbildning" : "Saknar utbildning";
    return { user, course, enrollment, competency, latestExam, status };
  }));
  const missingCount = matrixRows.filter((row) => row.status === "Saknar utbildning").length;
  const licenses = await db.select({ license: courseLicenses, course: courses }).from(courseLicenses).innerJoin(courses, eq(courses.id, courseLicenses.courseId)).where(and(eq(courseLicenses.companyId, membership.company.id), eq(courseLicenses.status, "available")));
  return <PageShell><section className="subpage-hero admin-hero"><p className="eyebrow">{membership.company.name}</p><h1>Kompetens<br />i kontroll.</h1><p>Företagsdashboard för deltagare, progress, certifikat och giltighetstider.</p><a className="button button-primary" href="#kop-platser">Köp fler platser <span>→</span></a></section><section className="section company-stats"><div><strong>{members.length}</strong><span>medlemmar</span></div><div><strong>{validCount}</strong><span>giltiga kompetenser</span></div><div><strong>{soon}</strong><span>går ut inom 90 dagar</span></div><div><strong>{missingCount}</strong><span>saknar utbildning</span></div></section><section className="section admin-links" id="kop-platser"><div className="section-heading"><div><p className="eyebrow">Köp företagsplatser</p><h2>Välj utbildning</h2></div><p>Varje köp skapar lediga licenser som kan tilldelas era medarbetare.</p></div>{publishedCourses.map((course) => <a key={course.id} href={`/checkout?course=${encodeURIComponent(course.slug)}&company=${encodeURIComponent(membership.company.id)}`}><span>{course.category}</span><h3>{course.name}</h3><p>{course.basePriceSek.toLocaleString("sv-SE")} kr per plats · {course.validityMonths ? `${Math.round(course.validityMonths / 12)} års giltighet` : "Giltighet enligt kurs"}</p></a>)}</section><LicenseManager companyId={membership.company.id} initialLicenses={licenses.map(({ license, course }) => ({ id: license.id, courseId: license.courseId, courseName: course.name, createdAt: license.createdAt }))} initialRecipients={members.map(({ user }) => ({ id: user.id, email: user.email }))} /><section className="section company-matrix"><div className="section-heading"><div><p className="eyebrow">Kompetensmatris</p><h2>Senaste status</h2></div><a className="text-link" href="/foretag">Företagslösningar <span>→</span></a></div><div className="matrix-table">{matrixRows.map((item) => <div className="matrix-row" key={`${item.user.id}-${item.course.id}`}><strong>{item.user.email}</strong><span>{item.course.name}<small>{item.status} · {item.latestExam ? `prov ${item.latestExam.scorePercent ?? 0}% ${item.latestExam.passed ? "godkänt" : "underkänt"} · ` : "prov saknas · "}{item.competency?.validUntil ?? item.enrollment?.enrollment.validUntil ?? "-"}{item.enrollment?.certificate ? ` · ${item.enrollment.certificate.certificateNumber}` : item.status === "Saknar certifikat" ? " · certifikat saknas" : ""}</small></span><b>{item.enrollment?.enrollment.progressPercent ?? 0}%</b></div>)}</div></section></PageShell>;
}
