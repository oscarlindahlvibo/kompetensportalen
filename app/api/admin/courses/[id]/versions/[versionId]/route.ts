import { and, eq, inArray, ne } from "drizzle-orm";
import { getDb } from "@/db";
import {
  answerOptions,
  auditLogs,
  chapters,
  courseVersionGoverningDocuments,
  courseVersions,
  enrollments,
  governingDocuments,
  lessons,
  questions,
  quizQuestions,
  quizzes,
} from "@/db/schema";
import { ensureDbUser, requireApiIdentity, requireMutationIdentity, requirePermission } from "@/lib/server-auth";

export const dynamic = "force-dynamic";

type LessonInput = { title: string; type?: "article" | "video" | "image" | "document" | "quiz" | "exam" | "mixed"; body?: unknown; required?: boolean };
type ChapterInput = { title: string; description?: string; lessons?: LessonInput[] };
type VersionInput = { version?: string; changelog?: string; chapters?: ChapterInput[]; governingDocumentIds?: string[] };
const allowedBlockTypes = new Set(["text", "richtext", "heading", "list", "table", "link", "embed", "image", "video", "document", "callout"]);

export async function GET(_request: Request, context: { params: Promise<{ id: string; versionId: string }> }) {
  const identity = await requireApiIdentity();
  if (identity instanceof Response) return identity;
  const { id, versionId } = await context.params;
  const db = getDb();
  const actor = await ensureDbUser(db, identity);
  requirePermission(actor.role, "course:read");
  const version = (await db.select().from(courseVersions).where(and(eq(courseVersions.id, versionId), eq(courseVersions.courseId, id))).limit(1))[0];
  if (!version) return Response.json({ error: "version_not_found" }, { status: 404 });
  const chapterRows = await db.select({ chapter: chapters, lesson: lessons }).from(chapters).leftJoin(lessons, eq(lessons.chapterId, chapters.id)).where(eq(chapters.courseVersionId, versionId));
  const links = await db.select({ governingDocumentId: courseVersionGoverningDocuments.governingDocumentId }).from(courseVersionGoverningDocuments).where(eq(courseVersionGoverningDocuments.courseVersionId, versionId));
  return Response.json({ version, governingDocumentIds: links.map((link) => link.governingDocumentId), chapters: chapterRows.filter((row) => row.lesson).reduce<Array<{ id: string; title: string; description: string | null; sortOrder: number; lessons: unknown[] }>>((result, row) => {
    let chapter = result.find((item) => item.id === row.chapter.id);
    if (!chapter) { chapter = { id: row.chapter.id, title: row.chapter.title, description: row.chapter.description, sortOrder: row.chapter.sortOrder, lessons: [] }; result.push(chapter); }
    if (row.lesson) chapter.lessons.push({ ...row.lesson, body: parseBody(row.lesson.bodyJson) });
    return result;
  }, []).sort((a, b) => a.sortOrder - b.sortOrder).map((chapter) => ({ ...chapter, lessons: (chapter.lessons as Array<{ sortOrder: number }>).sort((a, b) => a.sortOrder - b.sortOrder) })) });
}

