import { eq } from "drizzle-orm";
import { getDb } from "@/db";
import { auditLogs, courseVersions, examConfigs } from "@/db/schema";
import { ensureDbUser, requireApiIdentity, requireMutationIdentity, requirePermission, requestMetadata } from "@/lib/server-auth";

export const dynamic = "force-dynamic";

export async function GET(_request: Request, context: { params: Promise<{ versionId: string }> }) {
  const identity = await requireApiIdentity();
  if (identity instanceof Response) return identity;
  const { versionId } = await context.params;
  const db = getDb();
  const actor = await ensureDbUser(db, identity);
  requirePermission(actor.role, "course:read");
  const version = (await db.select().from(courseVersions).where(eq(courseVersions.id, versionId)).limit(1))[0];
  if (!version) return Response.json({ error: "version_not_found" }, { status: 404 });
  const config = (await db.select().from(examConfigs).where(eq(examConfigs.courseVersionId, versionId)).limit(1))[0] ?? null;
  return Response.json({ config });
}

export async function PATCH(request: Request, context: { params: Promise<{ versionId: string }> }) {
  const identity = await requireMutationIdentity(request);
  if (identity instanceof Response) return identity;
  const { versionId } = await context.params;
  const body = await request.json() as Partial<{ questionCount: number; passPercent: number; timeLimitSeconds: number | null; maxAttempts: number; cooldownSeconds: number; randomizeQuestions: boolean; randomizeAnswers: boolean; topicRulesJson: string }>;
  const db = getDb();
  const actor = await ensureDbUser(db, identity);
  requirePermission(actor.role, "course:write");
  const version = (await db.select().from(courseVersions).where(eq(courseVersions.id, versionId)).limit(1))[0];
  if (!version) return Response.json({ error: "version_not_found" }, { status: 404 });
  if (version.status === "published") return Response.json({ error: "published_version_immutable" }, { status: 409 });
  const values = {
    questionCount: integer(body.questionCount, 1, 200, 30),
    passPercent: integer(body.passPercent, 1, 100, 80),
    timeLimitSeconds: body.timeLimitSeconds === null ? null : integer(body.timeLimitSeconds, 60, 86400, 3600),
    maxAttempts: integer(body.maxAttempts, 1, 20, 3),
    cooldownSeconds: integer(body.cooldownSeconds, 0, 604800, 0),
    randomizeQuestions: body.randomizeQuestions !== false,
    randomizeAnswers: body.randomizeAnswers !== false,
    questionSelectionJson: normalizeTopicRules(body.topicRulesJson),
  };
  const before = (await db.select().from(examConfigs).where(eq(examConfigs.courseVersionId, versionId)).limit(1))[0] ?? null;
  await db.insert(examConfigs).values({ id: `exam_config_${versionId}`, courseVersionId: versionId, ...values }).onConflictDoUpdate({ target: examConfigs.courseVersionId, set: values });
  const config = (await db.select().from(examConfigs).where(eq(examConfigs.courseVersionId, versionId)).limit(1))[0];
  if (!config) return Response.json({ error: "exam_config_not_saved" }, { status: 500 });
  const metadata = await requestMetadata();
  await db.insert(auditLogs).values({ id: crypto.randomUUID(), actorUserId: actor.id, targetType: "exam_config", targetId: versionId, action: before ? "exam_config.updated" : "exam_config.created", beforeJson: before ? JSON.stringify({ questionCount: before.questionCount, passPercent: before.passPercent, timeLimitSeconds: before.timeLimitSeconds, maxAttempts: before.maxAttempts, cooldownSeconds: before.cooldownSeconds, questionSelectionJson: before.questionSelectionJson }) : null, afterJson: JSON.stringify({ questionCount: config.questionCount, passPercent: config.passPercent, timeLimitSeconds: config.timeLimitSeconds, maxAttempts: config.maxAttempts, cooldownSeconds: config.cooldownSeconds, questionSelectionJson: config.questionSelectionJson }), ipHash: metadata.ip, userAgent: metadata.userAgent });
  return Response.json({ config });
}

function normalizeTopicRules(value: string | undefined) {
  if (!value?.trim()) return "[]";
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!Array.isArray(parsed)) throw new Error("not_array");
    const rules = parsed.map((item) => {
      const rule = item as { topic?: unknown; count?: unknown };
      if (typeof rule.topic !== "string" || !rule.topic.trim() || !Number.isInteger(rule.count) || Number(rule.count) < 1) throw new Error("invalid_rule");
      return { topic: rule.topic.trim(), count: Number(rule.count) };
    });
    return JSON.stringify(rules);
  } catch {
    throw new Response(JSON.stringify({ error: "invalid_topic_rules" }), { status: 400 });
  }
}

function integer(value: number | undefined | null, min: number, max: number, fallback: number) {
  return Number.isInteger(value) ? Math.max(min, Math.min(max, value as number)) : fallback;
}
