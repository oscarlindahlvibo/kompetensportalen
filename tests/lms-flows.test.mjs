import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  apvVersion,
  applyVolumeDiscount,
  assignLicense,
  createEnrollment,
  createLicensePool,
  demoCourses,
  expiringCompetenceReminders,
  gradeExam,
  issueCertificate,
} from "../lib/kompetensportalen.ts";
import {
  assertId06Transition,
  allocateCartDiscounts,
  canChangeSuperAdminRole,
  canManuallyCompleteLesson,
  courseNeedsIdentityVerification,
  calculateCartTotals,
  calculateProgressPercent,
  calculateOrderTotals,
  effectiveCoursePrice,
  enrollmentDisplayState,
  enrollmentIsAccessible,
  hasCompletedRequiredLessons,
  identityDataIsReadyForId06,
  publicCertificateView,
  publicExamSnapshot,
  questionBelongsToCourseVersion,
  nextLessonProgressStatus,
} from "../lib/platform.ts";
import {
  addMonthsIso,
  shouldActivateInvoiceLicenses,
  stableOrderRowId,
} from "../lib/order-fulfillment.ts";
import { rateLimit } from "../lib/rate-limit.ts";
import { bankIdResultIsVerified, configuredBankIdAdapter } from "../lib/integrations.ts";
import {
  isConfirmedStripePayment,
  isFullStripeRefund,
  stripeEventAmountSek,
} from "../lib/stripe.ts";
import { importPayloadMatchesSnapshot, validateOdooImport } from "../lib/odoo-import.ts";
import { renderEmailTemplate } from "../lib/email-templates.ts";
import { defaultEmailTemplates } from "../lib/notifications.ts";
import { allowedCourseAssetTypes, courseAssetSizeLimit, encodeCourseAssetKey, isSafeCourseAssetKey } from "../lib/course-assets.ts";
import { normalizeOdooCsvBundle } from "../lib/odoo-csv.ts";
import { sameOriginGuard } from "../lib/request-security.ts";
import { normalizePersonalIdentity } from "../lib/personal-identity.ts";

test("personal identity normalization validates Swedish date and Luhn checksum", () => {
  assert.equal(normalizePersonalIdentity("19900101-0017"), "199001010017");
  assert.equal(normalizePersonalIdentity("850709-9805"), "8507099805");
  assert.throws(() => normalizePersonalIdentity("199001010018"), /personal_identity_invalid/);
  assert.throws(() => normalizePersonalIdentity("199013010017"), /personal_identity_invalid/);
});

test("recertification creates a new enrollment at 0 percent while old history remains", () => {
  const course = demoCourses[0];
  const old = createEnrollment({
    userId: "user_1",
    course,
    version: apvVersion,
    purchasedAt: "2026-08-13",
  });
  const completedOld = {
    ...old,
    status: "completed",
    progressPercent: 100,
    validUntil: "2031-08-15",
  };
  const renewal = createEnrollment({
    userId: "user_1",
    course,
    version: apvVersion,
    purchasedAt: "2031-07-10",
    previousEnrollmentIds: [completedOld.id],
  });

  assert.equal(completedOld.progressPercent, 100);
  assert.equal(renewal.progressPercent, 0);
  assert.notEqual(renewal.id, completedOld.id);
});

test("certificate and ID06 queue require passed exam and identity verification", () => {
  const course = demoCourses[0];
  const enrollment = createEnrollment({
    userId: "user_2",
    course,
    version: apvVersion,
    purchasedAt: "2026-08-13",
  });
  const exam = gradeExam({
    enrollment,
    version: apvVersion,
    attemptNumber: 1,
    now: "2026-08-13",
    selectedAnswers: {
      q_risk_1: ["a"],
      q_risk_2: ["b"],
      q_work_1: ["a"],
      q_sign_1: ["c"],
      q_tma_1: ["b"],
    },
  });
  const result = issueCertificate({
    enrollment,
    course,
    version: apvVersion,
    examAttempt: exam,
    identityVerified: true,
    issuedAt: "2026-08-15",
  });

  assert.equal(exam.passed, true);
  assert.equal(result.enrollment.progressPercent, 100);
  assert.equal(result.id06.status, "ready_for_id06");
  assert.equal(result.certificate.validUntil, "2031-08-15");
});

test("ID06 courses always require identity verification", () => {
  assert.equal(courseNeedsIdentityVerification({ requiresIdentityVerification: false, id06Enabled: true }), true);
  assert.equal(courseNeedsIdentityVerification({ requiresIdentityVerification: true, id06Enabled: false }), true);
  assert.equal(courseNeedsIdentityVerification({ requiresIdentityVerification: false, id06Enabled: false }), false);
});

test("company purchase can allocate 20 course seats", () => {
  const pool = createLicensePool("company_1", "course_apv_113", 20);
  const assigned = Array.from({ length: 13 }).reduce(
    (current) => assignLicense(current),
    pool,
  );

  assert.equal(assigned.purchased, 20);
  assert.equal(assigned.assigned, 13);
  assert.equal(assigned.available, 7);
  assert.equal(applyVolumeDiscount(20, 2490).discountPercent, 35);
});

test("expiry reminders trigger on configured windows", () => {
  assert.deepEqual(
    expiringCompetenceReminders("2031-08-15", "2031-06-16"),
    [60],
  );
});

test("expiry reminders use an exact due date rather than a rolling window", () => {
  const today = new Date("2031-06-16T00:00:00Z");
  const due = new Date(today.getTime() + 60 * 86400000).toISOString().slice(0, 10);
  assert.equal(due, "2031-08-15");
  assert.notEqual(new Date(today.getTime() + 59 * 86400000).toISOString().slice(0, 10), due);
});

