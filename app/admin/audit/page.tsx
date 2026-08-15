import { desc } from "drizzle-orm";
import { requireChatGPTUser } from "@/app/chatgpt-auth";
import { PageShell } from "@/app/components/site-chrome";
import { getDb } from "@/db";
import { auditLogs } from "@/db/schema";
import { ensureDbUser, requirePermission } from "@/lib/server-auth";
import { hasPermission } from "@/lib/platform";

export const dynamic = "force-dynamic";

export default async function AuditPage() {
  const identity = await requireChatGPTUser("/admin/audit");
  const db = getDb();
  const actor = await ensureDbUser(db, identity);
  requirePermission(actor.role, "course:read");
  const canViewDetails = hasPermission(actor.role, "privacy:read") || hasPermission(actor.role, "id06:read");
  const rows = canViewDetails
    ? await db.select().from(auditLogs).orderBy(desc(auditLogs.createdAt)).limit(200)
    : await db.select({ id: auditLogs.id, actorUserId: auditLogs.actorUserId, targetType: auditLogs.targetType, targetId: auditLogs.targetId, action: auditLogs.action, createdAt: auditLogs.createdAt }).from(auditLogs).orderBy(desc(auditLogs.createdAt)).limit(200);
  return <PageShell><section className="subpage-hero admin-hero"><p className="eyebrow">Administration · Revision</p><h1>Allt lämnar<br />spår.</h1><p>Revisionsloggen är skrivskyddad för administratörer och visar kritiska ändringar i utbildnings- och certifieringsflöden.</p></section><section className="section admin-table-section"><div className="section-heading"><div><p className="eyebrow">Auditlogg</p><h2>{rows.length} senaste händelser</h2></div><p>{canViewDetails ? "Detaljerad revisionsdata" : "Sammanfattad vy för din roll"}</p></div><div className="admin-table">{rows.length ? rows.map((row) => <div className="admin-table-row audit-row" key={row.id}><div><strong>{row.action}</strong><span>{row.targetType} · {row.targetId}</span></div><span>{row.actorUserId ?? "system"}</span><span>{row.createdAt}</span>{canViewDetails && "beforeJson" in row && "afterJson" in row && <details><summary>Detaljer</summary><pre>{String(row.beforeJson ?? "-")} → {String(row.afterJson ?? "-")}</pre></details>}</div>) : <p>Inga revisionshändelser ännu.</p>}</div></section></PageShell>;
}
