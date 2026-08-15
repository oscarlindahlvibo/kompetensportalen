import { and, eq } from "drizzle-orm";
import { getChatGPTUser } from "@/app/chatgpt-auth";
import { getDb } from "@/db";
import { answerOptions, chapters, enrollments, questions, quizQuestions, quizzes, lessons } from "@/db/schema";
import { ensureDbUser } from "@/lib/server-auth";
import { enrollmentIsAccessible } from "@/lib/platform";
import { questionBelongsToCourseVersion } from "@/lib/platform";
import { sameOriginGuard } from "@/lib/request-security";
import { rateLimit } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const identity = await getChatGPTUser();
  if (!identity) return Response.json({ error: "authentication_required" }, { status: 401 });
  const { id } = await context.params;
  const enrollmentId = new URL(request.url).searchParams.get("enrollmentId");
  if (!enrollmentId) return Response.json({ error: "enrollment_required" }, { status: 400 });
  const db = getDb();
  const user = await ensureDbUser(db, identity);
  const row = (await db.select({ quiz: quizzes, lesson: lessons, chapter: chapters, enrollment: enrollments })
    .from(quizzes).innerJoin(lessons, eq(lessons.id, quizzes.lessonId)).innerJoin(chapters, eq(chapters.id, lessons.chapterId))
    .innerJoin(enrollments, and(eq(enrollments.id, enrollmentId), eq(enrollments.userId, user.id), eq(enrollments.courseVersionId, chapters.courseVersionId)))
    .where(eq(quizzes.id, id)).limit(1))[0];
  if (!row) return Response.json({ error: "quiz_not_found" }, { status: 404 });
  if (!enrollmentIsAccessible(row.enrollment)) return Response.json({ error: "enrollment_inactive" }, { status: 409 });
  const linked = await db.select({ question: questions, link: quizQuestions }).from(quizQuestions).innerJoin(questions, eq(questions.id, quizQuestions.questionId)).where(eq(quizQuestions.quizId, id));
  const versionChapterIds = new Set((await db.select({ id: chapters.id }).from(chapters).where(eq(chapters.courseVersionId, row.chapter.courseVersionId))).map((chapter) => chapter.id));
  const items = await Promise.all(linked.filter(({ question }) => question.courseId === row.enrollment.courseId && questionBelongsToCourseVersion(question.chapterId, versionChapterIds)).sort((a, b) => a.link.sortOrder - b.link.sortOrder).map(async ({ question }) => ({
    id: question.id,
    prompt: question.prompt,
    type: question.type,
    points: question.points,
    imageUrl: question.imageUrl,
    options: (await db.select({ id: answerOptions.id, label: answerOptions.label }).from(answerOptions).where(eq(answerOptions.questionId, question.id))).sort((a, b) => a.id.localeCompare(b.id)),
  })));
  return Response.json({ quiz: { id: row.quiz.id, title: row.quiz.title, feedbackMode: row.quiz.feedbackMode, passPercent: row.quiz.passPercent }, questions: items });
}

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const originError = sameOriginGuard(request);
  if (originError) return originError;
  const limited = rateLimit(request, "quiz-answer-check", 60);
  if (limited) return limited;
  const identity = await getChatGPTUser();
  if (!identity) return Response.json({ error: "authentication_required" }, { status: 401 });
  const { id } = await context.params;
  const body = await request.json() as { enrollmentId?: string; questionId?: string; selectedOptionIds?: string[] };
  if (!body.enrollmentId || !body.questionId || !Array.isArray(body.selectedOptionIds)) return Response.json({ error: "invalid_payload" }, { status: 400 });
  const db = getDb();
  const user = await ensureDbUser(db, identity);
  const row = (await db.select({ quiz: quizzes, question: questions, lesson: lessons, chapter: chapters, enrollment: enrollments })
    .from(quizQuestions).innerJoin(quizzes, eq(quizzes.id, quizQuestions.quizId)).innerJoin(questions, eq(questions.id, quizQuestions.questionId))
    .innerJoin(lessons, eq(lessons.id, quizzes.lessonId)).innerJoin(chapters, eq(chapters.id, lessons.chapterId))
    .innerJoin(enrollments, and(eq(enrollments.id, body.enrollmentId), eq(enrollments.userId, user.id), eq(enrollments.courseVersionId, chapters.courseVersionId)))
    .where(and(eq(quizQuestions.quizId, id), eq(quizQuestions.questionId, body.questionId))).limit(1))[0];
  if (!row || row.question.courseId !== row.enrollment.courseId) return Response.json({ error: "question_not_found" }, { status: 404 });
  if (!enrollmentIsAccessible(row.enrollment)) return Response.json({ error: "enrollment_inactive" }, { status: 409 });
  const versionChapterIds = new Set((await db.select({ id: chapters.id }).from(chapters).where(eq(chapters.courseVersionId, row.chapter.courseVersionId))).map((chapter) => chapter.id));
  if (!questionBelongsToCourseVersion(row.question.chapterId, versionChapterIds)) return Response.json({ error: "question_not_found" }, { status: 404 });
  const options = await db.select().from(answerOptions).where(eq(answerOptions.questionId, row.question.id));
  const expected = options.filter((option) => option.isCorrect).map((option) => option.id).sort();
  const selected = [...body.selectedOptionIds].sort();
  const correct = JSON.stringify(expected) === JSON.stringify(selected);
  return Response.json({ correct, explanation: row.quiz.feedbackMode === "none" ? null : row.question.explanation, correctOptionLabels: correct ? [] : options.filter((option) => expected.includes(option.id)).map((option) => option.label) });
}
