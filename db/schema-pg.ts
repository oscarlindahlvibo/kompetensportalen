import { sql } from "drizzle-orm";
import { boolean, index, integer, pgSchema, real, text, uniqueIndex } from "drizzle-orm/pg-core";

const kompetensportalen = pgSchema("kompetensportalen");

const timestamps = {
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP::text`),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP::text`),
};

export const users = kompetensportalen.table("users", {
  id: text("id").primaryKey(),
  email: text("email").notNull().unique(),
  passwordHash: text("password_hash"),
  role: text("role", {
    enum: ["super_admin", "course_admin", "certification_admin", "customer_support", "company_admin", "participant"],
  }).notNull().default("participant"),
  status: text("status", { enum: ["active", "invited", "suspended", "anonymized"] }).notNull().default("active"),
  lastLoginAt: text("last_login_at"),
  ...timestamps,
});

export const profiles = kompetensportalen.table("profiles", {
  userId: text("user_id").primaryKey().references(() => users.id),
  firstName: text("first_name").notNull(),
  lastName: text("last_name").notNull(),
  phone: text("phone"),
  personalIdentityEncrypted: text("personal_identity_encrypted"),
  identityLast4: text("identity_last4"),
  gdprState: text("gdpr_state", { enum: ["normal", "export_requested", "anonymized"] }).notNull().default("normal"),
  ...timestamps,
});

export const companies = kompetensportalen.table("companies", {
  id: text("id").primaryKey(),
  organizationNumber: text("organization_number").notNull().unique(),
  name: text("name").notNull(),
  invoiceAddress: text("invoice_address"),
  contactEmail: text("contact_email").notNull(),
  invoicePurchaseEnabled: boolean("invoice_purchase_enabled", ).notNull().default(false),
  activateInvoiceLicensesImmediately: boolean("activate_invoice_licenses_immediately", ).notNull().default(false),
  ...timestamps,
});

export const companyMembers = kompetensportalen.table("company_members", {
  id: text("id").primaryKey(),
  companyId: text("company_id").notNull().references(() => companies.id),
  userId: text("user_id").notNull().references(() => users.id),
  role: text("role", { enum: ["admin", "employee"] }).notNull(),
  ...timestamps,
}, (table) => ({
  companyUserIdx: uniqueIndex("company_members_company_user_idx").on(table.companyId, table.userId),
}));

export const courses = kompetensportalen.table("courses", {
  id: text("id").primaryKey(),
  slug: text("slug").notNull().unique(),
  name: text("name").notNull(),
  shortDescription: text("short_description").notNull(),
  fullDescription: text("full_description").notNull(),
  category: text("category").notNull(),
  status: text("status", { enum: ["draft", "coming_soon", "published", "archived"] }).notNull().default("draft"),
  imageUrl: text("image_url"),
  bannerUrl: text("banner_url"),
  tagsJson: text("tags_json").notNull().default("[]"),
  basePriceSek: integer("base_price_sek").notNull(),
  vatRate: real("vat_rate").notNull().default(0.25),
  campaignPriceSek: integer("campaign_price_sek"),
  validityMonths: integer("validity_months"),
  estimatedMinutes: integer("estimated_minutes").notNull(),
  targetAudience: text("target_audience"),
  prerequisites: text("prerequisites"),
  regulatoryFramework: text("regulatory_framework"),
  competenceCode: text("competence_code"),
  requiresIdentityVerification: boolean("requires_identity_verification", ).notNull().default(false),
  id06Enabled: boolean("id06_enabled", ).notNull().default(false),
  seoTitle: text("seo_title"),
  seoDescription: text("seo_description"),
  ...timestamps,
});

