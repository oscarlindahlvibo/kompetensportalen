import { eq } from "drizzle-orm";
import { systemSettings } from "@/db/schema";

type Database = ReturnType<typeof import("@/db").getDb>;

export const DEFAULT_REMINDER_WINDOWS = [90, 60, 30, 7];
const REMINDER_WINDOWS_KEY = "reminder_windows_days";

export async function getReminderWindows(db: Database) {
  const setting = (await db.select().from(systemSettings).where(eq(systemSettings.key, REMINDER_WINDOWS_KEY)).limit(1))[0];
  if (!setting) return DEFAULT_REMINDER_WINDOWS;
  try {
    const parsed = JSON.parse(setting.value) as unknown;
    return normalizeReminderWindows(parsed);
  } catch {
    return DEFAULT_REMINDER_WINDOWS;
  }
}

export function normalizeReminderWindows(value: unknown) {
  if (!Array.isArray(value)) throw new Error("reminder_windows_required");
  const windows = [...new Set(value.filter((item): item is number => Number.isInteger(item) && item > 0 && item <= 3650))].sort((a, b) => b - a);
  if (!windows.length || windows.length > 12 || windows.length !== value.length) throw new Error("invalid_reminder_windows");
  return windows;
}

export { REMINDER_WINDOWS_KEY };
