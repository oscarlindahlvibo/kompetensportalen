import { requireChatGPTUser } from "@/app/chatgpt-auth";
import { PageShell } from "@/app/components/site-chrome";
import { getDb } from "@/db";
import { emailTemplates } from "@/db/schema";
import { ensureDbUser, requirePermission } from "@/lib/server-auth";
import EmailTemplateManager from "@/app/admin/kommunikation/email-template-manager";
import NotificationQueue from "@/app/admin/kommunikation/notification-queue";
import BroadcastForm from "@/app/admin/kommunikation/broadcast-form";
import { desc, eq } from "drizzle-orm";
import { companies, notifications, users } from "@/db/schema";
export const dynamic = "force-dynamic";
export default async function CommunicationPage() { const identity = await requireChatGPTUser("/admin/kommunikation"); const db = getDb(); const actor = await ensureDbUser(db, identity); requirePermission(actor.role, "communication:write"); const [rows, queued, companyRows] = await Promise.all([db.select().from(emailTemplates), db.select({ notification: notifications, user: users }).from(notifications).leftJoin(users, eq(users.id, notifications.userId)).orderBy(desc(notifications.sentAt), desc(notifications.scheduledFor)).limit(100), db.select({ id: companies.id, name: companies.name }).from(companies).orderBy(companies.name)]); return <PageShell><section className="subpage-hero admin-hero"><p className="eyebrow">Administration · Kommunikation</p><h1>E-post som<br />går att lita på.</h1><p>Redigera mallar för order, tilldelning, certifikat och påminnelser. Utskick kräver en konfigurerad mailadapter.</p></section><BroadcastForm companies={companyRows} /><EmailTemplateManager initialTemplates={rows.map((row) => ({ id: row.id, key: row.key, name: row.name, subject: row.subject, body: row.body, active: row.active }))} /><NotificationQueue initialRows={queued.map(({ notification, user }) => ({ id: notification.id, type: notification.type, subject: notification.subject, recipient: notification.recipientEmail ?? user?.email ?? "-", status: notification.status, scheduledFor: notification.scheduledFor, createdAt: notification.sentAt ?? notification.scheduledFor ?? "" }))} /></PageShell>; }
