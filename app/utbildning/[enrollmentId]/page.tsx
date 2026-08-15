import { and, asc, eq } from "drizzle-orm";
import { requireChatGPTUser } from "@/app/chatgpt-auth";
import { PageShell } from "@/app/components/site-chrome";
import { getDb } from "@/db";
import { chapters, courseVersions, enrollments, lessons, courses, lessonProgress } from "@/db/schema";
import { ensureDbUser } from "@/lib/server-auth";
import { enrollmentIsAccessible } from "@/lib/platform";
import IdentityRequest from "@/app/utbildning/identity-request";

export const dynamic = "force-dynamic";

export default async function CoursePlayer({ params }: { params: Promise<{ enrollmentId: string }> }) {
  const identity = await requireChatGPTUser("/utbildning");
  const { enrollmentId } = await params;
  const db = getDb();
  const user = await ensureDbUser(db, identity);
  const rows = await db.select({ enrollment: enrollments, course: courses, version: courseVersions }).from(enrollments).innerJoin(courses, eq(courses.id, enrollments.courseId)).innerJoin(courseVersions, eq(courseVersions.id, enrollments.courseVersionId)).where(and(eq(enrollments.id, enrollmentId), eq(enrollments.userId, user.id))).limit(1);
  const row = rows[0];
  if (!row) return <PageShell><section className="subpage-hero"><p className="eyebrow">Mina sidor</p><h1>Utbildningen kunde inte hittas.</h1><p>Du behöver ett aktivt enrollment för att öppna kursen.</p></section></PageShell>;
  if (!enrollmentIsAccessible(row.enrollment)) return <PageShell><section className="subpage-hero"><p className="eyebrow">Mina sidor</p><h1>Utbildningen har löpt ut.</h1><p>Förnya utbildningen för att öppna kursmaterialet igen.</p><a className="button button-dark" href={`/utbildningar/${row.course.slug}`}>Förnya utbildningen <span>→</span></a></section></PageShell>;
  const content = await db.select({ chapter: chapters, lesson: lessons }).from(chapters).innerJoin(lessons, eq(lessons.chapterId, chapters.id)).where(eq(chapters.courseVersionId, row.enrollment.courseVersionId)).orderBy(asc(chapters.sortOrder), asc(lessons.sortOrder));
  const progress = await db.select().from(lessonProgress).where(eq(lessonProgress.enrollmentId, enrollmentId));
  const completed = new Set(progress.filter((item) => item.status === "completed").map((item) => item.lessonId));
  const started = new Set(progress.filter((item) => item.status === "started").map((item) => item.lessonId));
  const nextLesson = content.find(({ lesson }) => !completed.has(lesson.id))?.lesson;
  return <PageShell><section className="player-hero"><div><p className="eyebrow">Kursversion {row.version.version}</p><h1>{row.course.name}</h1><p>Din personliga kursvy. Materialet nedan är endast tillgängligt eftersom du har ett aktivt enrollment.</p></div><div className="player-progress"><strong>{row.enrollment.progressPercent}%</strong><span>genomförd</span><div><i style={{ width: `${row.enrollment.progressPercent}%` }} /></div></div></section><section className="section player-content"><div className="player-intro"><p className="eyebrow">Fortsätt utbildningen</p><h2>{nextLesson ? nextLesson.title : "Utbildningen är slutförd"}</h2><p>Progress sparas per enrollment. Ett nytt köp eller en förtida förnyelse börjar alltid från noll.</p>{nextLesson && <a className="button button-dark" href={`/utbildning/${enrollmentId}/lektion/${nextLesson.id}`}>Fortsätt där du slutade <span>→</span></a>}<IdentityRequest enrollmentId={enrollmentId} /></div><div className="lesson-outline">{content.map(({ chapter, lesson }) => { const status = completed.has(lesson.id) ? "completed" : started.has(lesson.id) ? "started" : "not_started"; return <div className="lesson-row" key={lesson.id}><span>{status === "completed" ? "✓" : status === "started" ? "▶" : "○"}</span><div><small>{chapter.title}</small><strong><a href={`/utbildning/${enrollmentId}/lektion/${lesson.id}`}>{lesson.title}</a></strong></div><em>{status === "completed" ? "Slutförd" : status === "started" ? "Påbörjad" : "Ej påbörjad"}</em></div>; })}</div></section></PageShell>;
}