export async function PATCH(request: Request, context: { params: Promise<{ id: string; versionId: string }> }) {
  const identity = await requireMutationIdentity(request);
  if (identity instanceof Response) return identity;
  const { id, versionId } = await context.params;
  const input = (await request.json()) as VersionInput;
  if (!input.version?.trim() || !Array.isArray(input.chapters)) return Response.json({ error: "version_and_chapters_required" }, { status: 400 });
  if (input.chapters.some((chapter) => !chapter.title?.trim() || (chapter.lessons ?? []).some((lesson) => !lesson.title?.trim() || hasInvalidBlocks(lesson.body)))) return Response.json({ error: "invalid_lesson_content" }, { status: 400 });
  const db = getDb();
  const actor = await ensureDbUser(db, identity);
  requirePermission(actor.role, "course:write");
  const version = (await db.select().from(courseVersions).where(and(eq(courseVersions.id, versionId), eq(courseVersions.courseId, id))).limit(1))[0];
  if (!version) return Response.json({ error: "version_not_found" }, { status: 404 });
  if (version.status !== "draft") return Response.json({ error: "published_version_immutable" }, { status: 409 });
  const duplicate = (await db.select({ id: courseVersions.id }).from(courseVersions).where(and(eq(courseVersions.courseId, id), eq(courseVersions.version, input.version.trim()), ne(courseVersions.id, versionId))).limit(1))[0];
  if (duplicate) return Response.json({ error: "version_already_exists" }, { status: 409 });
  if ((await db.select({ id: enrollments.id }).from(enrollments).where(eq(enrollments.courseVersionId, versionId)).limit(1))[0]) return Response.json({ error: "version_has_enrollments" }, { status: 409 });
  const documentIds = [...new Set(input.governingDocumentIds ?? [])];
  if (documentIds.length && (await db.select({ id: governingDocuments.id }).from(governingDocuments).where(inArray(governingDocuments.id, documentIds))).length !== documentIds.length) return Response.json({ error: "governing_document_not_found" }, { status: 400 });
  const oldChapters = await db.select().from(chapters).where(eq(chapters.courseVersionId, versionId));
  const oldChapterIds = oldChapters.map((chapter) => chapter.id);
  const oldLessons = oldChapterIds.length ? await db.select().from(lessons).where(inArray(lessons.chapterId, oldChapterIds)) : [];
  const oldLessonIds = oldLessons.map((lesson) => lesson.id);
  const oldQuizzes = oldLessonIds.length ? await db.select().from(quizzes).where(inArray(quizzes.lessonId, oldLessonIds)) : [];
  const oldQuizQuestions = oldQuizzes.length ? await db.select().from(quizQuestions).where(inArray(quizQuestions.quizId, oldQuizzes.map((quiz) => quiz.id))) : [];
  const oldQuestions = oldChapterIds.length ? (await db.select().from(questions).where(and(eq(questions.courseId, id), inArray(questions.chapterId, oldChapterIds)))) : [];
  const allCourseQuestions = await db.select({ id: questions.id, chapterId: questions.chapterId }).from(questions).where(eq(questions.courseId, id));
  const oldAnswers = new Map<string, typeof answerOptions.$inferSelect[]>();
  for (const question of oldQuestions) oldAnswers.set(question.id, await db.select().from(answerOptions).where(eq(answerOptions.questionId, question.id)));
  if (oldLessonIds.length) {
    if (oldQuizzes.length) await db.delete(quizQuestions).where(inArray(quizQuestions.quizId, oldQuizzes.map((quiz) => quiz.id)));
    if (oldQuizzes.length) await db.delete(quizzes).where(inArray(quizzes.id, oldQuizzes.map((quiz) => quiz.id)));
    await db.delete(lessons).where(inArray(lessons.id, oldLessonIds));
  }
  if (oldQuestions.length) {
    await db.delete(answerOptions).where(inArray(answerOptions.questionId, oldQuestions.map((question) => question.id)));
    await db.delete(questions).where(inArray(questions.id, oldQuestions.map((question) => question.id)));
  }
  await db.delete(chapters).where(eq(chapters.courseVersionId, versionId));
  await db.delete(courseVersionGoverningDocuments).where(eq(courseVersionGoverningDocuments.courseVersionId, versionId));
  const newChapterIds = new Map<number, string>();
  const newLessonIds = new Map<string, string>();
  for (const [chapterIndex, chapter] of input.chapters.entries()) {
    const chapterId = crypto.randomUUID();
    newChapterIds.set(chapterIndex, chapterId);
    await db.insert(chapters).values({ id: chapterId, courseVersionId: versionId, title: chapter.title.trim(), description: chapter.description?.trim() || null, sortOrder: chapterIndex });
    for (const [lessonIndex, lesson] of (chapter.lessons ?? []).entries()) {
      const lessonId = crypto.randomUUID();
      newLessonIds.set(`${chapterIndex}:${lessonIndex}`, lessonId);
      await db.insert(lessons).values({ id: lessonId, chapterId, title: lesson.title.trim(), type: lesson.type ?? "article", bodyJson: JSON.stringify(lesson.body ?? {}), required: lesson.required ?? true, sortOrder: lessonIndex });
    }
  }
  const questionIdMap = new Map<string, string>();
  for (const question of oldQuestions) {
    const oldChapter = oldChapters.find((chapter) => chapter.id === question.chapterId);
    const newChapterId = oldChapter ? newChapterIds.get(oldChapter.sortOrder) : null;
    if (!oldChapter || !newChapterId) continue;
    const newQuestionId = crypto.randomUUID();
    questionIdMap.set(question.id, newQuestionId);
    await db.insert(questions).values({ id: newQuestionId, courseId: id, chapterId: newChapterId, topic: question.topic, difficulty: question.difficulty, type: question.type, prompt: question.prompt, explanation: question.explanation, points: question.points, imageUrl: question.imageUrl, active: question.active });
    for (const answer of oldAnswers.get(question.id) ?? []) await db.insert(answerOptions).values({ id: crypto.randomUUID(), questionId: newQuestionId, label: answer.label, isCorrect: answer.isCorrect, sortOrder: answer.sortOrder });
  }
  for (const oldQuiz of oldQuizzes) {
    const oldLesson = oldLessons.find((lesson) => lesson.id === oldQuiz.lessonId);
    const oldChapter = oldLesson ? oldChapters.find((chapter) => chapter.id === oldLesson.chapterId) : null;
    const newLessonId = oldChapter && oldLesson ? newLessonIds.get(`${oldChapter.sortOrder}:${oldLesson.sortOrder}`) : null;
    if (!newLessonId) continue;
    const newQuizId = crypto.randomUUID();
    await db.insert(quizzes).values({ id: newQuizId, lessonId: newLessonId, title: oldQuiz.title, feedbackMode: oldQuiz.feedbackMode, passPercent: oldQuiz.passPercent });
    for (const link of oldQuizQuestions.filter((item) => item.quizId === oldQuiz.id)) {
      const sourceQuestion = allCourseQuestions.find((question) => question.id === link.questionId);
      const mappedQuestionId = questionIdMap.get(link.questionId);
      if (!sourceQuestion || (sourceQuestion.chapterId !== null && !mappedQuestionId)) continue;
      await db.insert(quizQuestions).values({ id: crypto.randomUUID(), quizId: newQuizId, questionId: mappedQuestionId ?? link.questionId, sortOrder: link.sortOrder });
    }
  }
  for (const governingDocumentId of documentIds) await db.insert(courseVersionGoverningDocuments).values({ id: crypto.randomUUID(), courseVersionId: versionId, governingDocumentId });
  const snapshot = { courseId: id, version: input.version.trim(), chapters: input.chapters, governingDocumentIds: documentIds };
  await db.update(courseVersions).set({ version: input.version.trim(), changelog: input.changelog?.trim() || null, contentSnapshotJson: JSON.stringify(snapshot), updatedAt: new Date().toISOString() }).where(eq(courseVersions.id, versionId));
  await db.insert(auditLogs).values({ id: crypto.randomUUID(), actorUserId: actor.id, targetType: "course_version", targetId: versionId, action: "course_version.updated", beforeJson: JSON.stringify({ version: version.version }), afterJson: JSON.stringify({ version: input.version.trim(), status: "draft" }), ipHash: null, userAgent: null });
  return Response.json({ versionId, status: "draft", assessmentsPreserved: oldQuestions.length > 0 || oldQuizzes.length > 0 });
}

function hasInvalidBlocks(body: unknown) {
  const blocks = (body as { blocks?: unknown[] } | undefined)?.blocks;
  return Boolean(blocks?.some((block) => !block || typeof block !== "object" || !allowedBlockTypes.has(String((block as { type?: unknown }).type ?? "text"))));
}

function parseBody(value: string) {
  try { return JSON.parse(value); } catch { return {}; }
}
