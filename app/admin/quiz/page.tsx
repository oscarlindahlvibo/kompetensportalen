import { eq } from "drizzle-orm";
import { requireChatGPTUser } from "@/app/chatgpt-auth";
import { PageShell } from "@/app/components/site-chrome";
import { getDb } from "@/db";
import { chapters, courseVersions, courses, lessons, questions, quizQuestions, quizzes } from "@/db/schema";
import { ensureDbUser, requirePermission } from "@/lib/server-auth";
import QuizManager from "@/app/admin/quiz/quiz-manager";

export const dynamic = "force-dynamic";

export default async function QuizAdminPage() {
  const identity = await requireChatGPTUser("/admin/quiz"); const db = getDb(); const actor = await ensureDbUser(db, identity); requirePermission(actor.role, "course:read");
  const [lessonRows, questionRows, quizRows] = await Promise.all([
    db.select({ lesson: lessons, chapter: chapters, version: courseVersions, course: courses }).from(lessons).innerJoin(chapters, eq(chapters.id, lessons.chapterId)).innerJoin(courseVersions, eq(courseVersions.id, chapters.courseVersionId)).innerJoin(courses, eq(courses.id, courseVersions.courseId)),
    db.select().from(questions).where(eq(questions.active, true)),
    db.select({ quiz: quizzes, link: quizQuestions }).from(quizzes).leftJoin(quizQuestions, eq(quizQuestions.quizId, quizzes.id)),
  ]);
  const existing = [...quizRows.reduce((groups, { quiz, link }) => {
    const current = groups.get(quiz.id) ?? { id: quiz.id, lessonId: quiz.lessonId ?? "", title: quiz.title, feedbackMode: quiz.feedbackMode, passPercent: quiz.passPercent, questionIds: [] as string[] };
    if (link) current.questionIds.push(link.questionId);
    groups.set(quiz.id, current);
    return groups;
  }, new Map<string, { id: string; lessonId: string; title: string; feedbackMode: string; passPercent: number | null; questionIds: string[] }>()).values()];
  return <PageShell><section className="subpage-hero admin-hero"><p className="eyebrow">Administration · Quiz</p><h1>Quiz som<br />fäster.</h1><p>Välj frågor ur den centrala frågebanken och koppla dem till en specifik kurslektion.</p></section><QuizManager lessons={lessonRows.filter((row) => row.lesson.type === "quiz").map((row) => ({ id: row.lesson.id, courseId: row.version.courseId, label: `${row.course.name} · ${row.chapter.title} · ${row.lesson.title}` }))} questions={questionRows.map((row) => ({ id: row.id, courseId: row.courseId, prompt: row.prompt, topic: row.topic, difficulty: row.difficulty }))} existing={existing} /></PageShell>;
}
