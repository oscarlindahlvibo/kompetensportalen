export type PlatformRole =
  | "super_admin"
  | "course_admin"
  | "certification_admin"
  | "customer_support"
  | "company_admin"
  | "participant";
export type Id06State =
  "not_ready" | "ready_for_id06" | "submitted" | "registered" | "failed";

const rolePermissions: Record<PlatformRole, string[]> = {
  super_admin: ["*", "privacy:read", "privacy:write"],
  course_admin: [
    "course:read",
    "course:write",
    "question:write",
    "migration:write",
    "communication:write",
  ],
  certification_admin: [
    "certification:read",
    "certification:write",
    "id06:read",
    "id06:write",
    "participant:read",
    "support:read",
    "communication:write",
  ],
  customer_support: ["order:read", "participant:read", "company:read", "support:read", "support:write"],
  company_admin: [
    "company:read",
    "company:write",
    "license:write",
    "participant:read",
  ],
  participant: [
    "enrollment:read",
    "enrollment:write_own",
    "certificate:read_own",
  ],
};

export function hasPermission(role: PlatformRole, permission: string): boolean {
  return (
    rolePermissions[role]?.includes("*") ||
    rolePermissions[role]?.includes(permission) ||
    false
  );
}

export function canChangeSuperAdminRole(
  targetRole: PlatformRole,
  nextRole: PlatformRole,
  activeSuperAdminCount: number,
) {
  return !(
    targetRole === "super_admin" &&
    nextRole !== "super_admin" &&
    activeSuperAdminCount <= 1
  );
}

export function isAdministrativeRole(role: PlatformRole) {
  return ["super_admin", "course_admin", "certification_admin", "customer_support"].includes(role);
}

export function enrollmentIsAccessible(
  enrollment: {
    status: string;
    validFrom: string | null;
    validUntil: string | null;
  },
  now = new Date(),
) {
  if (enrollment.status === "cancelled" || enrollment.status === "expired")
    return false;
  const today = now.toISOString().slice(0, 10);
  return (
    (!enrollment.validFrom || enrollment.validFrom <= today) &&
    (!enrollment.validUntil || enrollment.validUntil >= today)
  );
}

export function enrollmentDisplayState(
  enrollment: { status: string; validUntil: string | null },
  now = new Date(),
) {
  if (
    enrollment.status === "cancelled" ||
    enrollment.status === "expired" ||
    (enrollment.validUntil &&
      enrollment.validUntil < now.toISOString().slice(0, 10))
  )
    return "expired" as const;
  if (enrollment.status === "completed") return "completed" as const;
  if (enrollment.validUntil) {
    const days = Math.ceil(
      (Date.parse(`${enrollment.validUntil}T00:00:00Z`) -
        Date.parse(`${now.toISOString().slice(0, 10)}T00:00:00Z`)) /
        86400000,
    );
    if (days <= 90) return "expiring" as const;
  }
  return enrollment.status === "not_started"
    ? ("not_started" as const)
    : ("in_progress" as const);
}

export function competencyIsValid(
  competency: { status: string; validUntil: string | null },
  now = new Date(),
) {
  return (
    competency.status !== "revoked" &&
    competency.status !== "expired" &&
    (!competency.validUntil ||
      competency.validUntil >= now.toISOString().slice(0, 10))
  );
}

export function competencyIsExpiring(
  competency: { status: string; validUntil: string | null },
  now = new Date(),
  days = 90,
) {
  if (!competencyIsValid(competency, now) || !competency.validUntil)
    return false;
  const today = Date.parse(`${now.toISOString().slice(0, 10)}T00:00:00Z`);
  const expiry = Date.parse(`${competency.validUntil}T00:00:00Z`);
  return expiry >= today && expiry <= today + days * 86400000;
}

export function hasCompletedRequiredLessons(
  requiredLessonIds: string[],
  completedLessonIds: Iterable<string>,
) {
  const completed = new Set(completedLessonIds);
  return requiredLessonIds.every((lessonId) => completed.has(lessonId));
}

export function calculateProgressPercent(totalLessons: number, completedLessons: number) {
  if (!Number.isInteger(totalLessons) || totalLessons <= 0) return 0;
  if (!Number.isInteger(completedLessons) || completedLessons <= 0) return 0;
  return Math.min(100, Math.round((completedLessons / totalLessons) * 100));
}

export function canManuallyCompleteLesson(type: string) {
  return type !== "quiz" && type !== "exam";
}

export function nextLessonProgressStatus(
  current: "started" | "completed" | null,
  requested: "started" | "completed",
) {
  return current === "completed" ? "completed" as const : requested;
}

export function questionBelongsToCourseVersion(
  chapterId: string | null,
  versionChapterIds: Iterable<string>,
) {
  if (chapterId === null) return true;
  for (const versionChapterId of versionChapterIds)
    if (versionChapterId === chapterId) return true;
  return false;
}

export function identityDataIsReadyForId06(
  profile: { personalIdentityEncrypted: string | null } | null | undefined,
) {
  return Boolean(profile?.personalIdentityEncrypted);
}

export function courseNeedsIdentityVerification(course: {
  requiresIdentityVerification: boolean;
  id06Enabled: boolean;
}) {
  return course.requiresIdentityVerification || course.id06Enabled;
}

export function assertId06Transition(
  current: Id06State,
  next: Id06State,
): void {
  const allowed: Record<Id06State, Id06State[]> = {
    not_ready: ["ready_for_id06", "failed"],
    ready_for_id06: ["submitted", "failed"],
    submitted: ["registered", "failed"],
    registered: [],
    failed: ["ready_for_id06"],
  };
  if (!allowed[current].includes(next))
    throw new Error(`Invalid ID06 transition: ${current} -> ${next}`);
}

