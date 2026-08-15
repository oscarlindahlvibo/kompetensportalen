import { and, eq } from "drizzle-orm";
import { getDb } from "@/db";
import { answerOptions, auditLogs, chapters, courseVersions, questions } from "@/db/schema";
import { ensureDbUser, requireApiIdentity, requireMutationIdentity, requirePermission, requestMetadata } from "@/lib/server-auth";

export const dynamic = "force-dynamic";

type QuestionInput = { courseId?: string; chapterId?: string | null; topic?: string; difficulty?: "easy" | "medium" | "hard"; type?: "single" | "multiple" | "true_false" | "image"; prompt?: string; explanation?: string; points?: number; imageUrl?: string | null; answers?: { label: string; isCorrect: boolean }[] };

export async function GET(request: Request) {
  const identity = await requireApiIdentity();
  if (identity instanceof Response) return identity;
  const courseId = new URL(request.url).searchParams.get("courseId");
  const db = getDb();
  const actor = await ensureDbUser(db, identity);
  requirePermission(actor.role, "course:read");
  const rows = await db.select().from(questions).where(courseId ? eq(questions.courseId, courseId) : undefined);
  return Response.json({ questions: rows });
}

export async function POST(request: Request) {
  const identity = await requireMutationIdentity(request);
  if (identity instanceof Response) return identity;
  const input = await request.json() as QuestionInput;
  if (!input.courseId || !input.prompt || !input.topic || !input.type) return Response.json({ error: "question_fields_required" }, { status: 400 });
  const db = getDb();
  const actor = await ensureDbUser(db, identity);
  requirePermission(actor.role, "question:write");
  const publishedVersion = (await db.select({ id: courseVersions.id }).from(courseVersions).where(and(eq(courseVersions.courseId, input.courseId), eq(courseVersions.status, "published"))).limit(1))[0];
  if (publishedVersion) return Response.json({ error: "published_course_question_immutable" }, { status: 409 });
  const validAnswers = (input.answers ?? []).filter((answer) => typeof answer.label === "string" && answer.label.trim());
  if (!validAnswers.length || !validAnswers.some((answer) => answer.isCorrect)) return Response.json({ error: "answers_required" }, { status: 400 });
  if ((input.type === "single" || input.type === "true_false" || input.type === "image") && validAnswers.filter((answer) => answer.isCorrect).length !== 1) return Response.json({ error: "single_correct_answer_required" }, { status: 400 });
  if (input.chapterId) {
    const chapter = (await db.select({ courseId: courseVersions.courseId, versionStatus: courseVersions.status }).from(chapters).innerJoin(courseVersions, eq(courseVersions.id, chapters.courseVersionId)).where(eq(chapters.id, input.chapterId)).limit(1))[0];
    if (!chapter || chapter.courseId !== input.courseId) return Response.json({ error: "chapter_course_mismatch" }, { status: 400 });
    if (chapter.versionStatus === "published") return Response.json({ error: "published_version_immutable" }, { status: 409 });
  }
  const questionId = crypto.randomUUID();
  await db.insert(questions).values({ id: questionId, courseId: input.courseId, chapterId: input.chapterId ?? null, topic: input.topic, difficulty: input.difficulty ?? "medium", type: input.type, prompt: input.prompt, explanation: input.explanation ?? null, points: input.points ?? 1, imageUrl: input.imageUrl ?? null, active: true });
  for (const [index, answer] of validAnswers.entries()) await db.insert(answerOptions).values({ id: crypto.randomUUID(), questionId, label: answer.label.trim(), isCorrect: Boolean(answer.isCorrect), sortOrder: index });
  const metadata = await requestMetadata();
  await db.insert(auditLogs).values({ id: crypto.randomUUID(), actorUserId: actor.id, targetType: "question", targetId: questionId, action: "question.created", beforeJson: null, afterJson: JSON.stringify({ courseId: input.courseId, topic: input.topic, type: input.type }), ipHash: metadata.ip, userAgent: metadata.userAgent });
  return Response.json({ questionId }, { status: 201 });
}

