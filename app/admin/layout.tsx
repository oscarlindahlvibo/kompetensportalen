import { requireChatGPTUser } from "@/app/chatgpt-auth";
import { PageShell } from "@/app/components/site-chrome";
import { getDb } from "@/db";
import { ensureDbUser } from "@/lib/server-auth";
import { isAdministrativeRole } from "@/lib/platform";

export const dynamic = "force-dynamic";

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const identity = await requireChatGPTUser("/admin");
  const actor = await ensureDbUser(getDb(), identity);
  if (!isAdministrativeRole(actor.role))
    return (
      <PageShell>
        <section className="subpage-hero admin-hero">
          <p className="eyebrow">Administration</p>
          <h1>Behörighet<br />saknas.</h1>
          <p>
            Kontot {identity.email} är inloggat som deltagare och har inte
            administrativ åtkomst.
          </p>
          <div className="account-empty">
            <div>
              <h2>Kontakta administratören</h2>
              <p>
                Be WPE Sweden AB tilldela rätt administrativ roll innan du
                öppnar adminportalen.
              </p>
              <a className="button button-dark" href="/kontakt">Kontakta oss <span>→</span></a>
            </div>
          </div>
        </section>
      </PageShell>
    );
  return children;
}
