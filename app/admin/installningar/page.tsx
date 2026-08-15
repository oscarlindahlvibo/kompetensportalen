import { requireChatGPTUser } from "@/app/chatgpt-auth";
import { PageShell } from "@/app/components/site-chrome";
import { ensureDbUser, requirePermission } from "@/lib/server-auth";
import { getDb } from "@/db";
import { getReminderWindows } from "@/lib/settings";
import ReminderSettings from "@/app/admin/installningar/reminder-settings";
import { runtimeEnv } from "@/lib/runtime-env";

export const dynamic = "force-dynamic";

type RuntimeConfig = Record<string, string | undefined>;

export default async function SettingsPage() {
  const identity = await requireChatGPTUser("/admin/installningar");
  const actor = await ensureDbUser(getDb(), identity);
  requirePermission(actor.role, "course:read");
  const db = getDb();
  const reminderWindows = await getReminderWindows(db);
  const runtime = runtimeEnv() as RuntimeConfig;

  const integrations = [
    {
      label: "Stripe-betalningar",
      detail: "Checkout och signerad webhook",
      configured: Boolean(runtime.STRIPE_SECRET_KEY && runtime.STRIPE_WEBHOOK_SECRET),
    },
    {
      label: "E-post",
      detail: runtime.MAIL_PROVIDER === "resend" ? "Resend" : "Köar utskick tills leverantör är vald",
      configured: runtime.MAIL_PROVIDER === "resend" && Boolean(runtime.MAIL_API_KEY),
    },
    {
      label: "BankID",
      detail: runtime.BANKID_PROVIDER === "http" ? "HTTP-adapter" : "Manuell kontroll",
      configured: runtime.BANKID_PROVIDER === "http" && Boolean(runtime.BANKID_API_BASE_URL && runtime.BANKID_API_TOKEN),
    },
    {
      label: "ID06",
      detail: runtime.ID06_PROVIDER === "http" ? "API-adapter" : "Manuell registreringskö",
      configured: runtime.ID06_PROVIDER === "http" && Boolean(runtime.ID06_API_BASE_URL && runtime.ID06_CLIENT_ID && runtime.ID06_CLIENT_SECRET),
    },
    {
      label: "Personnummerkryptering",
      detail: "AES-GCM via PII_ENCRYPTION_KEY",
      configured: Boolean(runtime.PII_ENCRYPTION_KEY),
    },
  ];

  return (
    <PageShell>
      <section className="subpage-hero admin-hero">
        <p className="eyebrow">Administration · Inställningar</p>
        <h1>Drift med<br />överblick.</h1>
        <p>
          Statusen hämtas server-side. Hemligheter och personuppgifter visas
          aldrig i den här vyn.
        </p>
      </section>
      <section className="section admin-table-section">
        <div className="section-heading">
          <div>
            <p className="eyebrow">Integrationer</p>
            <h2>Aktuell konfiguration</h2>
          </div>
          <p className="admin-message">Ändra credentials via Sites environment variables.</p>
        </div>
        <div className="admin-table">
          {integrations.map((integration) => (
            <div className="admin-table-row" key={integration.label}>
              <div>
                <strong>{integration.label}</strong>
                <span>{integration.detail}</span>
              </div>
              <span className={"status-pill " + (integration.configured ? "status-registered" : "")}>
                {integration.configured ? "Konfigurerad" : "Ej konfigurerad"}
              </span>
            </div>
          ))}
        </div>
      </section>
      <ReminderSettings initialWindows={reminderWindows} />
      <section className="section admin-links">
        <a href="/admin/kommunikation"><span>01</span><h3>E-postmallar</h3><p>Redigera mallar och följ köade utskick.</p></a>
        <a href="/admin/kvalitet"><span>02</span><h3>Kvalitetskontroll</h3><p>Granska kursinnehåll och publiceringskrav.</p></a>
        <a href="/admin/audit"><span>03</span><h3>Revisionslogg</h3><p>Se spårbara administrativa händelser.</p></a>
      </section>
    </PageShell>
  );
}