test("paid order totals are calculated server-side", () => {
  assert.deepEqual(
    calculateOrderTotals({ unitPriceSek: 2490, quantity: 2, discountSek: 500 }),
    {
      subtotalSek: 4980,
      discountSek: 500,
      vatSek: 1120,
      totalSek: 5600,
    },
  );
});

test("campaign price is preferred without trusting client input", () => {
  assert.equal(
    effectiveCoursePrice({ basePriceSek: 2490, campaignPriceSek: 1990 }, 2490),
    1990,
  );
  assert.equal(
    effectiveCoursePrice({ basePriceSek: 2490, campaignPriceSek: null }, 2490),
    2490,
  );
});

test("multi-course cart allocates code discount before VAT without negative lines", () => {
  assert.deepEqual(
    calculateCartTotals(
      [
        { unitPriceSek: 1000, quantity: 1, automaticDiscountSek: 100, vatRate: 0.25 },
        { unitPriceSek: 2000, quantity: 1, automaticDiscountSek: 0, vatRate: 0.12 },
      ],
      2000,
    ),
    { subtotalSek: 3000, discountSek: 2100, vatSek: 144, totalSek: 1044 },
  );
});

test("multi-course cart allocates the complete discount across order lines", () => {
  const discounts = allocateCartDiscounts([
    { unitPriceSek: 1000, quantity: 1, automaticDiscountSek: 100 },
    { unitPriceSek: 2000, quantity: 1, automaticDiscountSek: 0 },
  ], 2000);
  assert.deepEqual(discounts, [721, 1379]);
  assert.equal(discounts.reduce((total, value) => total + value, 0), 2100);
});

test("ID06 status machine rejects skipping registration states", () => {
  assert.throws(
    () => assertId06Transition("not_ready", "registered"),
    /Invalid ID06 transition/,
  );
  assert.doesNotThrow(() =>
    assertId06Transition("ready_for_id06", "submitted"),
  );
  assert.throws(
    () => assertId06Transition("registered", "failed"),
    /Invalid ID06 transition/,
  );
});

test("role administration cannot remove the last active Super Admin", () => {
  assert.equal(canChangeSuperAdminRole("super_admin", "participant", 1), false);
  assert.equal(canChangeSuperAdminRole("super_admin", "participant", 2), true);
  assert.equal(canChangeSuperAdminRole("super_admin", "super_admin", 1), true);
  assert.equal(canChangeSuperAdminRole("participant", "course_admin", 1), true);
});

test("public certificate verification does not expose participant data", () => {
  const view = publicCertificateView({
    verificationCode: "ABC",
    certificateNumber: "KP-2026-1",
    courseName: "APV",
    issuedAt: "2026-01-01",
    validUntil: "2031-01-01",
    status: "issued",
  });
  assert.equal(view.course, "APV");
  assert.equal("userId" in view, false);
});

test("participant exam snapshots never expose correct answer ids", () => {
  const snapshot = publicExamSnapshot([
    { id: "q1", prompt: "Fråga", correctOptionIds: ["a"], options: [{ id: "a", label: "Ja" }] },
  ]);
  assert.deepEqual(snapshot, [{ id: "q1", prompt: "Fråga", options: [{ id: "a", label: "Ja" }] }]);
  assert.equal("correctOptionIds" in snapshot[0], false);
});

test("participant enrollment API does not expose the course authoring snapshot", () => {
  const route = readFileSync(new URL("../app/api/enrollments/[id]/route.ts", import.meta.url), "utf8");
  assert.match(route, /version: \{/);
  assert.match(route, /row\.version\.publishedAt/);
  assert.doesNotMatch(route, /version: row\.version\s*[,}]/);
  assert.doesNotMatch(route, /contentSnapshotJson/);
});

test("certificate remains valid throughout its final calendar day", () => {
  const view = publicCertificateView({
    verificationCode: "LAST-DAY",
    certificateNumber: "KP-2026-LAST",
    courseName: "APV",
    issuedAt: "2026-01-01",
    validUntil: new Date().toISOString().slice(0, 10),
    status: "issued",
  });
  assert.equal(view.valid, true);
});

test("paid order fulfillment derives validity and deterministic row ids", () => {
  assert.equal(addMonthsIso("2026-08-15T12:00:00.000Z", 60), "2031-08-15");
  assert.equal(addMonthsIso("2024-01-31T12:00:00.000Z", 1), "2024-02-29");
  assert.equal(addMonthsIso("2023-01-31T12:00:00.000Z", 1), "2023-02-28");
  assert.equal(addMonthsIso("2026-08-15T12:00:00.000Z", null), null);
  assert.equal(
    stableOrderRowId("enr", "order-1", "item-1:0"),
    stableOrderRowId("enr", "order-1", "item-1:0"),
  );
  assert.notEqual(
    stableOrderRowId("enr", "order-1", "item-1:0"),
    stableOrderRowId("enr", "order-1", "item-1:1"),
  );
});

