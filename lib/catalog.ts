import { and, desc, eq } from "drizzle-orm";
import { getDb } from "@/db";
import { answerOptions, chapters, courseVersions, courses, enrollments, examConfigs, lessons, products, priceRules, questions, quizQuestions, quizzes } from "@/db/schema";
import { ensureDefaultEmailTemplates } from "@/lib/notifications";

type Database = ReturnType<typeof getDb>;

export async function ensureApvCatalog(db: Database) {
  await ensureDefaultEmailTemplates(db);
  const existing = (
    await db
      .select()
      .from(courses)
      .where(eq(courses.slug, "arbete-pa-vag-apv-1-1-3"))
      .limit(1)
  )[0];
  if (existing) {
    const publishedVersion = (
      await db
        .select()
        .from(courseVersions)
        .where(eq(courseVersions.courseId, existing.id))
        .orderBy(desc(courseVersions.publishedAt))
        .limit(1)
    )[0];
    if (existing.status === "published" && isBootstrapVersion(publishedVersion?.contentSnapshotJson)) {
      await db
        .update(courses)
        .set({ status: "coming_soon", updatedAt: new Date().toISOString() })
        .where(eq(courses.id, existing.id));
      existing.status = "coming_soon";
    }
    if (publishedVersion && isBootstrapVersion(publishedVersion.contentSnapshotJson))
      await removeLegacyBootstrapContent(db, existing.id, publishedVersion.id);
    await ensureDefaultApvPriceRules(db, existing.id);
    return existing;
  }
  const courseId = "course_apv_1_1_3";
  const versionId = "course_apv_1_1_3_v1";
  const course = {
    id: courseId,
    slug: "arbete-pa-vag-apv-1-1-3",
    name: "Arbete på väg - APV 1.1-1.3",
    shortDescription: "Digital APV-utbildning för arbete på väg.",
    fullDescription:
      "Kurs med text, video, quiz, slutprov, certifikat och ID06-hantering.",
    category: "Infrastruktur",
    // Runtime bootstrap is only scaffolding. The imported APV version must pass
    // quality review before the course becomes purchasable.
    status: "coming_soon" as const,
    imageUrl: null,
    bannerUrl: null,
    tagsJson: JSON.stringify(["Populär", "Online", "ID06"]),
    basePriceSek: 2490,
    vatRate: 0.25,
    campaignPriceSek: null,
    validityMonths: 60,
    estimatedMinutes: 420,
    targetAudience: "Bygg, entreprenad och infrastruktur",
    prerequisites: null,
    regulatoryFramework: "Aktuella styrande APV-dokument",
    competenceCode: "APV-1.1-1.3",
    requiresIdentityVerification: true,
    id06Enabled: true,
    seoTitle: "Arbete på väg APV 1.1-1.3",
    seoDescription:
      "Digital APV-utbildning med examination och ID06-hantering.",
  };
  await db.insert(courses).values(course).onConflictDoNothing();
  await db
    .insert(products)
    .values({
      id: "product_apv_1_1_3",
      courseId,
      sku: "APV-1.1-1.3",
      name: course.name,
      priceSek: course.basePriceSek,
      active: false,
    })
    .onConflictDoNothing();
  await db
    .insert(courseVersions)
    .values({
      id: versionId,
      courseId,
      version: "1.0",
      status: "draft",
      changelog: "Initial APV-katalogversion",
      contentSnapshotJson: JSON.stringify({
        source: "catalog-bootstrap",
        content: "awaiting_odoo_import",
      }),
      publishedAt: null,
    })
    .onConflictDoNothing();
  await ensureDefaultApvPriceRules(db, courseId);
  return (
    (
      await db.select().from(courses).where(eq(courses.id, courseId)).limit(1)
    )[0] ?? course
  );
}

async function removeLegacyBootstrapContent(db: Database, courseId: string, versionId: string) {
  const enrollment = await db.select({ id: enrollments.id }).from(enrollments).where(eq(enrollments.courseVersionId, versionId)).limit(1);
  if (enrollment.length) return;
  await db.update(courseVersions).set({ status: "draft", publishedAt: null, contentSnapshotJson: JSON.stringify({ source: "catalog-bootstrap", content: "awaiting_odoo_import" }), updatedAt: new Date().toISOString() }).where(eq(courseVersions.id, versionId));
  await db.update(products).set({ active: false }).where(eq(products.courseId, courseId));
  const legacyChapterIds = [
    "course_apv_1_1_3_ch1",
    "course_apv_1_1_3_ch2",
    "course_apv_1_1_3_ch3",
  ];
  const legacyLessonIds = [
    "course_apv_1_1_3_l1",
    "course_apv_1_1_3_l2",
    "course_apv_1_1_3_l3",
    "course_apv_1_1_3_l4",
    "course_apv_1_1_3_l5",
    "course_apv_1_1_3_l6",
  ];
  const legacyQuestionIds = ["apv_question_risk", "apv_question_zone"];
  const legacyQuizIds = (await db.select({ id: quizzes.id }).from(quizzes).where(eq(quizzes.lessonId, legacyLessonIds[2]))).map(({ id }) => id);
  if (legacyQuizIds.length) {
    await db.delete(quizQuestions).where(eq(quizQuestions.quizId, legacyQuizIds[0]));
    await db.delete(quizzes).where(eq(quizzes.id, legacyQuizIds[0]));
  }
  await db.delete(examConfigs).where(eq(examConfigs.courseVersionId, versionId));
  await db.delete(lessons).where(eq(lessons.chapterId, legacyChapterIds[0]));
  await db.delete(lessons).where(eq(lessons.chapterId, legacyChapterIds[1]));
  await db.delete(lessons).where(eq(lessons.chapterId, legacyChapterIds[2]));
  for (const chapterId of legacyChapterIds)
    await db.delete(chapters).where(eq(chapters.id, chapterId));
  for (const questionId of legacyQuestionIds) {
    await db.delete(answerOptions).where(eq(answerOptions.questionId, questionId));
    await db.delete(questions).where(and(eq(questions.id, questionId), eq(questions.courseId, courseId)));
  }
}

function isBootstrapVersion(snapshot: string | null | undefined) {
  if (!snapshot) return false;
  try {
    return (JSON.parse(snapshot) as { source?: unknown }).source === "catalog-bootstrap";
  } catch {
    return false;
  }
}

async function ensureDefaultApvPriceRules(db: Database, courseId: string) {
  const existing = await db
    .select()
    .from(priceRules)
    .where(eq(priceRules.courseId, courseId));
  if (existing.length) return;
  for (const rule of [
    {
      minQuantity: 3,
      maxQuantity: 9,
      discountPercent: 20,
      label: "3-9 platser",
    },
    {
      minQuantity: 10,
      maxQuantity: 19,
      discountPercent: 30,
      label: "10-19 platser",
    },
    {
      minQuantity: 20,
      maxQuantity: null,
      discountPercent: 35,
      label: "20+ företagspris",
    },
  ])
    await db
      .insert(priceRules)
      .values({
        id: `price_rule_${courseId}_${rule.minQuantity}`,
        courseId,
        ...rule,
        fixedUnitPriceSek: null,
        active: true,
      });
}
