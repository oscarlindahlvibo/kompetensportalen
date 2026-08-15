import { mutationChanges } from "@/lib/db-compat";
import { and, eq, inArray, isNull } from "drizzle-orm";
import { getDb } from "@/db";
import { emailTemplates, notifications, users } from "@/db/schema";
import { PlaceholderMailAdapter, ResendMailAdapter } from "@/lib/integrations";
import { renderEmailTemplate } from "@/lib/email-templates";

type Database = ReturnType<typeof getDb>;
export type MailRuntime = {
  MAIL_PROVIDER?: string;
  MAIL_API_KEY?: string;
  MAIL_FROM?: string;
};

export const defaultEmailTemplates = [
  {
    key: "welcome",
    name: "Välkommen",
    subject: "Välkommen till Kompetensportalen",
    body: '<p>Välkommen till Kompetensportalen.</p><p>Logga in på <a href="{{accountUrl}}">Mina sidor</a> för att se dina utbildningar och order.</p>',
  },
  {
    key: "course_assigned",
    name: "Du har fått en utbildning",
    subject: "Du har fått utbildningen {{courseName}}",
    body: '<p>Du har fått tillgång till <strong>{{courseName}}</strong>.</p><p><a href="{{courseUrl}}">Logga in på Mina sidor för att börja utbildningen.</a></p>',
  },
  {
    key: "order_confirmation",
    name: "Orderbekräftelse",
    subject: "Orderbekräftelse {{orderId}}",
    body: '<p>Tack för din beställning.</p><p>Order <strong>{{orderId}}</strong> är registrerad. Ordervärde: <strong>{{totalSek}} kr</strong>.</p><p><a href="{{accountUrl}}">Öppna Mina sidor</a></p>',
  },
  {
    key: "course_started",
    name: "Kurs påbörjad",
    subject: "Du har påbörjat {{courseName}}",
    body: '<p>Du har påbörjat <strong>{{courseName}}</strong>.</p><p><a href="{{courseUrl}}">Fortsätt utbildningen</a></p>',
  },
  {
    key: "course_passed",
    name: "Kurs godkänd",
    subject: "Du har klarat {{courseName}}",
    body: '<p>Grattis! Du har klarat slutprovet för <strong>{{courseName}}</strong>.</p><p>Certifieringen hanteras nu enligt utbildningens krav.</p><p><a href="{{accountUrl}}">Öppna Mina sidor</a></p>',
  },
  {
    key: "certificate_issued",
    name: "Certifikat utfärdat",
    subject: "Ditt certifikat för {{courseName}} är utfärdat",
    body: '<p>Grattis! Ditt certifikat för <strong>{{courseName}}</strong> är utfärdat.</p><p>Certifikatnummer: <strong>{{certificateNumber}}</strong>.</p><p><a href="{{certificateUrl}}">Visa och verifiera certifikatet</a></p>',
  },
  {
    key: "competence_expiring",
    name: "Kompetens löper ut",
    subject: "{{courseName}} löper ut om {{days}} dagar",
    body: '<p>Din utbildning <strong>{{courseName}}</strong> löper ut den {{validUntil}}.</p><p><a href="{{renewUrl}}">Förnya utbildningen</a></p>',
  },
  {
    key: "company_competence_expiring",
    name: "Medarbetares kompetens löper ut",
    subject: "En medarbetares {{courseName}} löper ut om {{days}} dagar",
    body: '<p>En medarbetares utbildning <strong>{{courseName}}</strong> löper ut den {{validUntil}}.</p><p>Öppna företagsportalen för att se kompetensmatrisen.</p>',
  },
  {
    key: "company_report",
    name: "Företagsrapport",
    subject: "Kompetensrapport för {{companyName}}",
    body: '<p>Här kommer den senaste kompetensrapporten för <strong>{{companyName}}</strong>.</p><p>Öppna företagsportalen för att se eller exportera kompetensmatrisen.</p>',
  },
  {
    key: "course_released",
    name: "Kurs släppt",
    subject: "{{courseName}} är nu tillgänglig",
    body: '<p>Utbildningen <strong>{{courseName}}</strong> är nu tillgänglig.</p><p><a href="{{courseUrl}}">Läs mer och köp utbildningen</a></p>',
  },
];

export async function ensureDefaultEmailTemplates(db: Database) {
  for (const template of defaultEmailTemplates)
    await db
      .insert(emailTemplates)
      .values({
        id: `email_template_${template.key}`,
        ...template,
        active: true,
      })
      .onConflictDoNothing();
}