test("new orders bind to the latest published course version", () => {
  const singleCourseRoute = readFileSync(new URL("../app/api/orders/route.ts", import.meta.url), "utf8");
  const cartRoute = readFileSync(new URL("../app/api/orders/cart/route.ts", import.meta.url), "utf8");
  const licenseRoute = readFileSync(new URL("../app/api/company/licenses/assign/route.ts", import.meta.url), "utf8");
  const publicCourseRoute = readFileSync(new URL("../app/api/courses/[slug]/route.ts", import.meta.url), "utf8");
  assert.match(singleCourseRoute, /orderBy\(desc\(courseVersions\.publishedAt\), desc\(courseVersions\.createdAt\)\)/);
  assert.match(cartRoute, /orderBy\(desc\(courseVersions\.publishedAt\), desc\(courseVersions\.createdAt\)\)/);
  assert.match(licenseRoute, /orderBy\(desc\(courseVersions\.publishedAt\), desc\(courseVersions\.createdAt\)\)/);
  assert.match(publicCourseRoute, /orderBy\(desc\(courseVersions\.publishedAt\), desc\(courseVersions\.createdAt\)\)/);
});

test("exam completion writes a version-scoped audit event", () => {
  const source = readFileSync(new URL("../app/api/exams/attempts/route.ts", import.meta.url), "utf8");
  assert.match(source, /targetType: "exam_attempt"/);
  assert.match(source, /action: "exam_attempt\.completed"/);
  assert.match(source, /courseVersionId: row\.attempt\.courseVersionId/);
});

test("invoice license activation follows the company setting", () => {
  assert.equal(
    shouldActivateInvoiceLicenses({ activateInvoiceLicensesImmediately: true }),
    true,
  );
  assert.equal(
    shouldActivateInvoiceLicenses({
      activateInvoiceLicensesImmediately: false,
    }),
    false,
  );
  assert.equal(shouldActivateInvoiceLicenses(null), false);
});

test("expired or cancelled enrollments cannot open course content", () => {
  assert.equal(
    enrollmentIsAccessible(
      {
        status: "completed",
        validFrom: "2026-01-01",
        validUntil: "2026-12-31",
      },
      new Date("2026-08-14T00:00:00Z"),
    ),
    true,
  );
  assert.equal(
    enrollmentIsAccessible(
      {
        status: "completed",
        validFrom: "2026-01-01",
        validUntil: "2026-08-13",
      },
      new Date("2026-08-14T00:00:00Z"),
    ),
    false,
  );
  assert.equal(
    enrollmentIsAccessible(
      { status: "cancelled", validFrom: null, validUntil: null },
      new Date("2026-08-14T00:00:00Z"),
    ),
    false,
  );
});

test("participant status uses the enrollment validity date", () => {
  const now = new Date("2026-08-14T00:00:00Z");
  assert.equal(
    enrollmentDisplayState(
      { status: "completed", validUntil: "2026-08-13" },
      now,
    ),
    "expired",
  );
  assert.equal(
    enrollmentDisplayState(
      { status: "in_progress", validUntil: "2026-09-01" },
      now,
    ),
    "expiring",
  );
  assert.equal(
    enrollmentDisplayState(
      { status: "not_started", validUntil: "2031-08-13" },
      now,
    ),
    "not_started",
  );
});

test("certification policy requires mandatory content before issuance", () => {
  assert.equal(
    hasCompletedRequiredLessons(["lesson-1", "lesson-2"], ["lesson-1"]),
    false,
  );
  assert.equal(
    hasCompletedRequiredLessons(
      ["lesson-1", "lesson-2"],
      ["lesson-1", "lesson-2"],
    ),
    true,
  );
});

test("quiz and exam lessons cannot be completed through the generic progress endpoint", () => {
  assert.equal(canManuallyCompleteLesson("article"), true);
  assert.equal(canManuallyCompleteLesson("video"), true);
  assert.equal(canManuallyCompleteLesson("quiz"), false);
  assert.equal(canManuallyCompleteLesson("exam"), false);
});

test("completed lesson progress cannot be downgraded by a participant", () => {
  assert.equal(nextLessonProgressStatus("completed", "started"), "completed");
  assert.equal(nextLessonProgressStatus("started", "completed"), "completed");
  assert.equal(nextLessonProgressStatus(null, "started"), "started");
});

test("course player provides a direct continuation target for unfinished lessons", () => {
  const source = readFileSync(new URL("../app/utbildning/[enrollmentId]/page.tsx", import.meta.url), "utf8");
  assert.match(source, /const nextLesson = content\.find\(\(\{ lesson \}\) => !completed\.has\(lesson\.id\)\)/);
  assert.match(source, /Fortsätt där du slutade/);
  assert.match(source, /\/utbildning\/\$\{enrollmentId\}\/lektion\/\$\{nextLesson\.id\}/);
});

test("progress only counts completed lessons and never exceeds 100 percent", () => {
  assert.equal(calculateProgressPercent(4, 1), 25);
  assert.equal(calculateProgressPercent(4, 2), 50);
  assert.equal(calculateProgressPercent(4, 9), 100);
  assert.equal(calculateProgressPercent(0, 0), 0);
});

test("ID06 certification requires encrypted personal identity data", () => {
  assert.equal(identityDataIsReadyForId06(null), false);
  assert.equal(
    identityDataIsReadyForId06({ personalIdentityEncrypted: null }),
    false,
  );
  assert.equal(
    identityDataIsReadyForId06({
      personalIdentityEncrypted: "encrypted-value",
    }),
    true,
  );
});

test("public write routes enforce a retryable rate limit", () => {
  const request = new Request("https://example.test", {
    headers: { "cf-connecting-ip": "198.51.100.42" },
  });
  assert.equal(rateLimit(request, "test-rate-limit", 1), null);
  const limited = rateLimit(request, "test-rate-limit", 1);
  assert.equal(limited?.status, 429);
  assert.equal(limited?.headers.get("retry-after"), "60");
});

