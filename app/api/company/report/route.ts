import { and, eq, inArray } from "drizzle-orm";
import { getDb } from "@/db";
import { companies, companyMembers, competencies, courses, enrollments, examAttempts, users } from "@/db/schema";
import { ensureDbUser, requireApiIdentity } from "@/lib/server-auth";
import { competencyIsExpiring, competencyIsValid } from "@/lib/platform";

export const dynamic = "force-dynamic";

function csvCell(value: string | number | null | undefined) { return `"${String(value ?? "").replaceAll('"', '""')}"`; }

export async function GET() {
  const identity = await requireApiIdentity();
  if (identity instanceof Response) return identity;
  const db = getDb();
  const actor = await ensureDbUser(db, identity);
  const membership = (await db.select({ membership: companyMembers, company: companies }).from(companyMembers).innerJoin(companies, eq(companies.id, companyMembers.companyId)).where(and(eq(companyMembers.userId, actor.id), eq(companyMembers.role, "admin"))).limit(1))[0];
  if (!membership) return Response.json({ error: "company_access_denied" }, { status: 403 });
  const members = await db.select({ member: companyMembers, user: users }).from(companyMembers).innerJoin(users, eq(users.id, companyMembers.userId)).where(and(eq(companyMembers.companyId, membership.company.id), eq(companyMembers.role, "employee")));
  const ids = members.map((item) => item.user.id);
  const [publishedCourses, employeeEnrollments, employeeCompetencies] = await Promise.all([
    db.select().from(courses).where(eq(courses.status, "published")),
    ids.length ? db.select().from(enrollments).where(and(eq(enrollments.companyId, membership.company.id), inArray(enrollments.userId, ids))).orderBy(enrollments.createdAt) : [],
    ids.length ? db.select().from(competencies).where(inArray(competencies.userId, ids)) : [],
  ]);
  const enrollmentIds = employeeEnrollments.map((item) => item.id);
  const attempts = enrollmentIds.length ? await db.select().from(examAttempts).where(inArray(examAttempts.enrollmentId, enrollmentIds)).orderBy(examAttempts.startedAt) : [];
  const rows = members.flatMap(({ user }) => publishedCourses.map((course) => {
    const competency = employeeCompetencies
      .filter((item) => item.userId === user.id && item.courseId === course.id)
      .sort((a, b) => (b.validUntil ?? "9999").localeCompare(a.validUntil ?? "9999"))[0];
    const enrollment = employeeEnrollments
      .filter((item) => item.userId === user.id && item.courseId === course.id)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
    const latestExam = enrollment ? attempts.filter((attempt) => attempt.enrollmentId === enrollment.id).sort((a, b) => b.startedAt.localeCompare(a.startedAt))[0] : undefined;
    const status = competency
      ? competencyIsExpiring(competency) ? "går ut inom 90 dagar" : competencyIsValid(competency) ? "giltig" : "utgången"
      : enrollment ? enrollment.status === "completed" ? "saknar certifikat" : "under utbildning" : "saknar utbildning";
    return {
      employee: user.email,
      email: user.email,
      course: course.name,
      status,
      validFrom: competency?.validFrom ?? enrollment?.validFrom ?? null,
      validUntil: competency?.validUntil ?? enrollment?.validUntil ?? null,
      progressPercent: enrollment?.progressPercent ?? 0,
      examScorePercent: latestExam?.scorePercent ?? null,
      examPassed: latestExam?.passed ?? null,
    };
  }));
  const lines = ["Anställd;E-post;Utbildning;Status;Progress %;Senaste prov %;Prov godkänt;Giltig från;Giltig till", ...rows.map((row) => [row.employee, row.email, row.course, row.status, row.progressPercent, row.examScorePercent, row.examPassed === null ? null : row.examPassed ? "Ja" : "Nej", row.validFrom, row.validUntil].map(csvCell).join(";"))];
  return new Response(`\uFEFF${lines.join("\n")}`, { headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": `attachment; filename="kompetensmatris-${membership.company.id}.csv"` } });
}