export async function PATCH(request: Request) {
  const identity = await requireMutationIdentity(request);
  if (identity instanceof Response) return identity;
  const input = await request.json() as QuestionInput & { id?: string; active?: boolean };
  if (!input.id) return Response.json({ error: "question_required" }, { status: 400 });
  const db = getDb();
  const actor = await ensureDbUser(db, identity);
  requirePermission(actor.role, "question:write");
  const existing = (await db.select().from(questions).where(eq(questions.id, input.id)).limit(1))[0];
  if (!existing) return Response.json({ error: "question_not_found" }, { status: 404 });
  const publishedVersion = (await db.select({ id: courseVersions.id }).from(courseVersions).where(and(eq(courseVersions.courseId, existing.courseId), eq(courseVersions.status, "published"))).limit(1))[0];
  if (publishedVersion) return Response.json({ error: "published_course_question_immutable" }, { status: 409 });
  const isStatusOnly = typeof input.active === "boolean" && Object.keys(input).every((key) => key === "id" || key === "active");
  if (isStatusOnly) {
    await db.update(questions).set({ active: input.active, updatedAt: new Date().toISOString() }).where(eq(questions.id, input.id));
    const metadata = await requestMetadata();
    await db.insert(auditLogs).values({ id: crypto.randomUUID(), actorUserId: actor.id, targetType: "question", targetId: input.id, action: "question.status_changed", beforeJson: JSON.stringify({ active: existing.active }), afterJson: JSON.stringify({ active: input.active }), ipHash: metadata.ip, userAgent: metadata.userAgent });
    return Response.json({ id: input.id, active: input.active });
  }
  if (!input.topic?.trim() || !input.prompt?.trim() || !input.type) return Response.json({ error: "question_fields_required" }, { status: 400 });
  const validAnswers = (input.answers ?? []).filter((answer) => typeof answer.label === "string" && answer.label.trim());
  if (!validAnswers.length || !validAnswers.some((answer) => answer.isCorrect)) return Response.json({ error: "answers_required" }, { status: 400 });
  if (input.type === "single" || input.type === "true_false" || input.type === "image") {
    if (validAnswers.filter((answer) => answer.isCorrect).length !== 1) return Response.json({ error: "single_correct_answer_required" }, { status: 400 });
  }
  const now = new Date().toISOString();
  await db.update(questions).set({ topic: input.topic.trim(), difficulty: input.difficulty ?? existing.difficulty, type: input.type, prompt: input.prompt.trim(), explanation: input.explanation?.trim() || null, points: Number.isInteger(input.points) ? Math.max(1, Math.min(100, input.points!)) : existing.points, imageUrl: input.imageUrl?.trim() || null, updatedAt: now }).where(eq(questions.id, input.id));
  await db.delete(answerOptions).where(eq(answerOptions.questionId, input.id));
  for (const [index, answer] of validAnswers.entries()) await db.insert(answerOptions).values({ id: crypto.randomUUID(), questionId: input.id, label: answer.label.trim(), isCorrect: Boolean(answer.isCorrect), sortOrder: index });
  const metadata = await requestMetadata();
  await db.insert(auditLogs).values({ id: crypto.randomUUID(), actorUserId: actor.id, targetType: "question", targetId: input.id, action: "question.updated", beforeJson: JSON.stringify({ topic: existing.topic, type: existing.type, difficulty: existing.difficulty, points: existing.points }), afterJson: JSON.stringify({ topic: input.topic.trim(), type: input.type, difficulty: input.difficulty ?? existing.difficulty, points: Number.isInteger(input.points) ? Math.max(1, Math.min(100, input.points!)) : existing.points }), ipHash: metadata.ip, userAgent: metadata.userAgent });
  return Response.json({ id: input.id, updated: true });
}