export async function queueTemplatedNotification(
  db: Database,
  input: {
    userId?: string | null;
    recipientEmail?: string | null;
    type: string;
    variables: Record<string, string | number | null | undefined>;
    fallbackSubject: string;
    fallbackBody: string;
    scheduledFor?: string | null;
  },
) {
  const recipientEmail = input.recipientEmail?.trim().toLowerCase() || null;
  if (!input.userId && !recipientEmail) throw new Error("notification_recipient_required");
  await ensureDefaultEmailTemplates(db);
  if (input.scheduledFor) {
    const existing = await db
      .select({ id: notifications.id })
      .from(notifications)
      .where(
        and(
          eq(notifications.type, input.type),
          eq(notifications.scheduledFor, input.scheduledFor),
          input.userId ? eq(notifications.userId, input.userId) : and(isNull(notifications.userId), eq(notifications.recipientEmail, recipientEmail!)),
        ),
      )
      .limit(1);
    if (existing[0]) return { queued: false, duplicate: true };
  }
  const template = (
    await db
      .select()
      .from(emailTemplates)
      .where(
        and(
          eq(emailTemplates.key, input.type),
          eq(emailTemplates.active, true),
        ),
      )
      .limit(1)
  )[0];
  await db
    .insert(notifications)
    .values({
      id: crypto.randomUUID(),
      userId: input.userId ?? null,
      recipientEmail,
      type: input.type,
      subject: template
        ? renderEmailTemplate(template.subject, input.variables)
        : input.fallbackSubject,
      body: template
        ? renderEmailTemplate(template.body, input.variables)
        : input.fallbackBody,
      status: "queued",
      scheduledFor: input.scheduledFor ?? null,
    });
  return { queued: true, duplicate: false };
}

export async function dispatchQueuedNotifications(
  db: Database,
  runtime: MailRuntime,
) {
  const queued = await db
    .select()
    .from(notifications)
    .where(eq(notifications.status, "queued"))
    .limit(100);
  const userIds = queued.flatMap((item) => (item.userId ? [item.userId] : []));
  const recipients = userIds.length
    ? await db.select().from(users).where(inArray(users.id, userIds))
    : [];
  const byId = new Map(
    recipients.map((recipient) => [recipient.id, recipient]),
  );
  const mail =
    runtime.MAIL_PROVIDER === "resend" && runtime.MAIL_API_KEY
      ? new ResendMailAdapter(
          runtime.MAIL_API_KEY,
          runtime.MAIL_FROM ??
            "Kompetensportalen <utbildning@kompetensportalen.se>",
        )
      : new PlaceholderMailAdapter();
  let sent = 0;
  let failed = 0;
  const sentIds: string[] = [];
  const failedIds: string[] = [];
  const pendingIds: string[] = [];
  for (const notification of queued) {
    const claim = await db
      .update(notifications)
      .set({ status: "sending" })
      .where(
        and(
          eq(notifications.id, notification.id),
          eq(notifications.status, "queued"),
        ),
      )
      ;
    if ((mutationChanges(claim) ?? 0) !== 1) continue;
    const recipient = notification.userId
      ? byId.get(notification.userId)
      : null;
    const recipientAddress = notification.recipientEmail ?? recipient?.email ?? null;
    if (!recipientAddress || mail instanceof PlaceholderMailAdapter) {
      await db.update(notifications).set({ status: "queued" }).where(eq(notifications.id, notification.id));
      pendingIds.push(notification.id);
      continue;
    }
    try {
      await mail.send({
        to: recipientAddress,
        subject: notification.subject,
        html: notification.body,
      });
      await db
        .update(notifications)
        .set({ status: "sent", sentAt: new Date().toISOString() })
        .where(
          and(
            eq(notifications.id, notification.id),
            eq(notifications.status, "sending"),
          ),
        );
      sent += 1;
      sentIds.push(notification.id);
    } catch {
      await db
        .update(notifications)
        .set({ status: "failed" })
        .where(
          and(
            eq(notifications.id, notification.id),
            eq(notifications.status, "sending"),
          ),
        );
      failed += 1;
      failedIds.push(notification.id);
    }
  }
  return {
    queued: queued.length,
    sent,
    failed,
    pending: queued.length - sent - failed,
    sentIds,
    failedIds,
    pendingIds,
    configurationRequired:
      runtime.MAIL_PROVIDER !== "resend" || !runtime.MAIL_API_KEY,
  };
}