export const courseVersions = kompetensportalen.table("course_versions", {
  id: text("id").primaryKey(),
  courseId: text("course_id").notNull().references(() => courses.id),
  version: text("version").notNull(),
  status: text("status", { enum: ["draft", "published", "retired"] }).notNull().default("draft"),
  changelog: text("changelog"),
  contentSnapshotJson: text("content_snapshot_json").notNull(),
  publishedAt: text("published_at"),
  ...timestamps,
}, (table) => ({
  courseVersionIdx: uniqueIndex("course_versions_course_version_idx").on(table.courseId, table.version),
}));

export const chapters = kompetensportalen.table("chapters", {
  id: text("id").primaryKey(),
  courseVersionId: text("course_version_id").notNull().references(() => courseVersions.id),
  title: text("title").notNull(),
  description: text("description"),
  sortOrder: integer("sort_order").notNull(),
});

export const examConfigs = kompetensportalen.table("exam_configs", {
  id: text("id").primaryKey(),
  courseVersionId: text("course_version_id").notNull().references(() => courseVersions.id),
  questionCount: integer("question_count").notNull().default(30),
  passPercent: integer("pass_percent").notNull().default(80),
  timeLimitSeconds: integer("time_limit_seconds"),
  maxAttempts: integer("max_attempts").notNull().default(3),
  cooldownSeconds: integer("cooldown_seconds").notNull().default(0),
  randomizeQuestions: boolean("randomize_questions", ).notNull().default(true),
  randomizeAnswers: boolean("randomize_answers", ).notNull().default(true),
  questionSelectionJson: text("question_selection_json").notNull().default("[]"),
  ...timestamps,
}, (table) => ({
  examConfigVersionIdx: uniqueIndex("exam_configs_course_version_idx").on(table.courseVersionId),
}));

export const lessons = kompetensportalen.table("lessons", {
  id: text("id").primaryKey(),
  chapterId: text("chapter_id").notNull().references(() => chapters.id),
  title: text("title").notNull(),
  type: text("type", { enum: ["article", "video", "image", "document", "quiz", "exam", "mixed"] }).notNull(),
  bodyJson: text("body_json").notNull(),
  required: boolean("required", ).notNull().default(true),
  sortOrder: integer("sort_order").notNull(),
});

export const products = kompetensportalen.table("products", {
  id: text("id").primaryKey(),
  courseId: text("course_id").notNull().references(() => courses.id),
  sku: text("sku").notNull().unique(),
  name: text("name").notNull(),
  priceSek: integer("price_sek").notNull(),
  active: boolean("active", ).notNull().default(true),
});

export const orders = kompetensportalen.table("orders", {
  id: text("id").primaryKey(),
  buyerUserId: text("buyer_user_id").references(() => users.id),
  companyId: text("company_id").references(() => companies.id),
  buyerType: text("buyer_type", { enum: ["private", "company"] }).notNull(),
  status: text("status", { enum: ["draft", "checkout_pending", "payment_processing", "paid", "invoice_pending", "cancelled", "refunded"] }).notNull().default("draft"),
  subtotalSek: integer("subtotal_sek").notNull(),
  discountSek: integer("discount_sek").notNull().default(0),
  vatSek: integer("vat_sek").notNull(),
  totalSek: integer("total_sek").notNull(),
  discountCodeId: text("discount_code_id"),
  stripeCheckoutSessionId: text("stripe_checkout_session_id"),
  stripePaymentIntentId: text("stripe_payment_intent_id"),
  invoiceReference: text("invoice_reference"),
  ...timestamps,
});

export const orderItems = kompetensportalen.table("order_items", {
  id: text("id").primaryKey(),
  orderId: text("order_id").notNull().references(() => orders.id),
  productId: text("product_id").notNull().references(() => products.id),
  courseId: text("course_id").notNull().references(() => courses.id),
  courseVersionId: text("course_version_id").references(() => courseVersions.id),
  quantity: integer("quantity").notNull(),
  unitPriceSek: integer("unit_price_sek").notNull(),
  discountSek: integer("discount_sek").notNull().default(0),
});

