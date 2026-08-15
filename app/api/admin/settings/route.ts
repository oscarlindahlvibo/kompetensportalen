import { eq } from "drizzle-orm";
import { getDb } from "@/db";
import { auditLogs, systemSettings } from "@/db/schema";
import { ensureDbUser, requireApiIdentity, requireMutationIdentity, requirePermission, requestMetadata } from "@/lib/server-auth";
import { DEFAULT_REMINDER_WINDOWS, getReminderWindows, normalizeReminderWindows, REMINDER_WINDOWS_KEY } from "@/lib/settings";

export const dynamic = "force-dynamic";

export async function GET() {
  const identity = await requireApiIdentity();
  if (identity instanceof Response) return identity;
  const db = getDb();
  const actor = await ensureDbUser(db, identity);
  requirePermission(actor.role, "course:read");
  return Response.json({ reminderWindows: await getReminderWindows(db), defaults: DEFAULT_REMINDER_WINDOWS });
}

export async function PATCH(request: Request) {
  const identity = await requireMutationIdentity(request);
  if (identity instanceof Response) return identity;
  const body = await request.json().catch(() => ({})) as { reminderWindows?: unknown };
  let windows: number[];
  try { windows = normalizeReminderWindows(body.reminderWindows); } catch (error) { return Response.json({ error: error instanceof Error ? error.message : "invalid_reminder_windows" }, { status: 400 }); }
  const db = getDb();
  const actor = await ensureDbUser(db, identity);
  requirePermission(actor.role, "course:write");
  const current = (await db.select().from(systemSettings).where(eq(systemSettings.key, REMINDER_WINDOWS_KEY)).limit(1))[0];
  await db.insert(systemSettings).values({ key: REMINDER_WINDOWS_KEY, value: JSON.stringify(windows) }).onConflictDoUpdate({ target: systemSettings.key, set: { value: JSON.stringify(windows), updatedAt: new Date().toISOString() } });
  const metadata = await requestMetadata();
  await db.insert(auditLogs).values({ id: crypto.randomUUID(), actorUserId: actor.id, targetType: "system_setting", targetId: REMINDER_WINDOWS_KEY, action: "reminder_windows.updated", beforeJson: current?.value ?? JSON.stringify(DEFAULT_REMINDER_WINDOWS), afterJson: JSON.stringify(windows), ipHash: metadata.ip, userAgent: metadata.userAgent });
  return Response.json({ reminderWindows: windows });
}
