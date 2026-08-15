import { and, eq, inArray } from "drizzle-orm";
import { getDb } from "@/db";
import {
  answerOptions,
  auditLogs,
  chapters,
  courseVersionGoverningDocuments,
  courseVersions,
  courses,
  examConfigs,
  governingDocuments,
  lessons,
  odooImports,
  products,
  questions,
  quizQuestions,
  quizzes,
  enrollments,
} from "@/db/schema";
import {
  ensureDbUser,
  requireMutationIdentity,
  requirePermission,
} from "@/lib/server-auth";
import {
  importPayloadMatchesSnapshot,
  validateOdooImport,
  type NormalizedImport,
  type ImportLesson,
} from "@/lib/odoo-import";
import { encodeCourseAssetKey } from "@/lib/course-assets";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const identity = await requireMutationIdentity(request);
  if (identity instanceof Response) return identity;
  type ValidatedImport = NormalizedImport & {
    course: NonNullable<NormalizedImport["course"]>;
    version: NonNullable<NormalizedImport["version"]>;
  };
  let payload: ValidatedImport;
  try {
    payload = (await request.json()) as ValidatedImport;
  } catch {
    return Response.json({ error: "invalid_json" }, { status: 400 });
  }
  const db = getDb();
  const actor = await ensureDbUser(db, identity);
  requirePermission(
    actor.role as Parameters<typeof requirePermission>[0],
    "migration:write",
  );
  const raw = JSON.stringify(payload);
  const idempotencyKey = await digestHex("SHA-256", raw);
  const existing = await db
    .select()
    .from(odooImports)
    .where(eq(odooImports.idempotencyKey, idempotencyKey))
    .limit(1);
  if (existing[0])
    return Response.json({
      idempotent: true,
      report: JSON.parse(existing[0].reportJson),
    });
  const validation = validateOdooImport(payload);
  const report = {
    idempotencyKey,
    importedChapters: 0,
    importedLessons: 0,
    importedQuestions: 0,
    importedAnswers: 0,
    importedQuizzes: 0,
    importedQuizQuestions: 0,
    importedGoverningDocuments: 0,
    importedExamConfig: false,
    skippedExistingVersion: false,
    repairedPartialVersion: false,
    missingImages: validation.missingImages,
    missingVideos: validation.missingVideos,
    warnings: validation.warnings,
    errors: validation.errors,
  };
  if (!report.errors.length) {
    const slug = (
      payload.course.slug ??
      payload.course.name ??
      "importerad-kurs"
    )
      .toLowerCase()
      .replace(/[^a-z0-9åäö]+/g, "-")
      .replace(/^-|-$/g, "");
    const slugMatch = await db
      .select()
      .from(courses)
      .where(eq(courses.slug, slug))
      .limit(1);
    const nameMatch = !slugMatch[0] && payload.course.name
      ? await db.select().from(courses).where(eq(courses.name, payload.course.name.trim())).limit(1)
      : [];
    const existingCourse = slugMatch[0] ?? nameMatch[0];
    if (existingCourse && existingCourse.slug !== slug)
      report.warnings.push(`Kursens slug ${slug} matchade befintlig kurs via namn (${existingCourse.slug}).`);
    const courseId = existingCourse?.id ?? crypto.randomUUID();
    if (!existingCourse)
      await db
        .insert(courses)
        .values({
          id: courseId,
          slug,
          name: payload.course.name!,
          shortDescription:
            payload.course.shortDescription ?? payload.course.name!,
          fullDescription:
            payload.course.fullDescription ?? payload.course.name!,
          category: payload.course.category ?? "Importerad",
          status: "draft",
          imageUrl: payload.course.imageUrl ?? null,
          bannerUrl: payload.course.bannerUrl ?? null,
          tagsJson: JSON.stringify(payload.course.tags ?? []),
          basePriceSek: payload.course.basePriceSek ?? 0,
          vatRate: payload.course.vatRate ?? 0.25,
          validityMonths: payload.course.validityMonths ?? null,
          estimatedMinutes: payload.course.estimatedMinutes ?? 0,
          targetAudience: payload.course.targetAudience ?? null,
          prerequisites: payload.course.prerequisites ?? null,
          regulatoryFramework: payload.course.regulatoryFramework ?? null,
          competenceCode: payload.course.competenceCode ?? null,
          requiresIdentityVerification:
            payload.course.requiresIdentityVerification ?? false,
          id06Enabled: payload.course.id06Enabled ?? false,
          seoTitle: payload.course.seoTitle ?? null,
          seoDescription: payload.course.seoDescription ?? null,
        });
    const existingProduct = (
      await db
        .select()
        .from(products)
        .where(eq(products.courseId, courseId))
        .limit(1)
    )[0];
    if (!existingProduct)
      await db
        .insert(products)
        .values({
          id: `product_import_${courseId}`,
          courseId,
          sku: `IMPORT-${slug}`.slice(0, 80),
          name: payload.course.name!,
          priceSek: payload.course.basePriceSek ?? 0,
          active: false,
        });
    const existingVersion = (
      await db
        .select()
        .from(courseVersions)
        .where(eq(courseVersions.courseId, courseId))
    ).find((version) => version.version === payload.version!.version);
    const versionId = existingVersion?.id ?? crypto.randomUUID();
    const bootstrapCandidate = Boolean(
      existingVersion && (
        isBootstrapVersion(existingVersion.contentSnapshotJson) ||
        importPayloadMatchesSnapshot(existingVersion.contentSnapshotJson, payload)
      ),
    );
    const existingEnrollments = bootstrapCandidate
      ? await db.select({ id: enrollments.id }).from(enrollments).where(eq(enrollments.courseVersionId, versionId)).limit(1)
      : [];
    const canReplaceBootstrap = bootstrapCandidate && existingEnrollments.length === 0 && existingVersion?.status !== "published";
    if (canReplaceBootstrap && existingVersion && !isBootstrapVersion(existingVersion.contentSnapshotJson))
      report.repairedPartialVersion = true;
    const isNewVersion = !existingVersion || canReplaceBootstrap;
    if (canReplaceBootstrap && existingCourse) {
      await db.update(courses).set({
        name: payload.course.name ?? existingCourse.name,
        shortDescription: payload.course.shortDescription ?? existingCourse.shortDescription,
        fullDescription: payload.course.fullDescription ?? existingCourse.fullDescription,
        category: payload.course.category ?? existingCourse.category,
        status: "coming_soon",
        imageUrl: payload.course.imageUrl ?? existingCourse.imageUrl,
        bannerUrl: payload.course.bannerUrl ?? existingCourse.bannerUrl,
        tagsJson: JSON.stringify(payload.course.tags ?? JSON.parse(existingCourse.tagsJson)),
        basePriceSek: payload.course.basePriceSek ?? existingCourse.basePriceSek,
        vatRate: payload.course.vatRate ?? existingCourse.vatRate,
        validityMonths: payload.course.validityMonths === undefined ? existingCourse.validityMonths : payload.course.validityMonths,
        estimatedMinutes: payload.course.estimatedMinutes ?? existingCourse.estimatedMinutes,
        targetAudience: payload.course.targetAudience ?? existingCourse.targetAudience,
        prerequisites: payload.course.prerequisites ?? existingCourse.prerequisites,
        regulatoryFramework: payload.course.regulatoryFramework ?? existingCourse.regulatoryFramework,
        competenceCode: payload.course.competenceCode ?? existingCourse.competenceCode,
        requiresIdentityVerification: payload.course.requiresIdentityVerification ?? existingCourse.requiresIdentityVerification,
        id06Enabled: payload.course.id06Enabled ?? existingCourse.id06Enabled,
        seoTitle: payload.course.seoTitle ?? existingCourse.seoTitle,
        seoDescription: payload.course.seoDescription ?? existingCourse.seoDescription,
        updatedAt: new Date().toISOString(),
      }).where(eq(courses.id, courseId));
      await db.update(products).set({
        name: payload.course.name ?? existingCourse.name,
        priceSek: payload.course.basePriceSek ?? existingCourse.basePriceSek,
        active: false,
      }).where(eq(products.courseId, courseId));
    }
    if (bootstrapCandidate && existingEnrollments.length) {
      report.errors.push(
        `Bootstrapversionen ${payload.version!.version} har redan elevhistorik och kan inte ersättas.`,
      );
    }
    if (bootstrapCandidate && existingVersion?.status === "published")
      report.warnings.push(
        `Version ${payload.version!.version} är publicerad och lämnades orörd för att skydda versionshistoriken.`,
      );
    if (isNewVersion && !canReplaceBootstrap)
      await db
        .insert(courseVersions)
        .values({
          id: versionId,
          courseId,
          version: payload.version!.version!,
          status: "draft",
          changelog: payload.version?.changelog ?? "Importerad från Odoo",
          contentSnapshotJson: JSON.stringify(payload),
        });
    else if (!canReplaceBootstrap) {
      report.skippedExistingVersion = true;
      report.warnings.push(
        `Version ${payload.version!.version} fanns redan och ändrades inte.`,
      );
    }
    if (canReplaceBootstrap) {
      const oldChapterIds = (await db.select({ id: chapters.id }).from(chapters).where(eq(chapters.courseVersionId, versionId))).map((row) => row.id);
      const oldLessonIds = oldChapterIds.length
        ? (await Promise.all(oldChapterIds.map((chapterId) => db.select({ id: lessons.id }).from(lessons).where(eq(lessons.chapterId, chapterId))))).flat().map((row) => row.id)
        : [];
      const oldQuizIds = oldLessonIds.length
        ? (await Promise.all(oldLessonIds.map((lessonId) => db.select({ id: quizzes.id }).from(quizzes).where(eq(quizzes.lessonId, lessonId))))).flat().map((row) => row.id)
        : [];
      if (oldQuizIds.length) await db.delete(quizQuestions).where(inArray(quizQuestions.quizId, oldQuizIds));
      if (oldLessonIds.length) await db.delete(quizzes).where(inArray(quizzes.lessonId, oldLessonIds));
      const oldQuestionIds = (await db.select({ id: questions.id }).from(questions).where(eq(questions.courseId, courseId))).map((row) => row.id);
      if (oldQuestionIds.length) await db.delete(answerOptions).where(inArray(answerOptions.questionId, oldQuestionIds));
      if (oldQuestionIds.length) await db.delete(questions).where(eq(questions.courseId, courseId));
      if (oldLessonIds.length) await db.delete(lessons).where(inArray(lessons.id, oldLessonIds));
      if (oldChapterIds.length) await db.delete(chapters).where(inArray(chapters.id, oldChapterIds));
      await db.delete(examConfigs).where(eq(examConfigs.courseVersionId, versionId));
      await db.update(courseVersions).set({ status: "draft", changelog: payload.version?.changelog ?? "Importerad från Odoo", contentSnapshotJson: JSON.stringify(payload), publishedAt: null, updatedAt: new Date().toISOString() }).where(eq(courseVersions.id, versionId));
    }
    const quizLessons: { lessonId: string; quiz: NonNullable<ImportLesson["quiz"]> }[] = [];
    const importedChapterIds: string[] = [];
    if (isNewVersion)
      for (const [chapterIndex, chapter] of (
        payload.chapters ?? []
      ).entries()) {
        report.importedChapters += 1;
        report.importedLessons += chapter.lessons?.length ?? 0;
        const chapterId = crypto.randomUUID();
        importedChapterIds.push(chapterId);
        await db
          .insert(chapters)
          .values({
            id: chapterId,
            courseVersionId: versionId,
            title: chapter.title ?? `Kapitel ${chapterIndex + 1}`,
            description: chapter.description,
            sortOrder: chapterIndex,
          });
        for (const [lessonIndex, lesson] of (chapter.lessons ?? []).entries()) {
          const lessonId = crypto.randomUUID();
          await db
            .insert(lessons)
            .values({
              id: lessonId,
              chapterId,
              title: lesson.title ?? `Lektion ${lessonIndex + 1}`,
              type: lesson.type ?? "article",
              bodyJson: JSON.stringify(importLessonBody(lesson)),
              required: lesson.required ?? true,
              sortOrder: lessonIndex,
            });
          if (lesson.quiz) quizLessons.push({ lessonId, quiz: lesson.quiz });
        }
      }
    const importedQuestionIds: string[] = [];
    if (isNewVersion)
      for (const [questionIndex, question] of (
        payload.questions ?? []
      ).entries()) {
        report.importedQuestions += 1;
        report.importedAnswers += question.answers?.length ?? 0;
        const questionId = crypto.randomUUID();
        importedQuestionIds.push(questionId);
        await db
          .insert(questions)
          .values({
            id: questionId,
            courseId,
            chapterId: Number.isInteger(question.chapterIndex) ? importedChapterIds[question.chapterIndex!] ?? null : null,
            topic: question.topic ?? "Importerad",
            difficulty: question.difficulty ?? "medium",
            type: question.type ?? "single",
            prompt: question.prompt ?? `Fråga ${questionIndex + 1}`,
            explanation: question.explanation,
            points: question.points ?? 1,
            imageUrl: question.imageUrl ?? null,
          });
        for (const [answerIndex, answer] of (question.answers ?? []).entries())
          await db
            .insert(answerOptions)
            .values({
              id: crypto.randomUUID(),
              questionId,
              label: answer.label ?? `Svar ${answerIndex + 1}`,
              isCorrect: answer.isCorrect ?? false,
              sortOrder: answerIndex,
          });
      }
    if (isNewVersion)
      for (const item of quizLessons) {
        const quizId = crypto.randomUUID();
        report.importedQuizzes += 1;
        await db.insert(quizzes).values({
          id: quizId,
          lessonId: item.lessonId,
          title: item.quiz.title?.trim() || "Kapitelquiz",
          feedbackMode: item.quiz.feedbackMode ?? "immediate",
          passPercent: item.quiz.passPercent ?? null,
        });
        for (const [sortOrder, questionIndex] of (item.quiz.questionIndexes ?? []).entries()) {
          const questionId = importedQuestionIds[questionIndex];
          if (!questionId) {
            report.warnings.push(`Quiz för lektion ${item.lessonId} refererar till saknad fråga ${questionIndex}.`);
            continue;
          }
          await db.insert(quizQuestions).values({
            id: crypto.randomUUID(),
            quizId,
            questionId,
            sortOrder,
          });
          report.importedQuizQuestions += 1;
        }
      }
    if (payload.version?.exam && isNewVersion) {
      const exam = payload.version.exam;
      await db
        .insert(examConfigs)
        .values({
          id: `exam_config_${versionId}`,
          courseVersionId: versionId,
          questionCount: exam.questionCount ?? 30,
          passPercent: exam.passPercent ?? 80,
          timeLimitSeconds: exam.timeLimitSeconds ?? 3600,
          maxAttempts: exam.maxAttempts ?? 3,
          cooldownSeconds: exam.cooldownSeconds ?? 0,
          randomizeQuestions: exam.randomizeQuestions ?? true,
          randomizeAnswers: exam.randomizeAnswers ?? true,
          questionSelectionJson: JSON.stringify((exam.topicRules ?? []).map((rule) => ({ topic: rule.topic?.trim(), count: rule.count }))),
        })
        .onConflictDoNothing();
      report.importedExamConfig = true;
    }
    if (isNewVersion) for (const [documentIndex, document] of (
      payload.governingDocuments ?? []
    ).entries()) {
      if (!document.title) {
        report.warnings.push(
          `Styrande dokument ${documentIndex + 1} saknar titel.`,
        );
        continue;
      }
      const documentId = `gov_import_${(await digestHex("SHA-1", JSON.stringify(document))).slice(0, 20)}`;
      await db
        .insert(governingDocuments)
        .values({
          id: documentId,
          title: document.title,
          documentNumber: document.documentNumber ?? null,
          version: document.version ?? null,
          publishedAt: document.publishedAt ?? null,
          url: document.url ?? null,
          lastCheckedAt: document.lastCheckedAt ?? null,
          responsibleUserId: actor.id,
          notes: document.notes ?? null,
        })
        .onConflictDoNothing();
      const linked = await db
        .select({ id: courseVersionGoverningDocuments.id })
        .from(courseVersionGoverningDocuments)
        .where(
          and(
            eq(courseVersionGoverningDocuments.courseVersionId, versionId),
            eq(courseVersionGoverningDocuments.governingDocumentId, documentId),
          ),
        )
        .limit(1);
      if (!linked[0]) {
        await db
          .insert(courseVersionGoverningDocuments)
          .values({
            id: crypto.randomUUID(),
            courseVersionId: versionId,
            governingDocumentId: documentId,
          })
          .onConflictDoNothing();
      }
      report.importedGoverningDocuments += 1;
    }
    if (!isNewVersion && (payload.governingDocuments?.length ?? 0) > 0)
      report.warnings.push("Styrande dokument för en befintlig version importerades inte för att skydda historiken.");
    report.warnings.push(
      `Importerad som utkast: ${slug}, version ${payload.version.version}. Publicera först efter kvalitetsgranskning.`,
    );
  }
  await db
    .insert(odooImports)
    .values({
      id: crypto.randomUUID(),
      source: "odoo-normalized-json",
      idempotencyKey,
      status: report.errors.length
        ? "failed"
        : report.warnings.length
          ? "completed_with_warnings"
          : "completed",
      reportJson: JSON.stringify(report),
      importedAt: new Date().toISOString(),
    });
  await db.insert(auditLogs).values({ id: crypto.randomUUID(), actorUserId: actor.id, targetType: "odoo_import", targetId: idempotencyKey, action: "odoo_import.completed", beforeJson: null, afterJson: JSON.stringify({ status: report.errors.length ? "failed" : "completed", report }), ipHash: null, userAgent: null });
  return Response.json(
    { idempotent: false, report },
    { status: report.errors.length ? 422 : 201 },
  );
}

function importLessonBody(lesson: ImportLesson) {
  const raw = lesson.body;
  const body: Record<string, unknown> = raw && typeof raw === "object" && !Array.isArray(raw)
    ? { ...(raw as Record<string, unknown>) }
    : raw !== undefined
      ? { text: String(raw) }
      : {};
  if (lesson.assetRef) {
    const assetUrl = lesson.assetRef.startsWith("r2://")
      ? `/api/course-assets/${encodeCourseAssetKey(lesson.assetRef.slice(5))}`
      : lesson.assetRef;
    if (lesson.type === "image") body.imageUrl = assetUrl;
    else if (lesson.type === "video") body.videoUrl = assetUrl;
    else if (lesson.type === "document") body.documentUrl = assetUrl;
    else body.assetRef = lesson.assetRef;
  }
  return body;
}

async function digestHex(algorithm: "SHA-1" | "SHA-256", value: string) {
  const digest = await crypto.subtle.digest(algorithm, new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function isBootstrapVersion(snapshot: string | null | undefined) {
  if (!snapshot) return false;
  try {
    return (JSON.parse(snapshot) as { source?: unknown }).source === "catalog-bootstrap";
  } catch {
    return false;
  }
}