export const payments = kompetensportalen.table("payments", {
  id: text("id").primaryKey(),
  orderId: text("order_id").notNull().references(() => orders.id),
  provider: text("provider", { enum: ["stripe", "invoice"] }).notNull(),
  status: text("status", { enum: ["pending", "authorized", "paid", "failed", "refunded"] }).notNull(),
  providerReference: text("provider_reference"),
  amountSek: integer("amount_sek").notNull(),
  paidAt: text("paid_at"),
  rawEventJson: text("raw_event_json"),
  ...timestamps,
});

export const courseLicenses = kompetensportalen.table("course_licenses", {
  id: text("id").primaryKey(),
  companyId: text("company_id").references(() => companies.id),
  orderItemId: text("order_item_id").references(() => orderItems.id),
  courseId: text("course_id").notNull().references(() => courses.id),
  courseVersionId: text("course_version_id").references(() => courseVersions.id),
  assignedToUserId: text("assigned_to_user_id").references(() => users.id),
  assignedEmail: text("assigned_email"),
  status: text("status", { enum: ["available", "assigned", "consumed", "expired", "revoked"] }).notNull().default("available"),
  assignedAt: text("assigned_at"),
  consumedEnrollmentId: text("consumed_enrollment_id"),
  ...timestamps,
}, (table) => ({
  consumedEnrollmentIdx: uniqueIndex("course_licenses_consumed_enrollment_idx").on(table.consumedEnrollmentId),
}));

export const enrollments = kompetensportalen.table("enrollments", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull().references(() => users.id),
  companyId: text("company_id").references(() => companies.id),
  courseId: text("course_id").notNull().references(() => courses.id),
  courseVersionId: text("course_version_id").notNull().references(() => courseVersions.id),
  orderItemId: text("order_item_id").references(() => orderItems.id),
  licenseId: text("license_id").references(() => courseLicenses.id),
  status: text("status", { enum: ["not_started", "in_progress", "completed", "expired", "cancelled"] }).notNull().default("not_started"),
  progressPercent: integer("progress_percent").notNull().default(0),
  purchasedAt: text("purchased_at").notNull().default(sql`CURRENT_TIMESTAMP::text`),
  startedAt: text("started_at"),
  completedAt: text("completed_at"),
  validFrom: text("valid_from"),
  validUntil: text("valid_until"),
  ...timestamps,
}, (table) => ({
  enrollmentUserCourseIdx: index("enrollments_user_course_idx").on(table.userId, table.courseId),
}));

export const lessonProgress = kompetensportalen.table("lesson_progress", {
  id: text("id").primaryKey(),
  enrollmentId: text("enrollment_id").notNull().references(() => enrollments.id),
  lessonId: text("lesson_id").notNull().references(() => lessons.id),
  status: text("status", { enum: ["not_started", "started", "completed"] }).notNull().default("not_started"),
  completedAt: text("completed_at"),
}, (table) => ({
  lessonEnrollmentIdx: uniqueIndex("lesson_progress_enrollment_lesson_idx").on(table.enrollmentId, table.lessonId),
}));

export const quizzes = kompetensportalen.table("quizzes", {
  id: text("id").primaryKey(),
  lessonId: text("lesson_id").references(() => lessons.id),
  title: text("title").notNull(),
  feedbackMode: text("feedback_mode", { enum: ["immediate", "after_submit", "none"] }).notNull().default("immediate"),
  passPercent: integer("pass_percent"),
});

export const questions = kompetensportalen.table("questions", {
  id: text("id").primaryKey(),
  courseId: text("course_id").notNull().references(() => courses.id),
  chapterId: text("chapter_id").references(() => chapters.id),
  topic: text("topic").notNull(),
  difficulty: text("difficulty", { enum: ["easy", "medium", "hard"] }).notNull().default("medium"),
  type: text("type", { enum: ["single", "multiple", "true_false", "image"] }).notNull(),
  prompt: text("prompt").notNull(),
  explanation: text("explanation"),
  points: integer("points").notNull().default(1),
  active: boolean("active", ).notNull().default(true),
  imageUrl: text("image_url"),
  ...timestamps,
});

