import { requireChatGPTUser } from "@/app/chatgpt-auth";
import { PageShell } from "@/app/components/site-chrome";
import { getDb } from "@/db";
import { courseVersions, courses, governingDocuments } from "@/db/schema";
import { ensureDbUser, requirePermission } from "@/lib/server-auth";
import CourseAdmin from "@/app/admin/kurser/course-admin";

export const dynamic = "force-dynamic";

export default async function CourseAdminPage() {
  const identity = await requireChatGPTUser("/admin/kurser");
  const db = getDb();
  const actor = await ensureDbUser(db, identity);
  requirePermission(actor.role, "course:read");
  const initialCourses = await db.select().from(courses);
  const [initialVersions, documents] = await Promise.all([db.select().from(courseVersions), db.select().from(governingDocuments)]);
  return <PageShell><section className="subpage-hero admin-hero"><p className="eyebrow">Kursadministration</p><h1>Bygg och<br />publicera.</h1><p>Varje publicerad version är fryst. Historiska enrollments fortsätter alltid att peka på sin ursprungliga version.</p></section><CourseAdmin initialCourses={initialCourses.map((course) => ({ id: course.id, name: course.name, slug: course.slug, status: course.status, priceSek: course.basePriceSek, shortDescription: course.shortDescription, fullDescription: course.fullDescription, category: course.category, campaignPriceSek: course.campaignPriceSek, vatRate: course.vatRate, validityMonths: course.validityMonths, estimatedMinutes: course.estimatedMinutes, targetAudience: course.targetAudience, prerequisites: course.prerequisites, regulatoryFramework: course.regulatoryFramework, competenceCode: course.competenceCode, requiresIdentityVerification: course.requiresIdentityVerification, id06Enabled: course.id06Enabled, imageUrl: course.imageUrl, bannerUrl: course.bannerUrl, seoTitle: course.seoTitle, seoDescription: course.seoDescription, tagsJson: course.tagsJson }))} initialVersions={initialVersions.map((version) => ({ id: version.id, courseId: version.courseId, version: version.version, status: version.status }))} governingDocuments={documents.map((document) => ({ id: document.id, title: document.title, documentNumber: document.documentNumber, version: document.version }))} /></PageShell>;
}
