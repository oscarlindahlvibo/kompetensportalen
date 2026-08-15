import { mutationChanges } from "@/lib/db-compat";
import { and, desc, eq } from "drizzle-orm";
import { getDb } from "@/db";
import { answerOptions, auditLogs, chapters, courses, enrollments, examAttempts, examConfigs, examAnswers, lessonProgress, lessons, questions } from "@/db/schema";
import { ensureDbUser, requireApiIdentity, requestMetadata } from "@/lib/server-auth";
import { enrollmentIsAccessible, publicExamSnapshot, questionBelongsToCourseVersion } from "@/lib/platform";
import { recalculateEnrollmentProgress } from "@/lib/enrollment-progress";
import { queueTemplatedNotification } from "@/lib/notifications";
import { sameOriginGuard } from "@/lib/request-security";
import { rateLimit } from "@/lib/rate-limit";
import { CertificationError, issueCertificateForEnrollment } from "@/lib/certification";

export const dynamic = "force-dynamic";

type StoredSnapshotQuestion = { id: string; prompt: string; points: number; type: string; imageUrl?: string | null; options: { id: string; label: string }[]; correctOptionIds: string[] };
type PublicSnapshotQuestion = Omit<StoredSnapshotQuestion, "correctOptionIds">;

export async function GET(request: Request) {
  const identity = await requireApiIdentity();
  if (identity instanceof Response) return identity;
  const enrollmentId = new URL(request.url).searchParams.get("enrollmentId");
  if (!enrollmentId) return Response.json({ error: "enrollment_required" }, { status: 400 });
  const db = getDb();
  const user = await ensureDbUser(db, identity);
  const row = (await db.select({ enrollment: enrollments, config: examConfigs }).from(enrollments).leftJoin(examConfigs, eq(examConfigs.courseVersionId, enrollments.courseVersionId)).where(and(eq(enrollments.id, enrollmentId), eq(enrollments.userId, user.id))).limit(1))[0];
  if (!row) return Response.json({ error: "enrollment_not_found" }, { status: 404 });
  if (!enrollmentIsAccessible(row.enrollment)) return Response.json({ error: "enrollment_inactive" }, { status: 409 });
  if (!row.config) return Response.json({ error: "exam_config_missing" }, { status: 409 });
  const attempts = await db.select().from(examAttempts).where(eq(examAttempts.enrollmentId, enrollmentId)).orderBy(desc(examAttempts.attemptNumber));
  const active = attempts.find((attempt) => attempt.status === "started");
  return Response.json({
    config: row.config,
    attempts: attempts.map((attempt) => ({ id: attempt.id, attemptNumber: attempt.attemptNumber, status: attempt.status, scorePercent: attempt.scorePercent, passed: attempt.passed, startedAt: attempt.startedAt, finishedAt: attempt.finishedAt })),
    activeAttempt: active
      ? {
          id: active.id,
          startedAt: active.startedAt,
          snapshot: publicSnapshot(JSON.parse(active.questionSnapshotJson) as StoredSnapshotQuestion[]),
        }
      : null,
  });
}

