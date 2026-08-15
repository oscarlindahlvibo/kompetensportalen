import { eq } from "drizzle-orm";
import { getDb } from "@/db";
import { auditLogs, governingDocuments } from "@/db/schema";
import { ensureDbUser, requireApiIdentity, requireMutationIdentity, requirePermission, requestMetadata } from "@/lib/server-auth";

export const dynamic = "force-dynamic";

type DocumentInput = { title?: string; documentNumber?: string | null; version?: string | null; publishedAt?: string | null; url?: string | null; lastCheckedAt?: string | null; notes?: string | null };

export async function GET() {
  const identity = await requireApiIdentity();
  if (identity instanceof Response) return identity;
  const db = getDb();
  const actor = await ensureDbUser(db, identity);
  requirePermission(actor.role, "course:read");
  return Response.json({ documents: await db.select().from(governingDocuments) });
}

export async function POST(request: Request) {
  const identity = await requireMutationIdentity(request);
  if (identity instanceof Response) return identity;
  const input = await request.json() as DocumentInput;
  if (!input.title) return Response.json({ error: "title_required" }, { status: 400 });
  const db = getDb();
  const actor = await ensureDbUser(db, identity);
  requirePermission(actor.role, "course:write");
  const document = { id: crypto.randomUUID(), title: input.title, documentNumber: input.documentNumber ?? null, version: input.version ?? null, publishedAt: input.publishedAt ?? null, url: input.url ?? null, lastCheckedAt: input.lastCheckedAt ?? null, responsibleUserId: actor.id, notes: input.notes ?? null };
  await db.insert(governingDocuments).values(document);
  const metadata = await requestMetadata();
  await db.insert(auditLogs).values({ id: crypto.randomUUID(), actorUserId: actor.id, targetType: "governing_document", targetId: document.id, action: "governing_document.created", beforeJson: null, afterJson: JSON.stringify({ title: document.title, documentNumber: document.documentNumber, version: document.version }), ipHash: metadata.ip, userAgent: metadata.userAgent });
  return Response.json({ document }, { status: 201 });
}

export async function PATCH(request: Request) {
  const identity = await requireMutationIdentity(request);
  if (identity instanceof Response) return identity;
  const input = await request.json() as DocumentInput & { id?: string };
  if (!input.id) return Response.json({ error: "document_id_required" }, { status: 400 });
  const db = getDb();
  const actor = await ensureDbUser(db, identity);
  requirePermission(actor.role, "course:write");
  const current = (await db.select().from(governingDocuments).where(eq(governingDocuments.id, input.id)).limit(1))[0];
  if (!current) return Response.json({ error: "document_not_found" }, { status: 404 });
  const next = { title: input.title ?? current.title, documentNumber: input.documentNumber ?? current.documentNumber, version: input.version ?? current.version, publishedAt: input.publishedAt ?? current.publishedAt, url: input.url ?? current.url, lastCheckedAt: input.lastCheckedAt ?? current.lastCheckedAt, notes: input.notes ?? current.notes };
  await db.update(governingDocuments).set(next).where(eq(governingDocuments.id, input.id));
  const metadata = await requestMetadata();
  await db.insert(auditLogs).values({ id: crypto.randomUUID(), actorUserId: actor.id, targetType: "governing_document", targetId: input.id, action: "governing_document.updated", beforeJson: JSON.stringify({ title: current.title, documentNumber: current.documentNumber, version: current.version, publishedAt: current.publishedAt, lastCheckedAt: current.lastCheckedAt }), afterJson: JSON.stringify({ title: next.title, documentNumber: next.documentNumber, version: next.version, publishedAt: next.publishedAt, lastCheckedAt: next.lastCheckedAt }), ipHash: metadata.ip, userAgent: metadata.userAgent });
  return Response.json({ ok: true });
}
