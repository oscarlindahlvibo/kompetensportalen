import { mutationChanges } from "@/lib/db-compat";
import { and, eq } from "drizzle-orm";
import { getDb } from "@/db";
import { auditLogs, certificates, competencies } from "@/db/schema";
import { ensureDbUser, requireMutationIdentity, requirePermission, requestMetadata } from "@/lib/server-auth";

export const dynamic = "force-dynamic";

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  const identity = await requireMutationIdentity(request);
  if (identity instanceof Response) return identity;
  const { id } = await context.params;
  const body = await request.json().catch(() => ({})) as { status?: "revoked"; reason?: string };
  if (body.status !== "revoked" || !body.reason?.trim())
    return Response.json({ error: "revocation_reason_required" }, { status: 400 });
  if (body.reason.trim().length > 2000)
    return Response.json({ error: "revocation_reason_too_long" }, { status: 400 });
  const db = getDb();
  const actor = await ensureDbUser(db, identity);
  requirePermission(actor.role, "certification:write");
  const certificate = (await db.select().from(certificates).where(eq(certificates.id, id)).limit(1))[0];
  if (!certificate) return Response.json({ error: "certificate_not_found" }, { status: 404 });
  if (certificate.status === "revoked") return Response.json({ ok: true, status: "revoked", idempotent: true });
  const claim = await db.update(certificates)
    .set({ status: "revoked" })
    .where(and(eq(certificates.id, id), eq(certificates.status, certificate.status)))
    ;
  if ((mutationChanges(claim) ?? 0) !== 1)
    return Response.json({ error: "certificate_changed" }, { status: 409 });
  await db.update(competencies)
    .set({ status: "revoked" })
    .where(and(eq(competencies.certificateId, id), eq(competencies.status, "valid")));
  const metadata = await requestMetadata();
  await db.insert(auditLogs).values({
    id: crypto.randomUUID(),
    actorUserId: actor.id,
    targetType: "certificate",
    targetId: id,
    action: "certificate.revoked",
    beforeJson: JSON.stringify({ status: certificate.status }),
    afterJson: JSON.stringify({ status: "revoked", reason: body.reason.trim() }),
    ipHash: metadata.ip,
    userAgent: metadata.userAgent,
  });
  return Response.json({ ok: true, status: "revoked" });
}