export const answerOptions = kompetensportalen.table("answer_options", {
  id: text("id").primaryKey(),
  questionId: text("question_id").notNull().references(() => questions.id),
  label: text("label").notNull(),
  isCorrect: boolean("is_correct", ).notNull().default(false),
  sortOrder: integer("sort_order").notNull(),
});

export const quizQuestions = kompetensportalen.table("quiz_questions", {
  id: text("id").primaryKey(),
  quizId: text("quiz_id").notNull().references(() => quizzes.id),
  questionId: text("question_id").notNull().references(() => questions.id),
  sortOrder: integer("sort_order").notNull(),
}, (table) => ({
  quizQuestionIdx: uniqueIndex("quiz_questions_quiz_question_idx").on(table.quizId, table.questionId),
}));

export const quizAttempts = kompetensportalen.table("quiz_attempts", {
  id: text("id").primaryKey(),
  enrollmentId: text("enrollment_id").notNull().references(() => enrollments.id),
  quizId: text("quiz_id").notNull().references(() => quizzes.id),
  courseVersionId: text("course_version_id").notNull().references(() => courseVersions.id),
  attemptNumber: integer("attempt_number").notNull(),
  questionSnapshotJson: text("question_snapshot_json").notNull(),
  answersJson: text("answers_json").notNull(),
  scorePercent: integer("score_percent").notNull(),
  passed: boolean("passed", ).notNull(),
  submittedAt: text("submitted_at").notNull(),
  ...timestamps,
});

export const examAttempts = kompetensportalen.table("exam_attempts", {
  id: text("id").primaryKey(),
  enrollmentId: text("enrollment_id").notNull().references(() => enrollments.id),
  courseVersionId: text("course_version_id").notNull().references(() => courseVersions.id),
  attemptNumber: integer("attempt_number").notNull(),
  status: text("status", { enum: ["started", "grading", "passed", "failed", "abandoned"] }).notNull(),
  startedAt: text("started_at").notNull(),
  finishedAt: text("finished_at"),
  questionSnapshotJson: text("question_snapshot_json").notNull(),
  scorePercent: integer("score_percent"),
  passed: boolean("passed", ).notNull().default(false),
}, (table) => ({
  examAttemptNumberIdx: uniqueIndex("exam_attempts_enrollment_attempt_idx").on(table.enrollmentId, table.attemptNumber),
}));

export const examAnswers = kompetensportalen.table("exam_answers", {
  id: text("id").primaryKey(),
  examAttemptId: text("exam_attempt_id").notNull().references(() => examAttempts.id),
  questionId: text("question_id").notNull().references(() => questions.id),
  selectedOptionIdsJson: text("selected_option_ids_json").notNull(),
  correct: boolean("correct", ).notNull(),
  pointsAwarded: integer("points_awarded").notNull().default(0),
});

export const identityVerifications = kompetensportalen.table("identity_verifications", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull().references(() => users.id),
  enrollmentId: text("enrollment_id").references(() => enrollments.id),
  status: text("status", { enum: ["identity_pending", "identity_verified", "rejected"] }).notNull().default("identity_pending"),
  method: text("method", { enum: ["manual_bankid_document", "bankid", "admin_check"] }).notNull(),
  verifiedAt: text("verified_at"),
  reference: text("reference"),
  verifiedByUserId: text("verified_by_user_id").references(() => users.id),
  notes: text("notes"),
  ...timestamps,
}, (table) => ({
  identityEnrollmentIdx: uniqueIndex("identity_verifications_enrollment_idx").on(table.enrollmentId),
}));

