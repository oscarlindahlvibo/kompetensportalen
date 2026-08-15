import { desc, eq } from "drizzle-orm";
import { requireChatGPTUser } from "@/app/chatgpt-auth";
import { PageShell } from "@/app/components/site-chrome";
import { getDb } from "@/db";
import { companies, companyMembers, profiles, users } from "@/db/schema";
import { ensureDbUser, requirePermission } from "@/lib/server-auth";
import { hasPermission } from "@/lib/platform";
import ParticipantRoleManager from "@/app/admin/deltagare/participant-role-manager";

export const dynamic = "force-dynamic";

export default async function ParticipantsPage() {
  const identity = await requireChatGPTUser("/admin/deltagare");
  const db = getDb();
  const actor = await ensureDbUser(db, identity);
  requirePermission(actor.role, "participant:read");
  const canManageIdentity = hasPermission(actor.role, "id06:read");
  const canExportEnrollments = hasPermission(actor.role, "certification:read");
  const rows = await db
    .select({ user: users, membership: companyMembers, company: companies })
    .from(users)
    .leftJoin(companyMembers, eq(companyMembers.userId, users.id))
    .leftJoin(companies, eq(companies.id, companyMembers.companyId))
    .orderBy(desc(users.createdAt));
  const profileRows = await db.select().from(profiles);
  const identityLast4 = new Map(
    profileRows.map((profile) => [profile.userId, profile.identityLast4]),
  );
  return (
    <PageShell>
      <section className="subpage-hero admin-hero">
        <p className="eyebrow">Administration · Deltagare</p>
        <h1>
          Alla
          <br />
          deltagare.
        </h1>
        <p>
          Konton och företagskopplingar. Känsliga identitetsuppgifter visas inte
          i listan.
        </p>
      </section>
      <section className="section admin-table-section">
        <div className="section-heading">
          <div>
            <p className="eyebrow">Deltagare</p>
            <h2>{rows.length} konton</h2>
          </div>
          <p className="admin-message">
            Rolländringar kräver Super Admin och auditloggas.
          </p>
          {canExportEnrollments && <a
            className="button button-light"
            href="/api/admin/enrollments/export"
          >
            Exportera elevdokumentation <span>↓</span>
          </a>}
        </div>
        <ParticipantRoleManager
          canManageRoles={hasPermission(actor.role, "user:role_write")}
          canManageIdentity={canManageIdentity}
          canManagePrivacy={hasPermission(actor.role, "privacy:read")}
          initialRows={rows.map(({ user, membership, company }) => ({
            id: user.id,
            email: user.email,
            company: company?.name ?? "Privat deltagare",
            role: user.role,
            status: user.status,
            membershipRole: membership?.role ?? "-",
            privacyUserId: user.id,
            identityLast4: canManageIdentity ? identityLast4.get(user.id) ?? null : null,
          }))}
        />
      </section>
    </PageShell>
  );
}
