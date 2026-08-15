import { and, eq } from "drizzle-orm";
import { requireChatGPTUser } from "@/app/chatgpt-auth";
import { PageShell } from "@/app/components/site-chrome";
import { getDb } from "@/db";
import { chapters, enrollments, lessons, quizzes } from "@/db/schema";
import { ensureDbUser } from "@/lib/server-auth";
import { enrollmentIsAccessible } from "@/lib/platform";
import LessonCompletion from "@/app/utbildning/lesson-completion";
import ExamPlayer from "@/app/utbildning/exam-player";
import LessonContent from "@/app/utbildning/lesson-content";
import QuizPlayer from "@/app/utbildning/quiz-player";
import LessonStart from "@/app/utbildning/lesson-start";

export const dynamic = "force-dynamic";

export default async function LessonPage({ params }: { params: Promise<{ enrollmentId: string; lessonId: string }> }) {
  const identity = await requireChatGPTUser("/mina-sidor");
  const { enrollmentId, lessonId } = await params;
  const db = getDb();
  const user = await ensureDbUser(db, identity);
  const rows = await db.select({ enrollment: enrollments, lesson: lessons, chapter: chapters, quiz: quizzes }).from(enrollments)
    .innerJoin(chapters, eq(chapters.courseVersionId, enrollments.courseVersionId))
    .innerJoin(lessons, eq(lessons.chapterId, chapters.id))
    .leftJoin(quizzes, eq(quizzes.lessonId, lessons.id))
    .where(and(eq(enrollments.id, enrollmentId), eq(enrollments.userId, user.id), eq(lessons.id, lessonId))).limit(1);
  const row = rows[0];
  if (!row) return <PageShell><section className="subpage-hero"><p className="eyebrow">Lektion</p><h1>Innehållet kunde inte hittas.</h1><p>Du behöver ett aktivt enrollment för att öppna kursmaterialet.</p></section></PageShell>;
  if (!enrollmentIsAccessible(row.enrollment)) return <PageShell><section className="subpage-hero"><p className="eyebrow">Lektion</p><h1>Utbildningen har löpt ut.</h1><p>Förnya utbildningen för att fortsätta.</p></section></PageShell>;
  return <PageShell><section className="lesson-page"><LessonStart enrollmentId={enrollmentId} lessonId={lessonId} /><a className="back-link" href={`/utbildning/${enrollmentId}`}>← Tillbaka till utbildningen</a><p className="eyebrow">{row.chapter.title} · {row.lesson.type}</p><h1>{row.lesson.title}</h1>{row.lesson.type === "exam" ? <ExamPlayer enrollmentId={enrollmentId} /> : row.lesson.type === "quiz" && row.quiz ? <QuizPlayer quizId={row.quiz.id} enrollmentId={enrollmentId} /> : <><article className="lesson-body"><LessonContent bodyJson={row.lesson.bodyJson} /></article><LessonCompletion enrollmentId={enrollmentId} lessonId={lessonId} /></>}</section></PageShell>;
}