export const certificates = kompetensportalen.table("certificates", {
  id: text("id").primaryKey(),
  enrollmentId: text("enrollment_id").notNull().references(() => enrollments.id),
  userId: text("user_id").notNull().references(() => users.id),
  courseId: text("course_id").notNull().references(() => courses.id),
  courseVersionId: text("course_version_id").notNull().references(() => courseVersions.id),
  certificateNumber: text("certificate_number").notNull().unique(),
  verificationCode: text("verification_code").notNull().unique(),
  issuedAt: text("issued_at").notNull(),
  validUntil: text("valid_until"),
  status: text("status", { enum: ["issued", "revoked", "expired"] }).notNull().default("issued"),
}, (table) => ({
  certificateEnrollmentIdx: uniqueIndex("certificates_enrollment_idx").on(table.enrollmentId),
}));

export const competencies = kompetensportalen.table("competencies", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull().references(() => users.id),
  courseId: text("course_id").notNull().references(() => courses.id),
  certificateId: text("certificate_id").notNull().references(() => certificates.id),
  validFrom: text("valid_from").notNull(),
  validUntil: text("valid_until"),
  status: text("status", { enum: ["valid", "expiring", "expired", "revoked"] }).notNull().default("valid"),
}, (table) => ({
  competencyCertificateIdx: uniqueIndex("competencies_certificate_idx").on(table.certificateId),
}));

export const id06Registrations = kompetensportalen.table("id06_registrations", {
  id: text("id").primaryKey(),
  certificateId: text("certificate_id").notNull().references(() => certificates.id),
  enrollmentId: text("enrollment_id").notNull().references(() => enrollments.id),
  competenceCode: text("competence_code").notNull(),
  competenceName: text("competence_name").notNull(),
  status: text("status", { enum: ["not_ready", "ready_for_id06", "submitted", "registered", "failed"] }).notNull().default("not_ready"),
  submittedAt: text("submitted_at"),
  registeredAt: text("registered_at"),
  handledByUserId: text("handled_by_user_id").references(() => users.id),
  id06Reference: text("id06_reference"),
  errorMessage: text("error_message"),
  ...timestamps,
}, (table) => ({
  id06CertificateIdx: uniqueIndex("id06_registrations_certificate_idx").on(table.certificateId),
}));

export const discountCodes = kompetensportalen.table("discount_codes", {
  id: text("id").primaryKey(),
  code: text("code").notNull().unique(),
  type: text("type", { enum: ["percent", "fixed"] }).notNull(),
  value: integer("value").notNull(),
  startsAt: text("starts_at"),
  endsAt: text("ends_at"),
  maxUses: integer("max_uses"),
  uses: integer("uses").notNull().default(0),
  reservedUses: integer("reserved_uses").notNull().default(0),
  courseIdsJson: text("course_ids_json").notNull().default("[]"),
  minimumOrderSek: integer("minimum_order_sek"),
  active: boolean("active", ).notNull().default(true),
});

export const priceRules = kompetensportalen.table("price_rules", {
  id: text("id").primaryKey(),
  courseId: text("course_id").references(() => courses.id),
  minQuantity: integer("min_quantity").notNull(),
  maxQuantity: integer("max_quantity"),
  discountPercent: integer("discount_percent"),
  fixedUnitPriceSek: integer("fixed_unit_price_sek"),
  label: text("label").notNull(),
  active: boolean("active", ).notNull().default(true),
});

export const governingDocuments = kompetensportalen.table("governing_documents", {
  id: text("id").primaryKey(),
  title: text("title").notNull(),
  documentNumber: text("document_number"),
  version: text("version"),
  publishedAt: text("published_at"),
  url: text("url"),
  lastCheckedAt: text("last_checked_at"),
  responsibleUserId: text("responsible_user_id").references(() => users.id),
  notes: text("notes"),
  ...timestamps,
});