test("identity verification start and BankID collection are rate limited", () => {
  const startRoute = readFileSync(new URL("../app/api/identity-verifications/route.ts", import.meta.url), "utf8");
  const collectRoute = readFileSync(new URL("../app/api/identity-verifications/[id]/route.ts", import.meta.url), "utf8");
  assert.match(startRoute, /identity-verification-start/);
  assert.match(collectRoute, /identity-verification-collect/);
  const identityUi = readFileSync(new URL("../app/utbildning/identity-request.tsx", import.meta.url), "utf8");
  assert.match(identityUi, /verificationMethod === "bankid"/);
});

test("sensitive admin and privacy mutations validate input server-side", () => {
  const identityAdmin = readFileSync(new URL("../app/api/admin/identity/route.ts", import.meta.url), "utf8");
  const contactAdmin = readFileSync(new URL("../app/api/admin/contact-messages/route.ts", import.meta.url), "utf8");
  const anonymize = readFileSync(new URL("../app/api/privacy/anonymize/route.ts", import.meta.url), "utf8");
  const consents = readFileSync(new URL("../app/api/privacy/consents/route.ts", import.meta.url), "utf8");
  assert.match(identityAdmin, /invalid_identity_status/);
  assert.match(contactAdmin, /invalid_message_status/);
  assert.match(anonymize, /privacy-anonymize/);
  assert.match(consents, /privacy-consent/);
});

test("certificate revocation is permission protected, audited and updates competency status", () => {
  const route = readFileSync(new URL("../app/api/admin/certificates/[id]/route.ts", import.meta.url), "utf8");
  const page = readFileSync(new URL("../app/admin/certifikat/page.tsx", import.meta.url), "utf8");
  assert.match(route, /certification:write/);
  assert.match(route, /certificate\.revoked/);
  assert.match(route, /competencies\.certificateId/);
  assert.match(page, /canRevoke/);
});

test("revoked certificates cannot be reactivated by an issuance retry", () => {
  const certification = readFileSync(new URL("../lib/certification.ts", import.meta.url), "utf8");
  assert.match(certification, /existing\[0\]\.status === "revoked"/);
  assert.match(certification, /certificate_revoked/);
});

