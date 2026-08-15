import { desc, eq } from "drizzle-orm";
import Link from "next/link";
import { requireChatGPTUser } from "@/app/chatgpt-auth";
import { PageShell } from "@/app/components/site-chrome";
import { getDb } from "@/db";
import { auditLogs, chapters, courseVersions, courses, enrollments, lessonProgress, lessons, users } from "@/db/schema";
import { ensureDbUser, requirePermission, requestMetadata } from "@/lib/server-auth";

export const dynamic = "force-dynamic";

export default async function ImpersonationView({ params }: { params: Promise<{ id: string }> }) {
  const identity = await requireChatGPTUser("/admin/impersonation"); const { id } = await params; const db = getDb();
  const actor = await ensureDbUser(db, identity); requirePermission(actor.role, "support:read");
  const participant = (await db.select().from(users).where(eq(users.id, id)).limit(1))[0];
  if (!participant || participant.role !== "participant") return <PageShell><section className="subpage-hero"><h1>Deltagaren hittades inte.</h1></section></PageShell>;
  const metadata = await requestMetadata();
  await db.insert(auditLogs).values({ id: crypto.randomUUID(), actorUserId: actor.id, targetType: "user", targetId: participant.id, action: "support.read_only_impersonation", afterJson: JSON.stringify({ readOnly: true }), ipHash: metadata.ip, userAgent: metadata.userAgent });
  const rows = await db.select({ enrollment: enrollments, course: courses, version: courseVersions }).from(enrollments).innerJoin(courses, eq(courses.id, enrollments.courseId)).innerJoin(courseVersions, eq(courseVersions.id, enrollments.courseVersionId)).where(eq(enrollments.userId, participant.id)).orderBy(desc(enrollments.createdAt));
  const progress = rows.length ? await db.select().from(lessonProgress).where(eq(lessonProgress.enrollmentId, rows[0].enrollment.id)) : [];
  const content = rows.length ? await db.select({ chapter: chapters, lesson: lessons }).from(chapters).innerJoin(lessons, eq(lessons.chapterId, chapters.id)).where(eq(chapters.courseVersionId, rows[0].enrollment.courseVersionId)) : [];
  const completed = new Set(progress.filter((item) => item.status === "completed").map((item) => item.lessonId));
  return <PageShell><section className="subpage-hero admin-hero"><p className="eyebrow">Read-only supportläge</p><h1>{participant.email}</h1><p>Den här vyn är loggad och kan endast läsa kursstatus. Examination, identitetskontroll, certifikat och ID06 är avstängda.</p><Link className="text-link" href="/admin/impersonation">← Till deltagarlistan</Link></section><section className="section player-content"><div className="player-intro"><p className="eyebrow">Senaste enrollment</p>{rows[0] ? <><h2>{rows[0].course.name}</h2><p>Version {rows[0].version.version} · {rows[0].enrollment.progressPercent}% genomförd · {rows[0].enrollment.status}</p></> : <p>Deltagaren har inga enrollments.</p>}</div><div className="lesson-outline">{content.map(({ chapter, lesson }) => <div className="lesson-row" key={lesson.id}><span>{completed.has(lesson.id) ? "✓" : "○"}</span><div><small>{chapter.title}</small><strong>{lesson.title}</strong></div><em>{lesson.type}</em></div>)}</div></section></PageShell>;
}
