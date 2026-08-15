import { getDb } from "@/db";
import { ensureDbUser, requireApiIdentity, requirePermission } from "@/lib/server-auth";
import { queueExpiringReminders } from "@/lib/reminders";
import { sameOriginGuard } from "@/lib/request-security";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const originError = sameOriginGuard(request);
  if (originError) return originError;
  const identity = await requireApiIdentity();
  if (identity instanceof Response) return identity;
  const body = await request.json().catch(() => ({})) as { days?: number };
  const days = Number.isInteger(body.days) && (body.days ?? 0) > 0 ? body.days! : 30;
  const db = getDb();
  const actor = await ensureDbUser(db, identity);
  requirePermission(actor.role, "certification:read");
  return Response.json(await queueExpiringReminders(db, days));
}
