import { and, eq, inArray } from "drizzle-orm";
import { getDb } from "@/db";
import { auditLogs, chapters, courseVersions, lessons, questions, quizQuestions, quizzes } from "@/db/schema";
import { ensureDbUser, requireMutationIdentity, requirePermission } from "@/lib/server-auth";
import { questionBelongsToCourseVersion } from "@/lib/platform";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const identity = await requireMutationIdentity(request);
  if (identity instanceof Response) return identity;
  const input = await request.json() as { lessonId?: string; title?: string; feedbackMode?: "immediate" | "after_submit" | "none"; passPercent?: number | null; questionIds?: string[] };
  if (!input.lessonId || !input.title?.trim() || !Array.isArray(input.questionIds) || !input.questionIds.length) return Response.json({ error: "quiz_fields_required" }, { status: 400 });
  if (input.feedbackMode && !["immediate", "after_submit", "none"].includes(input.feedbackMode)) return Response.json({ error: "invalid_feedback_mode" }, { status: 400 });
  if (input.passPercent !== null && input.passPercent !== undefined && (!Number.isInteger(input.passPercent) || input.passPercent < 1 || input.passPercent > 100)) return Response.json({ error: "invalid_pass_percent" }, { status: 400 });
  const db = getDb(); const actor = await ensureDbUser(db, identity); requirePermission(actor.role, "question:write");
  const lessonRow = (await db.select({ lesson: lessons, chapter: chapters, version: courseVersions }).from(lessons).innerJoin(chapters, eq(chapters.id, lessons.chapterId)).innerJoin(courseVersions, eq(courseVersions.id, chapters.courseVersionId)).where(eq(lessons.id, input.lessonId)).limit(1))[0];
  if (!lessonRow) return Response.json({ error: "lesson_not_found" }, { status: 404 });
  if (lessonRow.version.status === "published") return Response.json({ error: "published_version_immutable" }, { status: 409 });
  const existing = (await db.select().from(quizzes).where(eq(quizzes.lessonId, input.lessonId)).limit(1))[0];
  if (existing) return Response.json({ error: "quiz_already_exists" }, { status: 409 });
  const selected = await db.select().from(questions).where(and(inArray(questions.id, input.questionIds), eq(questions.courseId, lessonRow.version.courseId), eq(questions.active, true)));
  const versionChapterIds = new Set((await db.select({ id: chapters.id }).from(chapters).where(eq(chapters.courseVersionId, lessonRow.version.id))).map((chapter) => chapter.id));
  if (selected.length !== new Set(input.questionIds).size || selected.some((question) => !questionBelongsToCourseVersion(question.chapterId, versionChapterIds))) return Response.json({ error: "invalid_quiz_questions" }, { status: 400 });
  const quizId = crypto.randomUUID();
  await db.insert(quizzes).values({ id: quizId, lessonId: input.lessonId, title: input.title.trim(), feedbackMode: input.feedbackMode ?? "immediate", passPercent: input.passPercent ?? null });
  for (const [index, questionId] of input.questionIds.entries()) await db.insert(quizQuestions).values({ id: crypto.randomUUID(), quizId, questionId, sortOrder: index });
  await db.insert(auditLogs).values({ id: crypto.randomUUID(), actorUserId: actor.id, targetType: "quiz", targetId: quizId, action: "quiz.created", beforeJson: null, afterJson: JSON.stringify({ lessonId: input.lessonId, title: input.title.trim(), questionIds: input.questionIds }), ipHash: null, userAgent: null });
  return Response.json({ quizId }, { status: 201 });
}
