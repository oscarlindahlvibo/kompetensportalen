import { desc } from "drizzle-orm";
import { requireChatGPTUser } from "@/app/chatgpt-auth";
import { PageShell } from "@/app/components/site-chrome";
import { getDb } from "@/db";
import { contactMessages } from "@/db/schema";
import { ensureDbUser, requirePermission } from "@/lib/server-auth";
import ContactMessageManager from "@/app/admin/kontakt/contact-message-manager";

export const dynamic = "force-dynamic";

export default async function ContactMessagesPage() {
  const identity = await requireChatGPTUser("/admin/kontakt");
  const db = getDb();
  const actor = await ensureDbUser(db, identity);
  requirePermission(actor.role, "support:read");
  const messages = await db.select().from(contactMessages).orderBy(desc(contactMessages.createdAt)).limit(200);
  return <PageShell><section className="subpage-hero admin-hero"><p className="eyebrow">Administration · Kontakt</p><h1>Fånga upp<br />frågorna.</h1><p>Följ inkommande kontaktärenden och markera när de är under behandling eller avslutade.</p></section><ContactMessageManager initialMessages={messages} /></PageShell>;
}
