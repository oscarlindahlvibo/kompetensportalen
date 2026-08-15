import { desc, eq } from "drizzle-orm";
import { requireChatGPTUser } from "@/app/chatgpt-auth";
import { PageShell } from "@/app/components/site-chrome";
import { getDb } from "@/db";
import { courses, governingDocuments, qualityReviews } from "@/db/schema";
import { ensureDbUser, requirePermission } from "@/lib/server-auth";
import QualityManager from "@/app/admin/kvalitet/quality-manager";
import GoverningDocumentManager from "@/app/admin/kvalitet/governing-document-manager";

export const dynamic = "force-dynamic";

export default async function QualityPage() {
  const identity = await requireChatGPTUser("/admin/kvalitet");
  const db = getDb();
  const actor = await ensureDbUser(db, identity);
  requirePermission(actor.role, "course:read");
  const [reviews, documents, allCourses] = await Promise.all([
    db.select({ review: qualityReviews, course: courses }).from(qualityReviews).innerJoin(courses, eq(courses.id, qualityReviews.courseId)).orderBy(desc(qualityReviews.updatedAt)),
    db.select().from(governingDocuments).orderBy(desc(governingDocuments.updatedAt)),
    db.select({ id: courses.id, name: courses.name }).from(courses).orderBy(courses.name),
  ]);
  return <PageShell><section className="subpage-hero admin-hero"><p className="eyebrow">Administration · Kvalitet</p><h1>Granska och<br />förvalta.</h1><p>Styrande dokument och publiceringschecklistor ska vara kontrollerade innan en kursversion publiceras.</p></section><QualityManager initialReviews={reviews.map(({ review }) => review)} courses={allCourses} /><GoverningDocumentManager initialDocuments={documents} /><section className="section admin-table-section"><div className="section-heading"><div><p className="eyebrow">Nästa steg</p><h2>Koppla dokument till kursversionen</h2></div><a className="text-link" href="/admin/kurser">Till kursversioner <span>→</span></a></div><p>Dokument som registreras här kan användas som underlag för kommande kursversioner och publiceringsgodkännande.</p></section></PageShell>;
}
