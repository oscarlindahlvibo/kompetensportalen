import { and, desc, eq, inArray } from "drizzle-orm";
import { requireChatGPTUser } from "@/app/chatgpt-auth";
import { PageShell } from "@/app/components/site-chrome";
import { getDb } from "@/db";
import {
  auditLogs,
  certificates,
  chapters,
  competencies,
  courseVersions,
  courses,
  enrollments,
  examAttempts,
  identityVerifications,
  id06Registrations,
  lessonProgress,
  lessons,
  profiles,
  quizAttempts,
  users,
} from "@/db/schema";
import { decryptPersonalIdentity } from "@/lib/pii";
import { hasPermission } from "@/lib/platform";
import { ensureDbUser, requirePermission } from "@/lib/server-auth";
import Link from "next/link";

export const dynamic = "force-dynamic";

export default async function EnrollmentDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const identity = await requireChatGPTUser("/admin/enrollments");
  const { id } = await params;
  const db = getDb();
  const actor = await ensureDbUser(db, identity);
  requirePermission(actor.role, "participant:read");

  const row = (await db.select({
    enrollment: enrollments,
    user: users,
    profile: profiles,
    course: courses,
    version: courseVersions,
    certificate: certificates,
    competency: competencies,
    id06: id06Registrations,
  }).from(enrollments)
    .innerJoin(users, eq(users.id, enrollments.userId))
    .leftJoin(profiles, eq(profiles.userId, enrollments.userId))
    .innerJoin(courses, eq(courses.id, enrollments.courseId))
    .innerJoin(courseVersions, eq(courseVersions.id, enrollments.courseVersionId))
    .leftJoin(certificates, eq(certificates.enrollmentId, enrollments.id))
    .leftJoin(competencies, eq(competencies.certificateId, certificates.id))
    .leftJoin(id06Registrations, eq(id06Registrations.enrollmentId, enrollments.id))
    .where(eq(enrollments.id, id)).limit(1))[0];

  if (!row) return <PageShell><section className="subpage-hero admin-hero"><h1>Enrollment saknas.</h1><p>Det efterfrågade kursgenomförandet kunde inte hittas.</p></section></PageShell>;

  const [content, quizzes, exams, verifications] = await Promise.all([
    db.select({ chapter: chapters, lesson: lessons, progress: lessonProgress })
      .from(chapters)
      .innerJoin(lessons, eq(lessons.chapterId, chapters.id))
      .leftJoin(lessonProgress, and(eq(lessonProgress.lessonId, lessons.id), eq(lessonProgress.enrollmentId, id)))
      .where(eq(chapters.courseVersionId, row.enrollment.courseVersionId))
      .orderBy(chapters.sortOrder, lessons.sortOrder),
    db.select().from(quizAttempts).where(and(eq(quizAttempts.enrollmentId, id), eq(quizAttempts.courseVersionId, row.enrollment.courseVersionId))).orderBy(desc(quizAttempts.submittedAt)),
    db.select().from(examAttempts).where(and(eq(examAttempts.enrollmentId, id), eq(examAttempts.courseVersionId, row.enrollment.courseVersionId))).orderBy(desc(examAttempts.attemptNumber)),
    db.select().from(identityVerifications).where(eq(identityVerifications.enrollmentId, id)).orderBy(desc(identityVerifications.createdAt)),
  ]);

  const auditTargetIds = [
    id,
    ...content.flatMap((item) => item.progress?.id ? [item.progress.id] : []),
    ...quizzes.map((attempt) => attempt.id),
    ...exams.map((attempt) => attempt.id),
    ...(row.certificate ? [row.certificate.id] : []),
    ...(row.id06 ? [row.id06.id] : []),
  ];
  const audit = auditTargetIds.length
    ? await db.select().from(auditLogs).where(inArray(auditLogs.targetId, auditTargetIds)).orderBy(desc(auditLogs.createdAt)).limit(100)
    : [];
  const canSeeIdentity = hasPermission(actor.role, "id06:read");
  let personalIdentity = row.profile?.identityLast4 ? `••••••${row.profile.identityLast4}` : "Inte registrerat";
  if (canSeeIdentity && row.profile?.personalIdentityEncrypted) {
    try { personalIdentity = await decryptPersonalIdentity(row.profile.personalIdentityEncrypted) ?? personalIdentity; } catch { /* Keep masked identity when the key is unavailable. */ }
  }
  const participantName = [row.profile?.firstName, row.profile?.lastName].filter(Boolean).join(" ") || row.user.email;
  const date = (value: string | null | undefined) => value ? value.slice(0, 19).replace("T", " ") : "-";

  return <PageShell>
    <section className="subpage-hero admin-hero">
      <p className="eyebrow">Administration · Elevdokumentation</p>
      <h1>{row.course.name}<br />v{row.version.version}</h1>
      <p>{participantName} · {row.user.email}</p>
      <Link className="text-link" href="/admin/enrollments">Tillbaka till enrollments <span>→</span></Link>
    </section>
    <section className="section enrollment-detail-grid">
      <article className="admin-form"><p className="eyebrow">Enrollment</p><h2>{row.enrollment.status}</h2><dl className="detail-list">
        <dt>Enrollment-ID</dt><dd>{row.enrollment.id}</dd>
        <dt>Kursversion</dt><dd>{row.version.version} · {row.version.status}</dd>
        <dt>Köpt/tilldelad</dt><dd>{date(row.enrollment.purchasedAt)}</dd>
        <dt>Giltig från</dt><dd>{row.enrollment.validFrom ?? "-"}</dd>
        <dt>Giltig till</dt><dd>{row.enrollment.validUntil ?? "Tills vidare"}</dd>
        <dt>Progress</dt><dd>{row.enrollment.progressPercent}%</dd>
        <dt>Personnummer</dt><dd>{canSeeIdentity ? personalIdentity : "Begränsad åtkomst"}</dd>
      </dl></article>
      <article className="admin-form"><p className="eyebrow">Certifiering</p><h2>{row.certificate ? "Certifikat utfärdat" : "Inte utfärdat"}</h2><dl className="detail-list">
        <dt>Certifikatnummer</dt><dd>{row.certificate?.certificateNumber ?? "-"}</dd>
        <dt>Utfärdat</dt><dd>{date(row.certificate?.issuedAt)}</dd>
        <dt>Giltigt till</dt><dd>{row.certificate?.validUntil ?? "-"}</dd>
        <dt>Kompetens</dt><dd>{row.competency?.status ?? "-"}</dd>
        <dt>ID06</dt><dd>{row.id06?.status ?? "-"}</dd>
        <dt>ID06-referens</dt><dd>{row.id06?.id06Reference ?? "-"}</dd>
      </dl></article>
    </section>
    <section className="section admin-table-section"><div className="section-heading"><div><p className="eyebrow">Lektioner</p><h2>{content.filter((item) => item.progress?.status === "completed").length}/{content.length} slutförda</h2></div></div><div className="admin-table">{content.map((item) => <div className="admin-table-row" key={item.lesson.id}><div><strong>{item.lesson.title}</strong><span>{item.chapter.title} · {item.lesson.type}{item.lesson.required ? " · obligatorisk" : ""}</span></div><span>{item.progress?.status ?? "not_started"}</span><span>{date(item.progress?.completedAt)}</span></div>)}</div></section>
    <section className="section admin-detail-columns">
      <article className="admin-table-section"><p className="eyebrow">Quizförsök</p><h2>{quizzes.length} försök</h2><div className="admin-table">{quizzes.length ? quizzes.map((attempt) => <div className="admin-table-row" key={attempt.id}><div><strong>{attempt.quizId}</strong><span>Försök {attempt.attemptNumber}</span></div><span>{attempt.scorePercent}%</span><span>{attempt.passed ? "Godkänt" : "Underkänt"}</span></div>) : <p>Inga quizförsök.</p>}</div></article>
      <article className="admin-table-section"><p className="eyebrow">Slutprov</p><h2>{exams.length} försök</h2><div className="admin-table">{exams.length ? exams.map((attempt) => <div className="admin-table-row" key={attempt.id}><div><strong>Försök {attempt.attemptNumber}</strong><span>{date(attempt.startedAt)} · {attempt.status}</span></div><span>{attempt.scorePercent ?? "-"}%</span><span>{attempt.passed ? "Godkänt" : "Underkänt"}</span></div>) : <p>Inga slutprovsförsök.</p>}</div></article>
    </section>
    <section className="section admin-detail-columns">
      <article className="admin-table-section"><p className="eyebrow">Identitetskontroll</p><h2>{verifications.length ? verifications[0].status : "identity_pending"}</h2><div className="admin-table">{verifications.map((verification) => <div className="admin-table-row" key={verification.id}><div><strong>{verification.method}</strong><span>{verification.reference ?? "Utan referens"}</span></div><span>{date(verification.verifiedAt)}</span><span>{verification.verifiedByUserId ?? "-"}</span></div>)}</div></article>
      <article className="admin-table-section"><p className="eyebrow">Revisionslogg</p><h2>{audit.length} händelser</h2><div className="admin-table">{audit.length ? audit.map((event) => <div className="admin-table-row" key={event.id}><div><strong>{event.action}</strong><span>{event.targetType} · {event.targetId}</span></div><span>{date(event.createdAt)}</span><span>{event.actorUserId ?? "system"}</span></div>) : <p>Inga händelser.</p>}</div></article>
    </section>
  </PageShell>;
}
