import { requireChatGPTUser } from "@/app/chatgpt-auth";
import { PageShell } from "@/app/components/site-chrome";
import CompanySettings from "@/app/admin/foretag/company-settings";
import { getDb } from "@/db";
import { companies } from "@/db/schema";
import { ensureDbUser, requirePermission } from "@/lib/server-auth";

export const dynamic = "force-dynamic";

export default async function AdminCompaniesPage() {
  const identity = await requireChatGPTUser("/admin/foretag");
  const db = getDb();
  const actor = await ensureDbUser(db, identity);
  requirePermission(actor.role, "admin:company_write");
  const allCompanies = await db.select().from(companies).orderBy(companies.name);
  return <PageShell><section className="subpage-hero admin-hero"><p className="eyebrow">Administration · Företag</p><h1>Företag och<br />betalvillkor.</h1><p>Styr vilka företagskunder som får köpa mot faktura och när licenser ska aktiveras. Alla ändringar revisionsloggas.</p></section><CompanySettings initialCompanies={allCompanies} /></PageShell>;
}
