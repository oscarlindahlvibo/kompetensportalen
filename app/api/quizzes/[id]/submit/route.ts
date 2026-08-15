import { and, eq } from "drizzle-orm";
import { getChatGPTUser } from "@/app/chatgpt-auth";
import { getDb } from "@/db";
import { answerOptions, auditLogs, chapters, enrollments, lessonProgress, lessons, questions, quizAttempts, quizQuestions, quizzes } from "@/db/schema";
import { ensureDbUser, requestMetadata } from "@/lib/server-auth";
import { enrollmentIsAccessible } from "@/lib/platform";
import { questionBelongsToCourseVersion } from "@/lib/platform";
import { recalculateEnrollmentProgress } from "@/lib/enrollment-progress";
import { sameOriginGuard } from "@/lib/request-security";
import { rateLimit } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const originError = sameOriginGuard(request);
  if (originError) return originError;
  const limited = rateLimit(request, "quiz-submit", 20);
  if (limited) return limited;
  const identity = await getChatGPTUser();
  if (!identity) return Response.json({ error: "authentication_required" }, { status: 401 });
  const { id } = await context.params;
  const body = await request.json() as { enrollmentId?: string; answers?: Record<string, string[]> };
  if (!body.enrollmentId || !body.answers) return Response.json({ error: "invalid_payload" }, { status: 400 });
  const db = getDb();
  const user = await ensureDbUser(db, identity);
  const quizRows = await db.select({ quiz: quizzes, lesson: lessons, chapter: chapters, enrollment: enrollments }).from(quizzes)
    .innerJoin(lessons, eq(lessons.id, quizzes.lessonId))
    .innerJoin(chapters, eq(chapters.id, lessons.chapterId))
    .innerJoin(enrollments, and(eq(enrollments.courseVersionId, chapters.courseVersionId), eq(enrollments.id, body.enrollmentId), eq(enrollments.userId, user.id)))
    .where(eq(quizzes.id, id)).limit(1);
  if (!quizRows[0]) return Response.json({ error: "quiz_not_found" }, { status: 404 });
  if (!enrollmentIsAccessible(quizRows[0].enrollment)) return Response.json({ error: "enrollment_inactive" }, { status: 409 });
  const linked = await db.select({ question: questions }).from(quizQuestions).innerJoin(questions, eq(questions.id, quizQuestions.questionId)).where(eq(quizQuestions.quizId, id));
  const versionChapterIds = new Set((await db.select({ id: chapters.id }).from(chapters).where(eq(chapters.courseVersionId, quizRows[0].chapter.courseVersionId))).map((chapter) => chapter.id));
  const versionLinked = linked.filter(({ question }) => question.courseId === quizRows[0].enrollment.courseId && questionBelongsToCourseVersion(question.chapterId, versionChapterIds));
  let correctCount = 0;
  const results = [];
  const questionSnapshot = [];
  for (const item of versionLinked) {
    const options = await db.select().from(answerOptions).where(eq(answerOptions.questionId, item.question.id));
    const expected = options.filter((option) => option.isCorrect).map((option) => option.id).sort();
    const selected = [...(body.answers[item.question.id] ?? [])].sort();
    const correct = JSON.stringify(expected) === JSON.stringify(selected);
    if (correct) correctCount += 1;
    questionSnapshot.push({ id: item.question.id, prompt: item.question.prompt, type: item.question.type, imageUrl: item.question.imageUrl, points: item.question.points, explanation: item.question.explanation, options: options.map((option) => ({ id: option.id, label: option.label, isCorrect: option.isCorrect })) });
    results.push({ questionId: item.question.id, correct, explanation: quizRows[0].quiz.feedbackMode === "none" ? null : item.question.explanation });
  }
  const scorePercent = versionLinked.length ? Math.round(correctCount / versionLinked.length * 100) : 0;
  const passed = quizRows[0].quiz.passPercent === null || scorePercent >= quizRows[0].quiz.passPercent;
  const priorAttempts = await db.select().from(quizAttempts).where(and(eq(quizAttempts.enrollmentId, body.enrollmentId), eq(quizAttempts.quizId, id)));
  const submittedAt = new Date().toISOString();
  const attemptId = crypto.randomUUID();
  await db.insert(quizAttempts).values({ id: attemptId, enrollmentId: body.enrollmentId, quizId: id, courseVersionId: quizRows[0].chapter.courseVersionId, attemptNumber: priorAttempts.length + 1, questionSnapshotJson: JSON.stringify(questionSnapshot), answersJson: JSON.stringify(body.answers), scorePercent, passed, submittedAt });
  const metadata = await requestMetadata();
  await db.insert(auditLogs).values({ id: crypto.randomUUID(), actorUserId: user.id, targetType: "quiz_attempt", targetId: attemptId, action: "quiz_attempt.completed", beforeJson: null, afterJson: JSON.stringify({ enrollmentId: body.enrollmentId, quizId: id, courseVersionId: quizRows[0].chapter.courseVersionId, scorePercent, passed, attemptNumber: priorAttempts.length + 1 }), ipHash: metadata.ip, userAgent: metadata.userAgent });
  if (passed) await db.insert(lessonProgress).values({ id: crypto.randomUUID(), enrollmentId: body.enrollmentId, lessonId: quizRows[0].lesson.id, status: "completed", completedAt: new Date().toISOString() }).onConflictDoUpdate({ target: [lessonProgress.enrollmentId, lessonProgress.lessonId], set: { status: "completed", completedAt: new Date().toISOString() } });
  const progressPercent = await recalculateEnrollmentProgress(db, body.enrollmentId);
  return Response.json({ attemptId, scorePercent, passed, progressPercent, results });
}