export async function POST(request: Request) {
  const originError = sameOriginGuard(request);
  if (originError) return originError;
  const limited = rateLimit(request, "exam-start", 10);
  if (limited) return limited;
  const identity = await requireApiIdentity();
  if (identity instanceof Response) return identity;
  const body = await request.json() as { enrollmentId?: string };
  if (!body.enrollmentId) return Response.json({ error: "enrollment_required" }, { status: 400 });
  const db = getDb();
  const user = await ensureDbUser(db, identity);
  const row = (await db.select({ enrollment: enrollments, config: examConfigs }).from(enrollments).leftJoin(examConfigs, eq(examConfigs.courseVersionId, enrollments.courseVersionId)).where(and(eq(enrollments.id, body.enrollmentId), eq(enrollments.userId, user.id))).limit(1))[0];
  if (!row) return Response.json({ error: "enrollment_not_found" }, { status: 404 });
  if (!enrollmentIsAccessible(row.enrollment)) return Response.json({ error: "enrollment_inactive" }, { status: 409 });
  if (!row.config) return Response.json({ error: "exam_config_missing" }, { status: 409 });
  const config = row.config;
  const attempts = await db.select().from(examAttempts).where(eq(examAttempts.enrollmentId, row.enrollment.id)).orderBy(desc(examAttempts.attemptNumber));
  const active = attempts.find((attempt) => attempt.status === "started");
  if (active) return Response.json({ attemptId: active.id, snapshot: publicSnapshot(JSON.parse(active.questionSnapshotJson) as StoredSnapshotQuestion[]), config, startedAt: active.startedAt });
  if (attempts.length >= config.maxAttempts) return Response.json({ error: "maximum_attempts_reached" }, { status: 409 });
  const lastFinished = attempts.find((attempt) => attempt.finishedAt);
  if (lastFinished && config.cooldownSeconds > 0 && Date.parse(lastFinished.finishedAt!) + config.cooldownSeconds * 1000 > Date.now()) return Response.json({ error: "attempt_cooldown_active" }, { status: 409 });

  const examLessons = await db.select({ lesson: lessons, chapter: chapters }).from(lessons).innerJoin(chapters, eq(chapters.id, lessons.chapterId)).where(and(eq(chapters.courseVersionId, row.enrollment.courseVersionId), eq(lessons.type, "exam")));
  const examLessonIds = new Set(examLessons.map((item) => item.lesson.id));
  const requiredLessons = await db.select({ lesson: lessons }).from(lessons).innerJoin(chapters, eq(chapters.id, lessons.chapterId)).where(and(eq(chapters.courseVersionId, row.enrollment.courseVersionId), eq(lessons.required, true)));
  const progress = await db.select().from(lessonProgress).where(eq(lessonProgress.enrollmentId, row.enrollment.id));
  const completed = new Set(progress.filter((item) => item.status === "completed").map((item) => item.lessonId));
  if (requiredLessons.some(({ lesson }) => !examLessonIds.has(lesson.id) && !completed.has(lesson.id))) return Response.json({ error: "required_lessons_incomplete" }, { status: 409 });

  let bank = await db.select().from(questions).where(and(eq(questions.courseId, row.enrollment.courseId), eq(questions.active, true)));
  const versionChapterRows = await db.select({ id: chapters.id }).from(chapters).where(eq(chapters.courseVersionId, row.enrollment.courseVersionId));
  const versionChapterIds = new Set(versionChapterRows.map((chapter) => chapter.id));
  // Questions linked to a chapter belong to that version. A null chapterId
  // remains available as an intentionally course-wide question.
  bank = bank.filter((question) => questionBelongsToCourseVersion(question.chapterId, versionChapterIds));
  const topicRules = parseTopicRules(config.questionSelectionJson);
  if (topicRules.length) {
    const selected = [] as typeof bank;
    for (const rule of topicRules) {
      let topicBank = bank.filter((question) => question.topic === rule.topic);
      if (topicBank.length < rule.count) return Response.json({ error: "exam_topic_question_bank_insufficient", topic: rule.topic, availableQuestions: topicBank.length, requiredQuestions: rule.count }, { status: 409 });
      if (config.randomizeQuestions) topicBank = shuffle(topicBank);
      selected.push(...topicBank.slice(0, rule.count));
    }
    if (selected.length !== config.questionCount) return Response.json({ error: "exam_topic_rules_count_mismatch", selectedQuestions: selected.length, requiredQuestions: config.questionCount }, { status: 409 });
    bank = selected;
  } else {
    if (bank.length < config.questionCount) return Response.json({ error: "exam_question_bank_insufficient", availableQuestions: bank.length, requiredQuestions: config.questionCount }, { status: 409 });
    if (config.randomizeQuestions) bank = shuffle(bank);
    bank = bank.slice(0, Math.max(1, Math.min(config.questionCount, bank.length)));
  }
  const snapshot: StoredSnapshotQuestion[] = [];
  for (const question of bank) {
    const optionRows = await db.select({ id: answerOptions.id, label: answerOptions.label, isCorrect: answerOptions.isCorrect }).from(answerOptions).where(eq(answerOptions.questionId, question.id));
    let options = optionRows.map(({ id, label }) => ({ id, label }));
    if (config.randomizeAnswers) options = shuffle(options);
    snapshot.push({ id: question.id, prompt: question.prompt, points: question.points, type: question.type, imageUrl: question.imageUrl, options, correctOptionIds: optionRows.filter((option) => option.isCorrect).map((option) => option.id).sort() });
  }
  const attemptId = crypto.randomUUID();
  const startedAt = new Date().toISOString();
  const attemptNumber = attempts.length + 1;
  try {
    await db.insert(examAttempts).values({ id: attemptId, enrollmentId: row.enrollment.id, courseVersionId: row.enrollment.courseVersionId, attemptNumber, status: "started", startedAt, questionSnapshotJson: JSON.stringify(snapshot) });
  } catch {
    const concurrent = await db.select().from(examAttempts).where(and(eq(examAttempts.enrollmentId, row.enrollment.id), eq(examAttempts.attemptNumber, attemptNumber))).limit(1);
    if (concurrent[0]?.status === "started") return Response.json({ attemptId: concurrent[0].id, snapshot: publicSnapshot(JSON.parse(concurrent[0].questionSnapshotJson) as StoredSnapshotQuestion[]), config, startedAt: concurrent[0].startedAt }, { status: 200 });
    return Response.json({ error: "attempt_start_conflict" }, { status: 409 });
  }
  return Response.json({ attemptId, snapshot: publicSnapshot(snapshot), config, startedAt }, { status: 201 });
}