export function calculateOrderTotals(params: {
  unitPriceSek: number;
  quantity: number;
  discountSek?: number;
  vatRate?: number;
}) {
  if (
    !Number.isInteger(params.quantity) ||
    params.quantity < 1 ||
    params.quantity > 10000
  )
    throw new Error("Invalid quantity");
  const subtotalSek = params.unitPriceSek * params.quantity;
  const discountSek = Math.max(
    0,
    Math.min(subtotalSek, params.discountSek ?? 0),
  );
  const netSek = subtotalSek - discountSek;
  const vatSek = Math.round(netSek * (params.vatRate ?? 0.25));
  return { subtotalSek, discountSek, vatSek, totalSek: netSek + vatSek };
}

export function calculateCartTotals(
  lines: Array<{
    unitPriceSek: number;
    quantity: number;
    automaticDiscountSek?: number;
    vatRate: number;
  }>,
  requestedCodeDiscountSek = 0,
) {
  const subtotalSek = lines.reduce(
    (total, line) => total + line.unitPriceSek * line.quantity,
    0,
  );
  const automaticDiscountSek = lines.reduce(
    (total, line) =>
      total + Math.max(0, Math.min(line.unitPriceSek * line.quantity, line.automaticDiscountSek ?? 0)),
    0,
  );
  const netBeforeCodeDiscountSek = lines.reduce(
    (total, line) =>
      total +
      Math.max(
        0,
        line.unitPriceSek * line.quantity -
          Math.max(0, Math.min(line.unitPriceSek * line.quantity, line.automaticDiscountSek ?? 0)),
      ),
    0,
  );
  const codeDiscountSek = Math.max(
    0,
    Math.min(netBeforeCodeDiscountSek, requestedCodeDiscountSek),
  );
  let vatSek = 0;
  for (const line of lines) {
    const grossSek = line.unitPriceSek * line.quantity;
    const automaticLineDiscountSek = Math.max(
      0,
      Math.min(grossSek, line.automaticDiscountSek ?? 0),
    );
    const netLineBeforeCodeSek = Math.max(0, grossSek - automaticLineDiscountSek);
    const codeLineDiscountSek = netBeforeCodeDiscountSek
      ? (codeDiscountSek * netLineBeforeCodeSek) / netBeforeCodeDiscountSek
      : 0;
    vatSek += Math.round(
      Math.max(0, netLineBeforeCodeSek - codeLineDiscountSek) * line.vatRate,
    );
  }
  const discountSek = automaticDiscountSek + codeDiscountSek;
  return {
    subtotalSek,
    discountSek,
    vatSek,
    totalSek: subtotalSek - discountSek + vatSek,
  };
}

export function allocateCartDiscounts(
  lines: Array<{ unitPriceSek: number; quantity: number; automaticDiscountSek?: number }>,
  requestedCodeDiscountSek = 0,
) {
  const netBeforeCodeDiscountSek = lines.reduce(
    (total, line) => total + Math.max(0, line.unitPriceSek * line.quantity - Math.max(0, Math.min(line.unitPriceSek * line.quantity, line.automaticDiscountSek ?? 0))),
    0,
  );
  const appliedCodeDiscountSek = Math.max(0, Math.min(netBeforeCodeDiscountSek, requestedCodeDiscountSek));
  let remainingCodeDiscountSek = appliedCodeDiscountSek;
  return lines.map((line, index) => {
    const grossSek = line.unitPriceSek * line.quantity;
    const automaticLineDiscountSek = Math.max(0, Math.min(grossSek, line.automaticDiscountSek ?? 0));
    const netLineSek = Math.max(0, grossSek - automaticLineDiscountSek);
    const codeLineDiscountSek = index === lines.length - 1
      ? remainingCodeDiscountSek
      : netBeforeCodeDiscountSek
        ? Math.min(remainingCodeDiscountSek, Math.round(appliedCodeDiscountSek * netLineSek / netBeforeCodeDiscountSek))
        : 0;
    remainingCodeDiscountSek -= codeLineDiscountSek;
    return automaticLineDiscountSek + codeLineDiscountSek;
  });
}

export function effectiveCoursePrice(
  course: { campaignPriceSek: number | null; basePriceSek: number },
  productPriceSek: number,
) {
  return course.campaignPriceSek !== null && course.campaignPriceSek >= 0
    ? course.campaignPriceSek
    : productPriceSek || course.basePriceSek;
}

export function parseCourseIds(value: string | null | undefined): string[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed)
      ? parsed.filter((courseId): courseId is string => typeof courseId === "string" && courseId.trim().length > 0)
      : [];
  } catch {
    return [];
  }
}

export function publicCertificateView(certificate: {
  verificationCode: string;
  certificateNumber: string;
  courseName: string;
  issuedAt: string;
  validUntil: string | null;
  status: string;
}) {
  const today = new Date().toISOString().slice(0, 10);
  return {
    verificationCode: certificate.verificationCode,
    certificateNumber: certificate.certificateNumber,
    course: certificate.courseName,
    issuedAt: certificate.issuedAt,
    validUntil: certificate.validUntil,
    status: certificate.status,
    valid:
      certificate.status === "issued" &&
      (!certificate.validUntil ||
        certificate.validUntil.slice(0, 10) >= today),
  };
}

export function publicExamSnapshot<T extends { correctOptionIds?: unknown }>(
  snapshot: T[],
): Omit<T, "correctOptionIds">[] {
  return snapshot.map((question) => {
    const publicQuestion = { ...question } as T & { correctOptionIds?: unknown };
    delete publicQuestion.correctOptionIds;
    return publicQuestion as Omit<T, "correctOptionIds">;
  });
}
