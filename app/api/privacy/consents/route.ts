import { and, eq } from "drizzle-orm";
import { getDb } from "@/db";
import { auditLogs, consents } from "@/db/schema";
import { ensureDbUser, requireApiIdentity, requestMetadata } from "@/lib/server-auth";
import { sameOriginGuard } from "@/lib/request-security";
import { rateLimit } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

export async function GET() {
  const identity = await requireApiIdentity();
  if (identity instanceof Response) return identity;
  const db = getDb();
  const user = await ensureDbUser(db, identity);
  return Response.json({ consents: await db.select().from(consents).where(eq(consents.userId, user.id)) });
}

export async function POST(request: Request) {
  const originError = sameOriginGuard(request);
  if (originError) return originError;
  const limited = rateLimit(request, "privacy-consent", 30);
  if (limited) return limited;
  const identity = await requireApiIdentity();
  if (identity instanceof Response) return identity;
  const body = await request.json() as { consentType?: string; policyVersion?: string; granted?: boolean };
  if (!body.consentType || !body.policyVersion || typeof body.granted !== "boolean" || body.consentType.length > 120 || body.policyVersion.length > 80) return Response.json({ error: "consent_fields_required" }, { status: 400 });
  const db = getDb();
  const user = await ensureDbUser(db, identity);
  const current = (await db.select().from(consents).where(and(eq(consents.userId, user.id), eq(consents.consentType, body.consentType))).limit(1))[0];
  if (current) await db.update(consents).set({ policyVersion: body.policyVersion, grantedAt: body.granted ? new Date().toISOString() : current.grantedAt, withdrawnAt: body.granted ? null : new Date().toISOString() }).where(eq(consents.id, current.id));
  else await db.insert(consents).values({ id: crypto.randomUUID(), userId: user.id, consentType: body.consentType, policyVersion: body.policyVersion, grantedAt: body.granted ? new Date().toISOString() : new Date(0).toISOString(), withdrawnAt: body.granted ? null : new Date().toISOString() });
  const metadata = await requestMetadata();
  await db.insert(auditLogs).values({ id: crypto.randomUUID(), actorUserId: user.id, targetType: "consent", targetId: user.id, action: body.granted ? "consent.granted" : "consent.withdrawn", afterJson: JSON.stringify({ consentType: body.consentType, policyVersion: body.policyVersion }), ipHash: metadata.ip, userAgent: metadata.userAgent });
  return Response.json({ ok: true });
}
