import { asc, eq } from "drizzle-orm";
import { requireChatGPTUser } from "@/app/chatgpt-auth";
import { PageShell } from "@/app/components/site-chrome";
import { getDb } from "@/db";
import { users } from "@/db/schema";
import { ensureDbUser, requirePermission } from "@/lib/server-auth";

export const dynamic = "force-dynamic";

export default async function ImpersonationPage() {
  const identity = await requireChatGPTUser("/admin/impersonation");
  const db = getDb(); const actor = await ensureDbUser(db, identity); requirePermission(actor.role, "support:read");
  const rows = await db.select().from(users).where(eq(users.role, "participant")).orderBy(asc(users.email));
  return <PageShell><section className="subpage-hero admin-hero"><p className="eyebrow">Administration · Support</p><h1>Se vad<br />deltagaren ser.</h1><p>Read-only felsökning. Inga prov, identitetskontroller, progressändringar eller ID06-åtgärder kan utföras här.</p></section><section className="section admin-table-section"><div className="section-heading"><div><p className="eyebrow">Deltagare</p><h2>Välj konto att granska</h2></div></div><div className="admin-table">{rows.map((user) => <div className="admin-table-row" key={user.id}><div><strong>{user.email}</strong><span>{user.role} · {user.status}</span></div><a className="button button-light" href={`/admin/impersonation/${user.id}`}>Öppna read-only →</a></div>)}</div></section></PageShell>;
}
