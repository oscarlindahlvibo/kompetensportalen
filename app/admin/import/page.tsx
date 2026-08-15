import { requireChatGPTUser } from "@/app/chatgpt-auth";
import { PageShell } from "@/app/components/site-chrome";
import { OdooImportForm } from "@/app/admin/import/odoo-import-form";
import { getDb } from "@/db";
import { ensureDbUser, requirePermission } from "@/lib/server-auth";

export const dynamic = "force-dynamic";

export default async function ImportPage() {
  const identity = await requireChatGPTUser("/admin/import");
  const actor = await ensureDbUser(getDb(), identity);
  requirePermission(actor.role, "migration:write");
  return <PageShell><section className="subpage-hero admin-hero"><p className="eyebrow">Administration · Odoo Migration</p><h1>Flytta APV<br />med spårbarhet.</h1><p>Importera ett normaliserat JSON-exportformat. Importen skapar utkast och ändrar aldrig publicerade kursversioner.</p></section><OdooImportForm /></PageShell>;
}
