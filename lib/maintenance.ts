import { getDb } from "@/db";
import { dispatchQueuedNotifications, type MailRuntime } from "@/lib/notifications";
import { queueExpiringReminders, syncValidityStatuses } from "@/lib/reminders";
import { getReminderWindows } from "@/lib/settings";

type Database = ReturnType<typeof getDb>;

/** Runs the daily maintenance sequence used by the Worker cron. */
export async function runDailyMaintenance(db: Database, runtime: MailRuntime) {
  const validity = await syncValidityStatuses(db);
  const reminderWindows = await getReminderWindows(db);
  const reminders = await Promise.all(
    reminderWindows.map((days) => queueExpiringReminders(db, days)),
  );
  const mail = await dispatchQueuedNotifications(db, runtime);
  return { validity, reminderWindows, reminders, mail };
}
