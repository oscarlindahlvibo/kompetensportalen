import { and, eq, inArray } from "drizzle-orm";
import { getDb } from "@/db";
import { auditLogs, chapters, courseVersions, lessons, questions, quizQuestions, quizzes } from "@/db/schema";
import { ensureDbUser, requireMutationIdentity, requirePermission } from "@/lib/server-auth";
import { questionBelongsToCourseVersion } from "@/lib/platform";

export const dynamic = "force-dynamic";

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  const identity = await requireMutationIdentity(request);
  if (identity instanceof Response) return identity;
  const input = await request.json() as { title?: string; feedbackMode?: "immediate" | "after_submit" | "none"; passPercent?: number | null; questionIds?: string[] };
  if (!input.title?.trim() || !Array.isArray(input.questionIds) || !input.questionIds.length) return Response.json({ error: "quiz_fields_required" }, { status: 400 });
  if (input.feedbackMode && !["immediate", "after_submit", "none"].includes(input.feedbackMode)) return Response.json({ error: "invalid_feedback_mode" }, { status: 400 });
  if (input.passPercent !== null && input.passPercent !== undefined && (!Number.isInteger(input.passPercent) || input.passPercent < 1 || input.passPercent > 100)) return Response.json({ error: "invalid_pass_percent" }, { status: 400 });
  const db = getDb(); const actor = await ensureDbUser(db, identity); requirePermission(actor.role, "question:write");
  const row = (await db.select({ quiz: quizzes, lesson: lessons, chapter: chapters, version: courseVersions }).from(quizzes).innerJoin(lessons, eq(lessons.id, quizzes.lessonId)).innerJoin(chapters, eq(chapters.id, lessons.chapterId)).innerJoin(courseVersions, eq(courseVersions.id, chapters.courseVersionId)).where(eq(quizzes.id, (await context.params).id)).limit(1))[0];
  if (!row) return Response.json({ error: "quiz_not_found" }, { status: 404 });
  if (row.version.status !== "draft") return Response.json({ error: "published_version_immutable" }, { status: 409 });
  const ids = [...new Set(input.questionIds)];
  const selected = await db.select().from(questions).where(and(inArray(questions.id, ids), eq(questions.courseId, row.version.courseId), eq(questions.active, true)));
  const versionChapterIds = new Set((await db.select({ id: chapters.id }).from(chapters).where(eq(chapters.courseVersionId, row.version.id))).map((chapter) => chapter.id));
  if (selected.length !== ids.length || selected.some((question) => !questionBelongsToCourseVersion(question.chapterId, versionChapterIds))) return Response.json({ error: "invalid_quiz_questions" }, { status: 400 });
  const before = { title: row.quiz.title, feedbackMode: row.quiz.feedbackMode, passPercent: row.quiz.passPercent };
  await db.update(quizzes).set({ title: input.title.trim(), feedbackMode: input.feedbackMode ?? "immediate", passPercent: input.passPercent ?? null }).where(eq(quizzes.id, row.quiz.id));
  await db.delete(quizQuestions).where(eq(quizQuestions.quizId, row.quiz.id));
  for (const [sortOrder, questionId] of input.questionIds.entries()) await db.insert(quizQuestions).values({ id: crypto.randomUUID(), quizId: row.quiz.id, questionId, sortOrder });
  await db.insert(auditLogs).values({ id: crypto.randomUUID(), actorUserId: actor.id, targetType: "quiz", targetId: row.quiz.id, action: "quiz.updated", beforeJson: JSON.stringify(before), afterJson: JSON.stringify({ title: input.title.trim(), feedbackMode: input.feedbackMode ?? "immediate", passPercent: input.passPercent ?? null, questionIds: input.questionIds }), ipHash: null, userAgent: null });
  return Response.json({ quizId: row.quiz.id });
}
