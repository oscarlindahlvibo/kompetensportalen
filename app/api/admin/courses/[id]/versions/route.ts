import { and, desc, eq, inArray } from "drizzle-orm";
import { getDb } from "@/db";
import {
  answerOptions,
  chapters,
  courseVersionGoverningDocuments,
  courseVersions,
  courses,
  examConfigs,
  governingDocuments,
  lessons,
  questions,
  quizQuestions,
  quizzes,
  auditLogs,
} from "@/db/schema";
import {
  ensureDbUser,
  requireApiIdentity,
  requireMutationIdentity,
  requirePermission,
} from "@/lib/server-auth";

export const dynamic = "force-dynamic";

type LessonInput = {
  title: string;
  type?: "article" | "video" | "image" | "document" | "quiz" | "exam" | "mixed";
  body?: unknown;
  required?: boolean;
};
type ChapterInput = {
  title: string;
  description?: string;
  lessons?: LessonInput[];
};
type VersionInput = {
  version?: string;
  changelog?: string;
  status?: "draft" | "published";
  chapters?: ChapterInput[];
  governingDocumentIds?: string[];
};
const allowedBlockTypes = new Set([
  "text",
  "richtext",
  "heading",
  "list",
  "table",
  "link",
  "embed",
  "image",
  "video",
  "document",
  "callout",
]);

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const identity = await requireApiIdentity();
  if (identity instanceof Response) return identity;
  const { id } = await context.params;
  const db = getDb();
  const actor = await ensureDbUser(db, identity);
  requirePermission(actor.role, "course:read");
  const versions = await db
    .select()
    .from(courseVersions)
    .where(eq(courseVersions.courseId, id))
    .orderBy(desc(courseVersions.createdAt));
  return Response.json({ versions });
}

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const identity = await requireMutationIdentity(request);
  if (identity instanceof Response) return identity;
  const { id } = await context.params;
  const input = (await request.json()) as VersionInput;
  if (input.status === "published")
    return Response.json({ error: "direct_publish_not_allowed" }, { status: 400 });
  if (!input.version || !Array.isArray(input.chapters))
    return Response.json(
      { error: "version_and_chapters_required" },
      { status: 400 },
    );
  const invalidContent = input.chapters.some((chapter) =>
    (chapter.lessons ?? []).some((lesson) => {
      if (!lesson.title?.trim()) return true;
      const body = lesson.body as { blocks?: unknown[] } | undefined;
      return Boolean(
        body?.blocks?.some(
          (block) =>
            !block ||
            typeof block !== "object" ||
            !allowedBlockTypes.has(
              String((block as { type?: unknown }).type ?? "text"),
            ),
        ),
      );
    }),
  );
  if (invalidContent)
    return Response.json({ error: "invalid_lesson_content" }, { status: 400 });
  const db = getDb();
  const actor = await ensureDbUser(db, identity);
  requirePermission(actor.role, "course:write");
  const course = (
    await db.select().from(courses).where(eq(courses.id, id)).limit(1)
  )[0];
  if (!course)
    return Response.json({ error: "course_not_found" }, { status: 404 });
  const governingDocumentIds = [...new Set(input.governingDocumentIds ?? [])];
  if (governingDocumentIds.length) {
    const documents = await db
      .select({ id: governingDocuments.id })
      .from(governingDocuments)
      .where(inArray(governingDocuments.id, governingDocumentIds));
    if (documents.length !== governingDocumentIds.length)
      return Response.json({ error: "governing_document_not_found" }, { status: 400 });
  }
  const existing = await db
    .select()
    .from(courseVersions)
    .where(
      and(
        eq(courseVersions.courseId, id),
        eq(courseVersions.version, input.version),
      ),
    )
    .limit(1);
  if (existing[0])
    return Response.json({ error: "version_already_exists" }, { status: 409 });
  const versionId = crypto.randomUUID();
  const sourceVersion = (await db.select().from(courseVersions).where(and(eq(courseVersions.courseId, id), eq(courseVersions.status, "published"))).orderBy(desc(courseVersions.publishedAt), desc(courseVersions.createdAt)).limit(1))[0];
  const snapshot = {
    courseId: id,
    version: input.version,
    chapters: input.chapters,
    governingDocumentIds,
  };
  await db.insert(courseVersions).values({
    id: versionId,
    courseId: id,
    version: input.version,
    status: "draft",
    changelog: input.changelog ?? null,
    contentSnapshotJson: JSON.stringify(snapshot),
    publishedAt: null,
  });
  for (const governingDocumentId of governingDocumentIds)
    await db.insert(courseVersionGoverningDocuments).values({
      id: crypto.randomUUID(),
      courseVersionId: versionId,
      governingDocumentId,
    });
  const newChapterIdsBySortOrder = new Map<number, string>();
  const newLessonIdsByPosition = new Map<string, string>();
  for (const [chapterIndex, chapter] of input.chapters.entries()) {
    const chapterId = crypto.randomUUID();
    newChapterIdsBySortOrder.set(chapterIndex, chapterId);
    await db.insert(chapters).values({
      id: chapterId,
      courseVersionId: versionId,
      title: chapter.title,
      description: chapter.description ?? null,
      sortOrder: chapterIndex,
    });
    for (const [lessonIndex, lesson] of (chapter.lessons ?? []).entries()) {
      const lessonId = crypto.randomUUID();
      newLessonIdsByPosition.set(`${chapterIndex}:${lessonIndex}`, lessonId);
      await db.insert(lessons).values({
        id: lessonId,
        chapterId,
        title: lesson.title,
        type: lesson.type ?? "article",
        bodyJson: JSON.stringify(lesson.body ?? {}),
        required: lesson.required ?? true,
        sortOrder: lessonIndex,
      });
    }
  }
  if (sourceVersion) {
    const sourceExam = (await db.select().from(examConfigs).where(eq(examConfigs.courseVersionId, sourceVersion.id)).limit(1))[0];
    if (sourceExam) await db.insert(examConfigs).values({ id: crypto.randomUUID(), courseVersionId: versionId, questionCount: sourceExam.questionCount, passPercent: sourceExam.passPercent, timeLimitSeconds: sourceExam.timeLimitSeconds, maxAttempts: sourceExam.maxAttempts, cooldownSeconds: sourceExam.cooldownSeconds, randomizeQuestions: sourceExam.randomizeQuestions, randomizeAnswers: sourceExam.randomizeAnswers, questionSelectionJson: sourceExam.questionSelectionJson });
    const sourceChapters = await db.select().from(chapters).where(eq(chapters.courseVersionId, sourceVersion.id));
    const sourceChapterIds = sourceChapters.map((chapter) => chapter.id);
    const sourceQuestions = await db.select().from(questions).where(eq(questions.courseId, id));
    const questionIdMap = new Map<string, string>();
    for (const question of sourceQuestions) {
      const sourceChapter = sourceChapters.find((chapter) => chapter.id === question.chapterId);
      if (!sourceChapter) continue;
      const newChapterId = newChapterIdsBySortOrder.get(sourceChapter.sortOrder);
      if (!newChapterId) continue;
      const newQuestionId = crypto.randomUUID();
      questionIdMap.set(question.id, newQuestionId);
      await db.insert(questions).values({ id: newQuestionId, courseId: id, chapterId: newChapterId, topic: question.topic, difficulty: question.difficulty, type: question.type, prompt: question.prompt, explanation: question.explanation, points: question.points, imageUrl: question.imageUrl, active: question.active });
      const sourceAnswers = await db.select().from(answerOptions).where(eq(answerOptions.questionId, question.id));
      for (const answer of sourceAnswers) await db.insert(answerOptions).values({ id: crypto.randomUUID(), questionId: newQuestionId, label: answer.label, isCorrect: answer.isCorrect, sortOrder: answer.sortOrder });
    }
    const sourceLessons = sourceChapterIds.length ? (await Promise.all(sourceChapterIds.map((chapterId) => db.select().from(lessons).where(eq(lessons.chapterId, chapterId))))).flat() : [];
    for (const sourceLesson of sourceLessons) {
      const sourceChapter = sourceChapters.find((chapter) => chapter.id === sourceLesson.chapterId);
      if (!sourceChapter) continue;
      const newLessonId = newLessonIdsByPosition.get(`${sourceChapter.sortOrder}:${sourceLesson.sortOrder}`);
      if (!newLessonId) continue;
      const sourceQuiz = (await db.select().from(quizzes).where(eq(quizzes.lessonId, sourceLesson.id)).limit(1))[0];
      if (!sourceQuiz) continue;
      const newQuizId = crypto.randomUUID();
      await db.insert(quizzes).values({ id: newQuizId, lessonId: newLessonId, title: sourceQuiz.title, feedbackMode: sourceQuiz.feedbackMode, passPercent: sourceQuiz.passPercent });
      const links = await db.select().from(quizQuestions).where(eq(quizQuestions.quizId, sourceQuiz.id));
      for (const link of links) {
        const sourceQuestion = sourceQuestions.find((question) => question.id === link.questionId);
        const mappedQuestionId = questionIdMap.get(link.questionId);
        // Chapter-scoped questions must be copied into this version. Only
        // intentionally course-wide questions are allowed to retain their id.
        if (!sourceQuestion || (sourceQuestion.chapterId !== null && !mappedQuestionId)) continue;
        await db.insert(quizQuestions).values({ id: crypto.randomUUID(), quizId: newQuizId, questionId: mappedQuestionId ?? link.questionId, sortOrder: link.sortOrder });
      }
    }
  }
  await db.insert(auditLogs).values({
    id: crypto.randomUUID(),
    actorUserId: actor.id,
    targetType: "course_version",
    targetId: versionId,
    action: "course_version.created",
    beforeJson: null,
    afterJson: JSON.stringify({ courseId: id, version: input.version, status: "draft" }),
    ipHash: null,
    userAgent: null,
  });
  return Response.json(
    { versionId, status: "draft", copiedAssessments: Boolean(sourceVersion) },
    { status: 201 },
  );
}
