import { getDb } from "@/db";
import { auditLogs, profiles, users } from "@/db/schema";
import { ensureDbUser, requireApiIdentity, requestMetadata } from "@/lib/server-auth";
import { eq } from "drizzle-orm";
import { sameOriginGuard } from "@/lib/request-security";
import { rateLimit } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const originError = sameOriginGuard(request);
  if (originError) return originError;
  const limited = rateLimit(request, "privacy-anonymize", 3);
  if (limited) return limited;
  const identity = await requireApiIdentity();
  if (identity instanceof Response) return identity;
  const db = getDb();
  const user = await ensureDbUser(db, identity);
  const now = Date.now();
  const anonymizedEmail = `anonymized-${user.id}-${now}@invalid.local`;
  const before = { userId: user.id, status: user.status };
  await db.update(users).set({ email: anonymizedEmail, status: "anonymized" }).where(eq(users.id, user.id));
  await db.update(profiles).set({ firstName: "Anonymiserad", lastName: "Deltagare", phone: null, personalIdentityEncrypted: null, identityLast4: null, gdprState: "anonymized" }).where(eq(profiles.userId, user.id));
  const metadata = await requestMetadata();
  await db.insert(auditLogs).values({ id: crypto.randomUUID(), actorUserId: user.id, targetType: "user", targetId: user.id, action: "gdpr.anonymize", beforeJson: JSON.stringify(before), afterJson: JSON.stringify({ userId: user.id, status: "anonymized" }), ipHash: metadata.ip, userAgent: metadata.userAgent });
  return Response.json({ ok: true, preserved: "Historiska enrollments, prov, certifikat och revisionsspår bevaras enligt dokumentationskrav." });
}