export const courseVersionGoverningDocuments = kompetensportalen.table("course_version_governing_documents", {
  id: text("id").primaryKey(),
  courseVersionId: text("course_version_id").notNull().references(() => courseVersions.id),
  governingDocumentId: text("governing_document_id").notNull().references(() => governingDocuments.id),
});

export const qualityReviews = kompetensportalen.table("quality_reviews", {
  id: text("id").primaryKey(),
  courseId: text("course_id").notNull().references(() => courses.id),
  educationOwnerUserId: text("education_owner_user_id").references(() => users.id),
  contentOwnerUserId: text("content_owner_user_id").references(() => users.id),
  latestReviewAt: text("latest_review_at"),
  nextReviewAt: text("next_review_at"),
  notes: text("notes"),
  contentReviewed: boolean("content_reviewed", ).notNull().default(false),
  examReviewed: boolean("exam_reviewed", ).notNull().default(false),
  certificateReviewed: boolean("certificate_reviewed", ).notNull().default(false),
  id06CodeVerified: boolean("id06_code_verified", ).notNull().default(false),
  publicationApproved: boolean("publication_approved", ).notNull().default(false),
  ...timestamps,
});

export const notifications = kompetensportalen.table("notifications", {
  id: text("id").primaryKey(),
  userId: text("user_id").references(() => users.id),
  companyId: text("company_id").references(() => companies.id),
  recipientEmail: text("recipient_email"),
  type: text("type").notNull(),
  subject: text("subject").notNull(),
  body: text("body").notNull(),
  status: text("status", { enum: ["queued", "sending", "sent", "failed", "cancelled"] }).notNull().default("queued"),
  scheduledFor: text("scheduled_for"),
  sentAt: text("sent_at"),
});

export const emailTemplates = kompetensportalen.table("email_templates", {
  id: text("id").primaryKey(),
  key: text("key").notNull().unique(),
  name: text("name").notNull(),
  subject: text("subject").notNull(),
  body: text("body").notNull(),
  active: boolean("active", ).notNull().default(true),
  ...timestamps,
});

export const courseInterest = kompetensportalen.table("course_interest", {
  id: text("id").primaryKey(),
  courseId: text("course_id").notNull().references(() => courses.id),
  email: text("email").notNull(),
  status: text("status", { enum: ["subscribed", "notified", "unsubscribed"] }).notNull().default("subscribed"),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP::text`),
}, (table) => ({
  courseEmailIdx: uniqueIndex("course_interest_course_email_idx").on(table.courseId, table.email),
}));

export const contactMessages = kompetensportalen.table("contact_messages", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull(),
  message: text("message").notNull(),
  status: text("status", { enum: ["new", "in_progress", "closed"] }).notNull().default("new"),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP::text`),
});

export const consents = kompetensportalen.table("consents", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull().references(() => users.id),
  consentType: text("consent_type").notNull(),
  policyVersion: text("policy_version").notNull(),
  grantedAt: text("granted_at").notNull(),
  withdrawnAt: text("withdrawn_at"),
});

export const odooImports = kompetensportalen.table("odoo_imports", {
  id: text("id").primaryKey(),
  source: text("source").notNull(),
  idempotencyKey: text("idempotency_key").notNull().unique(),
  status: text("status", { enum: ["pending", "completed", "completed_with_warnings", "failed"] }).notNull().default("pending"),
  reportJson: text("report_json").notNull(),
  importedAt: text("imported_at"),
  ...timestamps,
});

export const auditLogs = kompetensportalen.table("audit_logs", {
  id: text("id").primaryKey(),
  actorUserId: text("actor_user_id").references(() => users.id),
  targetType: text("target_type").notNull(),
  targetId: text("target_id"),
  action: text("action").notNull(),
  beforeJson: text("before_json"),
  afterJson: text("after_json"),
  ipHash: text("ip_hash"),
  userAgent: text("user_agent"),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP::text`),
});

export const systemSettings = kompetensportalen.table("system_settings", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
  ...timestamps,
});
