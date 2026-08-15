import { desc, eq } from "drizzle-orm";
import { getDb } from "@/db";
import { auditLogs, contactMessages } from "@/db/schema";
import { ensureDbUser, requireApiIdentity, requireMutationIdentity, requirePermission, requestMetadata } from "@/lib/server-auth";

export const dynamic = "force-dynamic";

export async function GET() {
  const identity = await requireApiIdentity();
  if (identity instanceof Response) return identity;
  const db = getDb();
  const actor = await ensureDbUser(db, identity);
  requirePermission(actor.role, "support:read");
  return Response.json({ messages: await db.select().from(contactMessages).orderBy(desc(contactMessages.createdAt)).limit(200) });
}

export async function PATCH(request: Request) {
  const identity = await requireMutationIdentity(request);
  if (identity instanceof Response) return identity;
  const body = await request.json().catch(() => ({})) as { id?: string; status?: "new" | "in_progress" | "closed" };
  if (!body.id || !body.status) return Response.json({ error: "message_and_status_required" }, { status: 400 });
  if (!["new", "in_progress", "closed"].includes(body.status)) return Response.json({ error: "invalid_message_status" }, { status: 400 });
  const db = getDb();
  const actor = await ensureDbUser(db, identity);
  requirePermission(actor.role, "support:write");
  const current = (await db.select().from(contactMessages).where(eq(contactMessages.id, body.id)).limit(1))[0];
  if (!current) return Response.json({ error: "message_not_found" }, { status: 404 });
  await db.update(contactMessages).set({ status: body.status }).where(eq(contactMessages.id, body.id));
  const metadata = await requestMetadata();
  await db.insert(auditLogs).values({ id: crypto.randomUUID(), actorUserId: actor.id, targetType: "contact_message", targetId: current.id, action: "contact_message.status_changed", beforeJson: JSON.stringify({ status: current.status }), afterJson: JSON.stringify({ status: body.status }), ipHash: metadata.ip, userAgent: metadata.userAgent });
  return Response.json({ id: current.id, status: body.status });
}