test("audit log redacts before and after JSON for ordinary course admins", () => {
  const source = readFileSync(new URL("../app/admin/audit/page.tsx", import.meta.url), "utf8");
  assert.match(source, /canViewDetails = hasPermission\(actor\.role, "privacy:read"\) \|\| hasPermission\(actor\.role, "id06:read"\)/);
  assert.match(source, /db\.select\(\{ id: auditLogs\.id/);
  assert.match(source, /canViewDetails && "beforeJson" in row/);
});

test("company portal supports assigning a license to an existing employee or by email", () => {
  const page = readFileSync(new URL("../app/foretag/portal/page.tsx", import.meta.url), "utf8");
  const manager = readFileSync(new URL("../app/foretag/portal/license-manager.tsx", import.meta.url), "utf8");
  assert.match(page, /initialRecipients=/);
  assert.match(manager, /recipientMode/);
  assert.match(manager, /userId: recipientMode === "existing"/);
  assert.match(manager, /email: recipientMode === "email"/);
});

test("BankID adapter stays unconfigured until all provider settings exist", () => {
  assert.equal(
    configuredBankIdAdapter({ BANKID_PROVIDER: "manual-placeholder" }),
    null,
  );
  assert.equal(
    configuredBankIdAdapter({
      BANKID_PROVIDER: "http",
      BANKID_API_BASE_URL: "https://bankid.example",
      BANKID_API_TOKEN: "",
    }),
    null,
  );
  assert.ok(
    configuredBankIdAdapter({
      BANKID_PROVIDER: "http",
      BANKID_API_BASE_URL: "https://bankid.example",
      BANKID_API_TOKEN: "secret",
    }),
  );
});

test("BankID requires explicit provider confirmation of the personal number", () => {
  assert.equal(bankIdResultIsVerified({ status: "verified", personalNumber: "850101-1234" }), false);
  assert.equal(bankIdResultIsVerified({ status: "verified", personalNumberVerified: false, personalNumber: "850101-1234" }), false);
  assert.equal(bankIdResultIsVerified({ status: "verified", personalNumberVerified: true, personalNumber: "850101-1234" }), true);
});

test("Stripe fulfillment requires a confirmed payment event and exact order amount", () => {
  const paid = {
    type: "checkout.session.completed",
    data: {
      object: { payment_status: "paid", amount_total: 249000, currency: "sek" },
    },
  };
  const unpaid = {
    type: "checkout.session.completed",
    data: {
      object: {
        payment_status: "unpaid",
        amount_total: 249000,
        currency: "sek",
      },
    },
  };
  const intent = {
    type: "payment_intent.succeeded",
    data: { object: { amount_received: 249000, currency: "sek" } },
  };
  assert.equal(isConfirmedStripePayment(paid), true);
  assert.equal(isConfirmedStripePayment(unpaid), false);
  assert.equal(isConfirmedStripePayment(intent), true);
  assert.equal(stripeEventAmountSek(paid), 249000);
  assert.equal(stripeEventAmountSek(intent), 249000);
});

test("Stripe refund detection requires a full charge refund", () => {
  assert.equal(isFullStripeRefund({ type: "charge.refunded", data: { object: { refunded: true, amount: 249000, amount_refunded: 249000 } } }), true);
  assert.equal(isFullStripeRefund({ type: "charge.refunded", data: { object: { refunded: true, amount: 249000, amount_refunded: 100000 } } }), false);
});

test("email templates render variables as escaped HTML", () => {
  assert.equal(
    renderEmailTemplate("Hej {{name}}: {{course}}", {
      name: "<Anna>",
      course: "APV & säkerhet",
    }),
    "Hej &lt;Anna&gt;: APV &amp; säkerhet",
  );
});

test("Odoo import validation rejects malformed exam questions", () => {
  const result = validateOdooImport({
    course: { name: "APV", slug: "apv", basePriceSek: 2490 },
    version: { version: "2.0", exam: { questionCount: 1, passPercent: 80 } },
    questions: [
      {
        prompt: "Fråga",
        type: "single",
        answers: [{ label: "A", isCorrect: true }],
      },
    ],
  });
  assert.equal(
    result.errors.some((error) => error.includes("minst två svar")),
    true,
  );
  assert.equal(
    result.warnings.some((warning) => warning.includes("styrande dokument")),
    true,
  );
});

test("Odoo API import uses Worker-compatible Web Crypto", () => {
  const route = readFileSync(new URL("../app/api/import/odoo/route.ts", import.meta.url), "utf8");
  assert.doesNotMatch(route, /node:crypto/);
  assert.match(route, /crypto\.subtle\.digest/);
  assert.match(route, /SHA-256/);
});

test("Odoo import rejects a placeholder without course content", () => {
  const result = validateOdooImport({
    course: { name: "APV", slug: "apv" },
    version: { version: "1.0" },
  });
  assert.equal(result.errors.some((error) => error.includes("chapters")), true);
});

test("Odoo import validates topic-based exam quotas", () => {
  const result = validateOdooImport({
    course: { name: "APV", slug: "apv" },
    version: { version: "2.0", exam: { questionCount: 10, passPercent: 80, topicRules: [{ topic: "Riskbedömning", count: 5 }] } },
    questions: [],
  });
  assert.equal(result.errors.some((error) => error.includes("topicRules måste summera")), true);
});

test("Odoo import rejects an exam quota that the topic bank cannot fill", () => {
  const result = validateOdooImport({
    course: { name: "APV", slug: "apv" },
    version: { version: "2.0", exam: { questionCount: 2, passPercent: 80, topicRules: [{ topic: "TMA", count: 2 }] } },
    questions: [{ topic: "TMA", prompt: "Fråga", type: "single", answers: [{ label: "A", isCorrect: true }, { label: "B", isCorrect: false }] }],
  });
  assert.equal(result.errors.some((error) => error.includes("ämnet TMA")), true);
});

test("Odoo import rejects quiz references outside the exported question bank", () => {
  const result = validateOdooImport({
    course: { name: "APV", slug: "apv" },
    version: { version: "2.0" },
    chapters: [{ title: "Kapitel", lessons: [{ title: "Quiz", type: "quiz", quiz: { questionIndexes: [1] } }] }],
    questions: [],
  });
  assert.equal(result.errors.some((error) => error.includes("ogiltig fråga 1")), true);
});

test("Odoo import requires explicit question links for migrated quizzes", () => {
  const result = validateOdooImport({
    course: { name: "APV", slug: "apv" },
    version: { version: "2.0" },
    chapters: [
      {
        title: "Introduktion",
        lessons: [{ title: "Quiz", type: "quiz", quiz: { title: "Quiz" } }],
      },
    ],
  });
  assert.equal(result.errors.some((error) => error.includes("questionIndexes")), true);
});

test("Odoo import recognizes the same snapshot for partial-repair recovery", () => {
  const payload = {
    course: { name: "APV", slug: "apv" },
    version: { version: "2.0" },
    chapters: [{ title: "Introduktion", lessons: [{ title: "Start", type: "article" }] }],
  };
  assert.equal(importPayloadMatchesSnapshot(JSON.stringify(payload), payload), true);
  assert.equal(importPayloadMatchesSnapshot(JSON.stringify({ ...payload, version: { version: "3.0" } }), payload), false);
  assert.equal(importPayloadMatchesSnapshot("not-json", payload), false);
});

test("development APV seed is a valid normalized import", () => {
  const payload = JSON.parse(
    readFileSync(new URL("../data/apv-seed.json", import.meta.url), "utf8"),
  );
  const validation = validateOdooImport(payload);
  assert.deepEqual(validation.errors, []);
  assert.equal(payload.chapters.length, 3);
  assert.equal(payload.questions.length, 6);
  assert.equal(payload.version.exam.questionCount, 6);
});

test("version-scoped exam questions exclude questions from other versions", () => {
  const versionChapterIds = new Set(["chapter-v2"]);
  const questions = [
    { id: "v1", chapterId: "chapter-v1" },
    { id: "v2", chapterId: "chapter-v2" },
    { id: "shared", chapterId: null },
  ];
  const eligible = questions.filter((question) => questionBelongsToCourseVersion(question.chapterId, versionChapterIds));
  assert.deepEqual(eligible.map((question) => question.id), ["v2", "shared"]);
});

test("course asset uploads enforce safe keys, supported types and limits", () => {
  assert.equal(isSafeCourseAssetKey("apv/kapitel-1/intro.mp4"), true);
  assert.equal(isSafeCourseAssetKey("../private.txt"), false);
  assert.equal(isSafeCourseAssetKey("/absolute/path.pdf"), false);
  assert.equal(allowedCourseAssetTypes.has("video/mp4"), true);
  assert.equal(allowedCourseAssetTypes.has("application/x-executable"), false);
  assert.equal(courseAssetSizeLimit("video/mp4"), 500 * 1024 * 1024);
  assert.equal(courseAssetSizeLimit("application/pdf"), 50 * 1024 * 1024);
});

test("course asset URLs preserve nested Storage paths", () => {
  assert.equal(encodeCourseAssetKey("apv/kapitel 1/intro.mp4"), "apv/kapitel%201/intro.mp4");
});

test("CSV bundle normalizes hierarchy, quoted fields and quiz links", () => {
  const payload = normalizeOdooCsvBundle({
    "course.csv": "name,slug,basePriceSek\n\"APV, kurs\",apv,2490\n",
    "version.csv": "version,questionCount,passPercent\n1.0,1,80\n",
    "chapters.csv": "id,title\nc1,Introduktion\n",
    "lessons.csv": "chapterId,title,type,questionIndexes\nc1,Quiz,quiz,0\n",
    "questions.csv": "id,prompt,topic,type\nq1,\"Vad gäller?\",Risk,single\n",
    "answers.csv": "questionId,label,isCorrect\nq1,Ja,true\nq1,Nej,false\n",
    "governing_documents.csv": "title\nAktuellt dokument\n",
  });
  assert.equal(payload.course?.name, "APV, kurs");
  assert.equal(payload.chapters?.[0]?.lessons?.[0]?.quiz?.questionIndexes?.[0], 0);
  assert.equal(payload.questions?.[0]?.answers?.length, 2);
  assert.equal(validateOdooImport(payload).errors.length, 0);
});

test("notification templates include course lifecycle events", () => {
  assert.ok(defaultEmailTemplates.some((template) => template.key === "course_started"));
  assert.ok(defaultEmailTemplates.some((template) => template.key === "course_passed"));
  assert.ok(defaultEmailTemplates.some((template) => template.key === "course_released"));
  assert.ok(defaultEmailTemplates.some((template) => template.key === "company_report"));
});

test("admin broadcasts are permission-protected, capped and audited", () => {
  const route = readFileSync(new URL("../app/api/admin/notifications/broadcast/route.ts", import.meta.url), "utf8");
  const page = readFileSync(new URL("../app/admin/kommunikation/page.tsx", import.meta.url), "utf8");
  assert.match(route, /communication:write/);
  assert.match(route, /MAX_RECIPIENTS = 1000/);
  assert.match(route, /INSERT_BATCH_SIZE = 50/);
  assert.match(route, /offset \+= INSERT_BATCH_SIZE/);
  assert.match(route, /notification_broadcast\.queued/);
  assert.match(route, /sameOriginGuard/);
  assert.match(page, /BroadcastForm/);
});

test("browser mutations reject cross-origin requests", () => {
  const blocked = sameOriginGuard(new Request("https://portal.example/api/orders", {
    method: "POST",
    headers: { origin: "https://attacker.example" },
  }));
  assert.equal(blocked?.status, 403);

  const allowed = sameOriginGuard(new Request("https://portal.example/api/orders", {
    method: "POST",
    headers: { origin: "https://portal.example" },
  }));
  assert.equal(allowed, null);
});

test("question bank supports draft editing and protects published course questions", () => {
  const route = readFileSync(new URL("../app/api/admin/question-bank/route.ts", import.meta.url), "utf8");
  const manager = readFileSync(new URL("../app/admin/fragor/question-manager.tsx", import.meta.url), "utf8");
  assert.match(route, /published_course_question_immutable/);
  assert.match(route, /answers_required/);
  assert.match(route, /validAnswers =/);
  assert.match(route, /question\.updated/);
  assert.match(route, /db\.delete\(answerOptions\)/);
  assert.match(manager, /Redigera/);
  assert.match(manager, /Spara ändringar/);
});

test("ID06 course publication requires an examination configuration and exam lesson", () => {
  const route = readFileSync(new URL("../app/api/admin/courses/[id]/publish/route.ts", import.meta.url), "utf8");
  assert.match(route, /id06_exam_required/);
  assert.match(route, /examConfigs/);
  assert.match(route, /lesson\.type === "exam"/);
});

test("admin migration exposes the CSV bundle normalizer", () => {
  const form = readFileSync(new URL("../app/admin/import/odoo-import-form.tsx", import.meta.url), "utf8");
  assert.match(form, /normalizeOdooCsvBundle/);
  assert.match(form, /multiple/);
  assert.match(form, /Normalisera CSV/);
});

test("new course versions copy chapter-scoped assessments with new ids", () => {
  const route = readFileSync(new URL("../app/api/admin/courses/[id]/versions/route.ts", import.meta.url), "utf8");
  assert.match(route, /sourceVersion/);
  assert.match(route, /questionIdMap/);
  assert.match(route, /answerOptions/);
  assert.match(route, /quizQuestions/);
  assert.match(route, /sourceExam/);
  assert.match(route, /examConfigs/);
  assert.match(route, /copiedAssessments/);
});

test("editing a draft preserves its chapter-scoped assessments", () => {
  const route = readFileSync(new URL("../app/api/admin/courses/[id]/versions/[versionId]/route.ts", import.meta.url), "utf8");
  assert.match(route, /oldQuestions/);
  assert.match(route, /oldQuizQuestions/);
  assert.match(route, /assessmentsPreserved/);
  assert.match(route, /questionIdMap/);
});

test("exam configuration changes are audit logged", () => {
  const route = readFileSync(new URL("../app/api/admin/exams/[versionId]/route.ts", import.meta.url), "utf8");
  assert.match(route, /exam_config\.updated/);
  assert.match(route, /beforeJson/);
  assert.match(route, /questionSelectionJson/);
});

test("quiz submissions write an enrollment- and version-scoped audit event", () => {
  const route = readFileSync(new URL("../app/api/quizzes/[id]/submit/route.ts", import.meta.url), "utf8");
  assert.match(route, /quiz_attempt\.completed/);
  assert.match(route, /courseVersionId/);
  assert.match(route, /requestMetadata/);
});

test("lesson progress changes write an enrollment- and version-scoped audit event", () => {
  const route = readFileSync(new URL("../app/api/progress/route.ts", import.meta.url), "utf8");
  assert.match(route, /lesson_progress\.changed/);
  assert.match(route, /courseVersionId/);
  assert.match(route, /requestMetadata/);
});

test("admin enrollment detail exposes complete version-scoped learner documentation", () => {
  const page = readFileSync(new URL("../app/admin/enrollments/[id]/page.tsx", import.meta.url), "utf8");
  assert.match(page, /lessonProgress/);
  assert.match(page, /quizAttempts/);
  assert.match(page, /examAttempts/);
  assert.match(page, /identityVerifications/);
  assert.match(page, /id06Registrations/);
  assert.match(page, /auditLogs/);
  assert.match(page, /courseVersionId/);
});

test("company views scope enrollments to the current company", () => {
  const portal = readFileSync(new URL("../app/foretag/portal/page.tsx", import.meta.url), "utf8");
  const report = readFileSync(new URL("../app/api/company/report/route.ts", import.meta.url), "utf8");
  assert.match(portal, /eq\(enrollments\.companyId, membership\.company\.id\)/);
  assert.match(report, /eq\(enrollments\.companyId, membership\.company\.id\)/);
});

test("assessment writes enforce a retryable rate limit", () => {
  const quiz = readFileSync(new URL("../app/api/quizzes/[id]/submit/route.ts", import.meta.url), "utf8");
  const exam = readFileSync(new URL("../app/api/exams/attempts/route.ts", import.meta.url), "utf8");
  assert.match(quiz, /rateLimit\(request, "quiz-submit", 20\)/);
  assert.match(exam, /rateLimit\(request, "exam-start", 10\)/);
  assert.match(exam, /rateLimit\(request, "exam-submit", 10\)/);
});

test("certification admins can read ID06 identity data while company admins cannot", () => {
  const platform = readFileSync(new URL("../lib/platform.ts", import.meta.url), "utf8");
  const certificationAdmin = platform.match(/certification_admin: \[(.*?)\n  \],/s)?.[1] ?? "";
  const companyAdmin = platform.match(/company_admin: \[(.*?)\n  \],/s)?.[1] ?? "";
  assert.match(certificationAdmin, /"id06:read"/);
  assert.doesNotMatch(companyAdmin, /"id06:read"/);
});

test("lesson player records started state and passed quizzes complete it", () => {
  const player = readFileSync(new URL("../app/utbildning/lesson-start.tsx", import.meta.url), "utf8");
  const outline = readFileSync(new URL("../app/utbildning/[enrollmentId]/page.tsx", import.meta.url), "utf8");
  const quiz = readFileSync(new URL("../app/api/quizzes/[id]/submit/route.ts", import.meta.url), "utf8");
  assert.match(player, /status: "started"/);
  assert.match(outline, /status === "started"/);
  assert.match(quiz, /onConflictDoUpdate/);
  assert.match(quiz, /status: "completed"/);
});

test("new course versions never retain old chapter-scoped quiz question ids", () => {
  const createVersion = readFileSync(new URL("../app/api/admin/courses/[id]/versions/route.ts", import.meta.url), "utf8");
  const editVersion = readFileSync(new URL("../app/api/admin/courses/[id]/versions/[versionId]/route.ts", import.meta.url), "utf8");
  assert.match(createVersion, /!sourceQuestion \|\| \(sourceQuestion\.chapterId !== null && !mappedQuestionId\)/);
  assert.match(editVersion, /allCourseQuestions/);
  assert.match(editVersion, /!sourceQuestion \|\| \(sourceQuestion\.chapterId !== null && !mappedQuestionId\)/);
});

test("participant course structures respect chapter and lesson order", () => {
  const player = readFileSync(new URL("../app/utbildning/[enrollmentId]/page.tsx", import.meta.url), "utf8");
  const api = readFileSync(new URL("../app/api/enrollments/[id]/route.ts", import.meta.url), "utf8");
  assert.match(player, /orderBy\(asc\(chapters\.sortOrder\), asc\(lessons\.sortOrder\)\)/);
  assert.match(api, /orderBy\(asc\(chapters\.sortOrder\), asc\(lessons\.sortOrder\)\)/);
});

test("private course assets authorize question images as well as lesson media", () => {
  const route = readFileSync(new URL("../app/api/course-assets/[...key]/route.ts", import.meta.url), "utf8");
  assert.match(route, /questions/);
  assert.match(route, /owned\.some\(\(\{ enrollment, lesson, question \}\)/);
  assert.match(route, /question\?\.imageUrl/);
  assert.match(route, /isNull\(questions\.chapterId\)/);
});

test("admin and worker routes only write columns present in their tables", () => {
  const reminders = readFileSync(new URL("../lib/reminders.ts", import.meta.url), "utf8");
  const revocation = readFileSync(new URL("../app/api/admin/certificates/[id]/route.ts", import.meta.url), "utf8");
  const quality = readFileSync(new URL("../app/admin/kvalitet/page.tsx", import.meta.url), "utf8");
  const communication = readFileSync(new URL("../app/admin/kommunikation/page.tsx", import.meta.url), "utf8");
  assert.doesNotMatch(reminders, /update\(competencies\)[\s\S]{0,180}set\(\{ status: "(?:expired|expiring|valid)", updatedAt/);
  assert.doesNotMatch(revocation, /set\(\{ status: "revoked", updatedAt/);
  assert.match(quality, /select\(\{ id: courses\.id, name: courses\.name \}\)\.from\(courses\)/);
  assert.doesNotMatch(communication, /notifications\.createdAt/);
});

test("reminder windows are stored, validated and consumed by the worker", () => {
  const settings = readFileSync(new URL("../app/api/admin/settings/route.ts", import.meta.url), "utf8");
  const worker = readFileSync(new URL("../worker/index.ts", import.meta.url), "utf8");
  const maintenance = readFileSync(new URL("../lib/maintenance.ts", import.meta.url), "utf8");
  const page = readFileSync(new URL("../app/admin/installningar/page.tsx", import.meta.url), "utf8");
  assert.match(settings, /normalizeReminderWindows/);
  assert.match(settings, /reminder_windows\.updated/);
  assert.match(worker, /runDailyMaintenance\(db, env\)/);
  assert.match(maintenance, /getReminderWindows/);
  assert.match(maintenance, /queueExpiringReminders/);
  assert.match(page, /ReminderSettings/);
});

test("customer support has a limited admin entry point", () => {
  const platform = readFileSync(new URL("../lib/platform.ts", import.meta.url), "utf8");
  const layout = readFileSync(new URL("../app/admin/layout.tsx", import.meta.url), "utf8");
  const page = readFileSync(new URL("../app/admin/page.tsx", import.meta.url), "utf8");
  assert.match(platform, /isAdministrativeRole/);
  assert.match(layout, /isAdministrativeRole\(actor\.role\)/);
  assert.match(page, /support:read/);
  assert.match(page, /Order och betalningar/);
});

test("company dashboards only count employee members", () => {
  const page = readFileSync(new URL("../app/foretag/portal/page.tsx", import.meta.url), "utf8");
  const report = readFileSync(new URL("../app/api/company/report/route.ts", import.meta.url), "utf8");
  assert.match(page, /eq\(companyMembers\.role, "employee"\)/);
  assert.match(report, /eq\(companyMembers\.role, "employee"\)/);
});

test("participant admin UI hides sensitive controls from support", () => {
  const page = readFileSync(new URL("../app/admin/deltagare/page.tsx", import.meta.url), "utf8");
  const manager = readFileSync(new URL("../app/admin/deltagare/participant-role-manager.tsx", import.meta.url), "utf8");
  assert.match(page, /canManageIdentity/);
  assert.match(page, /canManagePrivacy/);
  assert.match(manager, /canManageRoles &&/);
  assert.match(manager, /canManageIdentity &&/);
  assert.match(manager, /canManagePrivacy &&/);
});

test("contact messages have a support inbox and audited status changes", () => {
  const route = readFileSync(new URL("../app/api/admin/contact-messages/route.ts", import.meta.url), "utf8");
  const page = readFileSync(new URL("../app/admin/kontakt/page.tsx", import.meta.url), "utf8");
  assert.match(route, /support:read/);
  assert.match(route, /support:write/);
  assert.match(route, /contact_message\.status_changed/);
  assert.match(page, /ContactMessageManager/);
});

test("support participant payload does not include identity fragments or forbidden export", () => {
  const page = readFileSync(new URL("../app/admin/deltagare/page.tsx", import.meta.url), "utf8");
  assert.match(page, /canManageIdentity \? identityLast4\.get\(user\.id\)/);
  assert.match(page, /canExportEnrollments &&/);
});

test("ID06 admin queue can record failed registrations with an error reason", () => {
  const page = readFileSync(new URL("../app/admin/id06/id06-queue.tsx", import.meta.url), "utf8");
  const route = readFileSync(new URL("../app/api/admin/id06/[id]/route.ts", import.meta.url), "utf8");
  assert.match(page, /Markera fel/);
  assert.match(page, /errorMessage/);
  assert.match(route, /id06_error_message_required/);
});

test("admin navigation follows server permissions", () => {
  const page = readFileSync(new URL("../app/admin/page.tsx", import.meta.url), "utf8");
  assert.match(page, /items\.filter/);
  assert.match(page, /hasPermission\(role, permission\)/);
  assert.match(page, /AdminNavigation/);
});

test("quiz administration groups all linked questions and audits create/update", () => {
  const page = readFileSync(new URL("../app/admin/quiz/page.tsx", import.meta.url), "utf8");
  const createRoute = readFileSync(new URL("../app/api/admin/quizzes/route.ts", import.meta.url), "utf8");
  const updateRoute = readFileSync(new URL("../app/api/admin/quizzes/[id]/route.ts", import.meta.url), "utf8");
  assert.match(page, /reduce\(\(groups, \{ quiz, link \}\)/);
  assert.match(createRoute, /quiz\.created/);
  assert.match(createRoute, /invalid_pass_percent/);
  assert.match(updateRoute, /quiz\.updated/);
});

test("elevdokumentation export imports and uses the chapter hierarchy", () => {
  const route = readFileSync(new URL("../app/api/admin/enrollments/export/route.ts", import.meta.url), "utf8");
  assert.match(route, /import \{[\s\S]*chapters,[\s\S]*from "@\/db\/schema"/);
  assert.match(route, /innerJoin\(chapters, eq\(chapters\.id, lessons\.chapterId\)\)/);
});

test("Supabase cron delegates daily validity, reminders and mail dispatch", () => {
  const cron = readFileSync(new URL("../app/api/cron/daily/route.ts", import.meta.url), "utf8");
  assert.match(cron, /runDailyMaintenance\(getDb\(\), runtimeEnv\(\)\)/);
});
