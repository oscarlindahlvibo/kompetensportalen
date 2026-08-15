import { eq } from "drizzle-orm";
import { getDb } from "@/db";
import { auditLogs, profiles, users } from "@/db/schema";
import { encryptPersonalIdentity, normalizePersonalIdentity } from "@/lib/pii";
import { requireMutationIdentity, requirePermission, requestMetadata } from "@/lib/server-auth";

export const dynamic = "force-dynamic";

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  const identity = await requireMutationIdentity(request);
  if (identity instanceof Response) return identity;
  const { id } = await context.params;
  const body = await request.json() as { personalIdentity?: string };
  if (!body.personalIdentity) return Response.json({ error: "personal_identity_required" }, { status: 400 });
  let personalIdentity: string;
  try {
    personalIdentity = normalizePersonalIdentity(body.personalIdentity);
  } catch {
    return Response.json({ error: "personal_identity_invalid" }, { status: 400 });
  }
  const db = getDb();
  const actor = (await db.select().from(users).where(eq(users.email, identity.email)).limit(1))[0];
  requirePermission((actor?.role ?? "participant") as Parameters<typeof requirePermission>[0], "certification:write");
  const target = (await db.select().from(users).where(eq(users.id, id)).limit(1))[0];
  if (!target) return Response.json({ error: "participant_not_found" }, { status: 404 });
  const encrypted = await encryptPersonalIdentity(personalIdentity);
  const current = (await db.select().from(profiles).where(eq(profiles.userId, id)).limit(1))[0];
  if (current) {
    await db.update(profiles).set({ personalIdentityEncrypted: encrypted, identityLast4: personalIdentity.slice(-4), updatedAt: new Date().toISOString() }).where(eq(profiles.userId, id));
  } else {
    await db.insert(profiles).values({ userId: id, firstName: "", lastName: "", personalIdentityEncrypted: encrypted, identityLast4: personalIdentity.slice(-4) });
  }
  const metadata = await requestMetadata();
  await db.insert(auditLogs).values({ id: crypto.randomUUID(), actorUserId: actor?.id ?? null, targetType: "profile", targetId: id, action: "personal_identity_updated", beforeJson: JSON.stringify({ identityLast4: current?.identityLast4 ?? null }), afterJson: JSON.stringify({ identityLast4: personalIdentity.slice(-4) }), ipHash: metadata.ip, userAgent: metadata.userAgent });
  return Response.json({ ok: true, identityLast4: personalIdentity.slice(-4) });
}