export async function PATCH(request: Request) {
  const originError = sameOriginGuard(request);
  if (originError) return originError;
  const limited = rateLimit(request, "exam-submit", 10);
  if (limited) return limited;
  const identity = await requireApiIdentity();
  if (identity instanceof Response) return identity;
  const body = await request.json() as { attemptId?: string; answers?: Record<string, string[]> };
  if (!body.attemptId || !body.answers) return Response.json({ error: "invalid_payload" }, { status: 400 });
  const db = getDb();
  const user = await ensureDbUser(db, identity);
  const row = (await db.select({ attempt: examAttempts, enrollment: enrollments, config: examConfigs }).from(examAttempts).innerJoin(enrollments, and(eq(enrollments.id, examAttempts.enrollmentId), eq(enrollments.userId, user.id))).leftJoin(examConfigs, eq(examConfigs.courseVersionId, examAttempts.courseVersionId)).where(eq(examAttempts.id, body.attemptId)).limit(1))[0];
  if (!row) return Response.json({ error: "attempt_not_found" }, { status: 404 });
  if (!enrollmentIsAccessible(row.enrollment)) return Response.json({ error: "enrollment_inactive" }, { status: 409 });
  if (row.attempt.status !== "started") return Response.json({ error: "attempt_already_finished" }, { status: 409 });
  const claim = await db
    .update(examAttempts)
    .set({ status: "grading" })
    .where(and(eq(examAttempts.id, row.attempt.id), eq(examAttempts.status, "started")))
    ;
  if ((mutationChanges(claim) ?? 0) !== 1)
    return Response.json({ error: "attempt_already_finished" }, { status: 409 });
  if (!row.config) return Response.json({ error: "exam_config_missing" }, { status: 409 });
  const config = row.config;
  const snapshot = JSON.parse(row.attempt.questionSnapshotJson) as StoredSnapshotQuestion[];
  const timedOut = config.timeLimitSeconds !== null && Date.parse(row.attempt.startedAt) + config.timeLimitSeconds * 1000 < Date.now();
  let points = 0;
  let maxPoints = 0;
  for (const question of snapshot) {
    const expected = question.correctOptionIds ?? (await db.select().from(answerOptions).where(eq(answerOptions.questionId, question.id))).filter((option) => option.isCorrect).map((option) => option.id).sort();
    const selected = [...(body.answers[question.id] ?? [])].sort();
    const correct = !timedOut && JSON.stringify(expected) === JSON.stringify(selected);
    maxPoints += question.points;
    if (correct) points += question.points;
    await db.insert(examAnswers).values({ id: crypto.randomUUID(), examAttemptId: row.attempt.id, questionId: question.id, selectedOptionIdsJson: JSON.stringify(selected), correct, pointsAwarded: correct ? question.points : 0 });
  }
  const scorePercent = maxPoints ? Math.round(points / maxPoints * 100) : 0;
  const passed = !timedOut && scorePercent >= config.passPercent;
  const finishedAt = new Date().toISOString();
  await db.update(examAttempts).set({ status: passed ? "passed" : "failed", finishedAt, scorePercent, passed }).where(eq(examAttempts.id, row.attempt.id));
  const auditMetadata = await requestMetadata();
  await db.insert(auditLogs).values({
    id: crypto.randomUUID(),
    actorUserId: user.id,
    targetType: "exam_attempt",
    targetId: row.attempt.id,
    action: "exam_attempt.completed",
    beforeJson: JSON.stringify({ status: "started", courseVersionId: row.attempt.courseVersionId }),
    afterJson: JSON.stringify({ status: passed ? "passed" : "failed", scorePercent, passed, timedOut, enrollmentId: row.enrollment.id, courseVersionId: row.attempt.courseVersionId }),
    ipHash: auditMetadata.ip,
    userAgent: auditMetadata.userAgent,
  });
  if (passed) {
    const examLesson = (await db.select({ lesson: lessons }).from(lessons).innerJoin(chapters, eq(chapters.id, lessons.chapterId)).where(and(eq(chapters.courseVersionId, row.enrollment.courseVersionId), eq(lessons.type, "exam"))).limit(1))[0];
    if (examLesson) await db.insert(lessonProgress).values({ id: crypto.randomUUID(), enrollmentId: row.enrollment.id, lessonId: examLesson.lesson.id, status: "completed", completedAt: finishedAt }).onConflictDoUpdate({ target: [lessonProgress.enrollmentId, lessonProgress.lessonId], set: { status: "completed", completedAt: finishedAt } });
    const course = (await db.select({ name: courses.name }).from(courses).where(eq(courses.id, row.enrollment.courseId)).limit(1))[0];
    if (course)
      await queueTemplatedNotification(db, {
        userId: user.id,
        type: "course_passed",
        variables: { courseName: course.name, accountUrl: "/mina-sidor" },
        fallbackSubject: `Du har klarat ${course.name}`,
        fallbackBody: `Du har klarat slutprovet för ${course.name}. Certifieringen hanteras nu enligt utbildningens krav.`,
        scheduledFor: `course-passed:${row.attempt.id}`,
      });
    // For courses without an identity gate, certification can complete
    // immediately. For gated courses the identity-admin workflow retries this
    // same idempotent service after verification.
    try {
      await issueCertificateForEnrollment(db, row.enrollment.id);
    } catch (error) {
      if (!(error instanceof CertificationError) || error.status >= 500) throw error;
    }
  }
  const progressPercent = await recalculateEnrollmentProgress(db, row.enrollment.id);
  return Response.json({ attemptId: row.attempt.id, scorePercent, passed, progressPercent, timedOut, passPercent: config.passPercent });
}

function publicSnapshot(snapshot: StoredSnapshotQuestion[]): PublicSnapshotQuestion[] {
  return publicExamSnapshot(snapshot).map((question) => ({ id: question.id, prompt: question.prompt, points: question.points, type: question.type, imageUrl: question.imageUrl, options: question.options }));
}

function parseTopicRules(value: string | null | undefined) {
  if (!value) return [] as { topic: string; count: number }[];
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed) ? parsed.filter((item): item is { topic: string; count: number } => Boolean(item && typeof item === "object" && typeof (item as { topic?: unknown }).topic === "string" && Number.isInteger((item as { count?: unknown }).count) && Number((item as { count: number }).count) > 0)) : [];
  } catch { return []; }
}

function shuffle<T>(items: T[]): T[] {
  const copy = [...items];
  for (let index = copy.length - 1; index > 0; index -= 1) {
    const target = Math.floor(Math.random() * (index + 1));
    [copy[index], copy[target]] = [copy[target], copy[index]];
  }
  return copy;
}
