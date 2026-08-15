import { eq } from "drizzle-orm";
import { requireChatGPTUser } from "@/app/chatgpt-auth";
import { PageShell } from "@/app/components/site-chrome";
import { getDb } from "@/db";
import {
  certificates,
  courses,
  enrollments,
  id06Registrations,
  profiles,
  users,
} from "@/db/schema";
import { ensureDbUser, requirePermission } from "@/lib/server-auth";
import { decryptPersonalIdentity } from "@/lib/pii";
import Id06Queue from "@/app/admin/id06/id06-queue";

export const dynamic = "force-dynamic";

export default async function Id06AdminPage() {
  const identity = await requireChatGPTUser("/admin/id06");
  const db = getDb();
  const actor = await ensureDbUser(db, identity);
  requirePermission(actor.role, "id06:write");
  const rows = await db
    .select({
      registration: id06Registrations,
      certificate: certificates,
      enrollment: enrollments,
      course: courses,
      user: users,
      profile: profiles,
    })
    .from(id06Registrations)
    .innerJoin(
      certificates,
      eq(certificates.id, id06Registrations.certificateId),
    )
    .innerJoin(enrollments, eq(enrollments.id, id06Registrations.enrollmentId))
    .innerJoin(courses, eq(courses.id, enrollments.courseId))
    .innerJoin(users, eq(users.id, enrollments.userId))
    .leftJoin(profiles, eq(profiles.userId, enrollments.userId));
  const initialRows = await Promise.all(
    rows.map(async (row) => {
      let personalIdentity = row.profile?.identityLast4
        ? `••••••${row.profile.identityLast4}`
        : null;
      if (row.profile?.personalIdentityEncrypted) {
        try {
          personalIdentity = await decryptPersonalIdentity(
            row.profile.personalIdentityEncrypted,
          );
        } catch {
          personalIdentity = `••••••${row.profile.identityLast4 ?? "????"}`;
        }
      }
      return {
        id: row.registration.id,
        status: row.registration.status,
        participant: row.user.email,
        personalIdentity,
        course: row.course.name,
        competenceCode: row.registration.competenceCode,
        validUntil: row.certificate.validUntil,
        id06Reference: row.registration.id06Reference,
      };
    }),
  );
  return (
    <PageShell>
      <section className="subpage-hero admin-hero">
        <p className="eyebrow">Administration · ID06</p>
        <h1>
          Registrera
          <br />
          kompetens.
        </h1>
        <p>
          Välj nästa tillåtna status. Personnummer visas bara för behörig
          handläggare och alla ändringar sparas i revisionsloggen.
        </p>
      </section>
      <Id06Queue initialRows={initialRows} />
    </PageShell>
  );
}
