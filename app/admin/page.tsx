/* eslint-disable @next/next/no-html-link-for-pages */
import { requireChatGPTUser } from "@/app/chatgpt-auth";
import { PageShell } from "@/app/components/site-chrome";
import { getDb } from "@/db";
import { certificates, competencies, enrollments, examAttempts, id06Registrations, orders, users } from "@/db/schema";
import { ensureDbUser } from "@/lib/server-auth";
import { hasPermission } from "@/lib/platform";
import { and, count, eq, gte, inArray, lte, sum } from "drizzle-orm";
import type { PlatformRole } from "@/lib/platform";
import { ensureApvCatalog } from "@/lib/catalog";

export const dynamic = "force-dynamic";

export default async function AdminPage() {
  const user = await requireChatGPTUser("/admin");
  const dbUser = await ensureDbUser(getDb(), user);
  if (!hasPermission(dbUser.role, "course:read")) {
    if (hasPermission(dbUser.role, "support:read")) {
      return <PageShell><section className="subpage-hero admin-hero"><p className="eyebrow">Administration · Support</p><h1>Hjälp kunderna<br />vidare.</h1><p>Supportläget visar endast de kund- och ordervyer som din roll behöver. Kursinnehåll, ID06 och känsliga identitetsuppgifter kräver andra behörigheter.</p></section><section className="section admin-nav" aria-label="Supportmeny"><a href="/admin/order">Order och betalningar</a><a href="/admin/deltagare">Deltagare</a><a href="/admin/kontakt">Kontaktärenden</a><a href="/admin/impersonation">Supportläge</a></section></PageShell>;
    }
    return <PageShell><section className="subpage-hero admin-hero"><p className="eyebrow">Administration</p><h1>Behörighet<br />saknas.</h1><p>Kontot {user.email} är inloggat som {dbUser.role === "participant" ? "deltagare" : dbUser.role}. Adminåtkomst tilldelas endast via serverns behörighetskonfiguration eller av en Super Admin.</p><div className="account-empty"><div><h2>Kontakta administratören</h2><p>Be WPE Sweden AB lägga till rätt ChatGPT-e-post i <code>KP_ADMIN_EMAILS</code> eller tilldela en administrativ roll.</p><a className="button button-dark" href="/kontakt">Kontakta oss <span>→</span></a></div></div></section></PageShell>;
  }
  const db = getDb();
  await ensureApvCatalog(db);
  const today = new Date();
  const inNinetyDays = new Date(today.getTime() + 90 * 86400000).toISOString().slice(0, 10);
  const monthAgo = new Date(today.getTime() - 30 * 86400000).toISOString();
  const [participantCount, newParticipantCount, activeCount, completedCount, passedCount, failedCount, waitingId06, issuedCertificates, salesTotal, expiringCount] = await Promise.all([
    db.select({ value: count() }).from(users).where(eq(users.role, "participant")),
    db.select({ value: count() }).from(users).where(and(eq(users.role, "participant"), gte(users.createdAt, monthAgo))),
    db.select({ value: count() }).from(enrollments).where(inArray(enrollments.status, ["not_started", "in_progress"])),
    db.select({ value: count() }).from(enrollments).where(eq(enrollments.status, "completed")),
    db.select({ value: count() }).from(examAttempts).where(eq(examAttempts.passed, true)),
    db.select({ value: count() }).from(examAttempts).where(eq(examAttempts.passed, false)),
    db.select({ value: count() }).from(id06Registrations).where(eq(id06Registrations.status, "ready_for_id06")),
    db.select({ value: count() }).from(certificates).where(eq(certificates.status, "issued")),
    db.select({ value: sum(orders.totalSek) }).from(orders).where(eq(orders.status, "paid")),
    db.select({ value: count() }).from(competencies).where(and(eq(competencies.status, "valid"), gte(competencies.validUntil, today.toISOString().slice(0, 10)), lte(competencies.validUntil, inNinetyDays))),
  ]);
  const stat = (row: Array<{ value: number }>) => row[0]?.value ?? 0;
  const totalSales = Number(salesTotal[0]?.value ?? 0);
  return <PageShell><section className="subpage-hero admin-hero"><p className="eyebrow">Administration</p><h1>Kontroll på<br />kompetensen.</h1><p>Inloggad som {user.email}. Behörighet kontrolleras server-side innan administrativa data eller mutationer visas.</p></section><AdminNavigation role={dbUser.role} /><section className="section dashboard-stats"><div><strong>{totalSales.toLocaleString("sv-SE")} kr</strong><span>försäljning</span></div><div><strong>{stat(newParticipantCount)}</strong><span>nya deltagare 30 dagar</span></div><div><strong>{stat(participantCount)}</strong><span>totalt deltagare</span></div><div><strong>{stat(activeCount)}</strong><span>aktiva deltagare</span></div><div><strong>{stat(completedCount)}</strong><span>slutförda</span></div><div><strong>{stat(passedCount)}</strong><span>godkända prov</span></div><div><strong>{stat(failedCount)}</strong><span>underkända prov</span></div><div><strong>{stat(waitingId06)}</strong><span>ID06 väntar</span></div><div><strong>{stat(expiringCount)}</strong><span>går ut inom 90 dagar</span></div><div><strong>{stat(issuedCertificates)}</strong><span>utfärdade certifikat</span></div></section><section className="section admin-links"><a href="/admin/kurser"><span>01</span><h3>Kurser och versioner</h3><p>Bygg innehåll, publicera versioner och länka aktuella styrande dokument.</p></a><a href="/admin/enrollments"><span>02</span><h3>Elevdokumentation</h3><p>Följ varje enrollment med kursversion, progress, prov, certifikat och ID06-status.</p></a><a href="/admin/id06"><span>03</span><h3>ID06 och audit</h3><p>Hantera kö, statusövergångar och revisionslogg med spårbarhet.</p></a></section></PageShell>;
}

function AdminNavigation({ role }: { role: PlatformRole }) {
  const items = [
    ["Dashboard", "/admin", null], ["Kurser och versioner", "/admin/kurser", "course:read"], ["Frågebank", "/admin/fragor", "course:read"], ["Quiz", "/admin/quiz", "course:read"], ["Deltagare", "/admin/deltagare", "participant:read"], ["Enrollments", "/admin/enrollments", "participant:read"], ["Supportläge", "/admin/impersonation", "support:read"], ["Kontaktärenden", "/admin/kontakt", "support:read"], ["Order", "/admin/order", "order:read"], ["Företag", "/admin/foretag", "admin:company_write"], ["Rabatter", "/admin/rabatter", "course:read"], ["E-post", "/admin/kommunikation", "communication:write"], ["Certifikat", "/admin/certifikat", "certification:read"], ["Kvalitet", "/admin/kvalitet", "course:read"], ["Auditlogg", "/admin/audit", "course:read"], ["ID06", "/admin/id06", "id06:write"], ["Odoo-import", "/admin/import", "migration:write"], ["Inställningar", "/admin/installningar", "course:read"],
  ] as const;
  return <section className="section admin-nav" aria-label="Administrationsmeny">{items.filter(([, , permission]) => !permission || hasPermission(role, permission)).map(([label, href]) => <a href={href} key={href}>{label}</a>)}</section>;
}
