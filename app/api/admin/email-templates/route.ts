import { eq } from "drizzle-orm";
import { getDb } from "@/db";
import { emailTemplates } from "@/db/schema";
import { ensureDbUser, requireApiIdentity, requireMutationIdentity, requirePermission } from "@/lib/server-auth";

export const dynamic = "force-dynamic";

type TemplateInput = { key?: string; name?: string; subject?: string; body?: string; active?: boolean };

export async function GET() {
  const identity = await requireApiIdentity();
  if (identity instanceof Response) return identity;
  const db = getDb();
  const actor = await ensureDbUser(db, identity);
  requirePermission(actor.role, "communication:write");
  return Response.json({ templates: await db.select().from(emailTemplates) });
}

export async function POST(request: Request) {
  const identity = await requireMutationIdentity(request);
  if (identity instanceof Response) return identity;
  const input = await request.json() as TemplateInput;
  if (!input.key || !input.name || !input.subject || !input.body) return Response.json({ error: "template_fields_required" }, { status: 400 });
  const db = getDb();
  const actor = await ensureDbUser(db, identity);
  requirePermission(actor.role, "communication:write");
  const template = { id: crypto.randomUUID(), key: input.key.trim(), name: input.name.trim(), subject: input.subject, body: input.body, active: input.active ?? true };
  await db.insert(emailTemplates).values(template);
  return Response.json({ template }, { status: 201 });
}

export async function PATCH(request: Request) {
  const identity = await requireMutationIdentity(request);
  if (identity instanceof Response) return identity;
  const input = await request.json() as TemplateInput & { id?: string };
  if (!input.id) return Response.json({ error: "template_id_required" }, { status: 400 });
  const db = getDb();
  const actor = await ensureDbUser(db, identity);
  requirePermission(actor.role, "communication:write");
  await db.update(emailTemplates).set({ name: input.name, subject: input.subject, body: input.body, active: input.active }).where(eq(emailTemplates.id, input.id));
  return Response.json({ ok: true });
}
