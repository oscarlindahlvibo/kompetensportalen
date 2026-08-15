import { and, eq, inArray } from "drizzle-orm";
import { getDb } from "@/db";
import { auditLogs, companies, companyMembers, notifications, users } from "@/db/schema";
import { ensureDbUser, requireMutationIdentity, requirePermission, requestMetadata } from "@/lib/server-auth";
import { rateLimit } from "@/lib/rate-limit";
import { sameOriginGuard } from "@/lib/request-security";

export const dynamic = "force-dynamic";
const MAX_RECIPIENTS = 1000;
const INSERT_BATCH_SIZE = 50;
const MAX_SUBJECT_LENGTH = 200;
const MAX_BODY_LENGTH = 50_000;

type BroadcastInput = { audience?: "all_participants" | "company"; companyId?: string; subject?: string; body?: string };

export async function POST(request: Request) {
  const originError = sameOriginGuard(request);
  if (originError) return originError;
  const limited = rateLimit(request, "admin-broadcast", 5);
  if (limited) return limited;
  const identity = await requireMutationIdentity(request);
  if (identity instanceof Response) return identity;
  const input = await request.json().catch(() => ({})) as BroadcastInput;
  const audience = input.audience ?? "all_participants";
  const subject = input.subject?.trim();
  const body = input.body?.trim();
  if (!["all_participants", "company"].includes(audience)) return Response.json({ error: "invalid_audience" }, { status: 400 });
  if (!subject || subject.length > MAX_SUBJECT_LENGTH) return Response.json({ error: "invalid_subject" }, { status: 400 });
  if (!body || body.length > MAX_BODY_LENGTH) return Response.json({ error: "invalid_body" }, { status: 400 });
  if (audience === "company" && !input.companyId) return Response.json({ error: "company_required" }, { status: 400 });
  const db = getDb();
  const actor = await ensureDbUser(db, identity);
  requirePermission(actor.role, "communication:write");

  let recipientIds: string[];
  if (audience === "company") {
    const company = (await db.select({ id: companies.id }).from(companies).where(eq(companies.id, input.companyId!)).limit(1))[0];
    if (!company) return Response.json({ error: "company_not_found" }, { status: 404 });
    recipientIds = (await db.select({ userId: companyMembers.userId }).from(companyMembers).where(and(eq(companyMembers.companyId, company.id), inArray(companyMembers.role, ["admin", "employee"]))))
      .map(({ userId }) => userId);
  } else {
    recipientIds = (await db.select({ id: users.id }).from(users).where(and(eq(users.status, "active"), inArray(users.role, ["participant", "company_admin"]))))
      .map(({ id }) => id);
  }
  recipientIds = [...new Set(recipientIds)];
  if (!recipientIds.length) return Response.json({ error: "no_recipients" }, { status: 409 });
  if (recipientIds.length > MAX_RECIPIENTS) return Response.json({ error: "recipient_limit_exceeded", maxRecipients: MAX_RECIPIENTS }, { status: 413 });

  const broadcastId = crypto.randomUUID();
  const scheduledFor = `broadcast:${broadcastId}`;
  for (let offset = 0; offset < recipientIds.length; offset += INSERT_BATCH_SIZE) {
    const batch = recipientIds.slice(offset, offset + INSERT_BATCH_SIZE);
    await db.insert(notifications).values(batch.map((userId) => ({ id: crypto.randomUUID(), userId, recipientEmail: null, type: "admin_broadcast", subject, body, status: "queued" as const, scheduledFor })));
  }
  const metadata = await requestMetadata();
  await db.insert(auditLogs).values({ id: crypto.randomUUID(), actorUserId: actor.id, targetType: "notification_broadcast", targetId: broadcastId, action: "notification_broadcast.queued", beforeJson: null, afterJson: JSON.stringify({ audience, companyId: input.companyId ?? null, recipientCount: recipientIds.length, subject }), ipHash: metadata.ip, userAgent: metadata.userAgent });
  return Response.json({ broadcastId, queued: recipientIds.length, status: "queued" }, { status: 201 });
}
