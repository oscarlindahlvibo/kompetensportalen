export type EnrollmentStatus = "not_started" | "in_progress" | "completed" | "expired";
export type Id06Status = "not_ready" | "ready_for_id06" | "submitted" | "registered" | "failed";

export type Course = {
  id: string;
  slug: string;
  name: string;
  category: string;
  status: "draft" | "coming_soon" | "published" | "archived";
  priceSek: number;
  validityMonths: number;
  estimatedMinutes: number;
  competenceCode: string;
  tags: string[];
};

export type Lesson = {
  id: string;
  title: string;
  type: "article" | "video" | "quiz" | "exam" | "mixed";
  minutes: number;
};

export type Chapter = {
  id: string;
  title: string;
  lessons: Lesson[];
};

export type CourseVersion = {
  id: string;
  courseId: string;
  version: string;
  status: "draft" | "published" | "retired";
  publishedAt: string;
  chapters: Chapter[];
  governingDocuments: string[];
};

export type Enrollment = {
  id: string;
  userId: string;
  courseId: string;
  courseVersionId: string;
  status: EnrollmentStatus;
  progressPercent: number;
  completedLessonIds: string[];
  purchasedAt: string;
  validFrom?: string;
  validUntil?: string;
  certificateId?: string;
};

export type ExamAttempt = {
  id: string;
  enrollmentId: string;
  courseVersionId: string;
  attemptNumber: number;
  startedAt: string;
  finishedAt: string;
  questionIds: string[];
  selectedAnswers: Record<string, string[]>;
  scorePercent: number;
  passed: boolean;
};

export type Certificate = {
  id: string;
  enrollmentId: string;
  userId: string;
  courseId: string;
  courseVersionId: string;
  certificateNumber: string;
  verificationCode: string;
  issuedAt: string;
  validUntil: string;
  status: "issued" | "revoked" | "expired";
};

export type Id06Registration = {
  id: string;
  enrollmentId: string;
  certificateId: string;
  competenceCode: string;
  competenceName: string;
  status: Id06Status;
  educationDate: string;
  validUntil: string;
};

export type CourseLicensePool = {
  companyId: string;
  courseId: string;
  purchased: number;
  assigned: number;
  available: number;
};

export const demoCourses: Course[] = [
  {
    id: "course_apv_113",
    slug: "arbete-pa-vag-apv-1-1-1-3",
    name: "Arbete på väg - APV 1.1-1.3",
    category: "Infrastruktur",
    status: "published",
    priceSek: 2490,
    validityMonths: 60,
    estimatedMinutes: 420,
    competenceCode: "APV-1.1-1.3",
    tags: ["Populär", "Online", "ID06"],
  },
  {
    id: "course_fallskydd",
    slug: "fallskydd-grund",
    name: "Fallskydd - grund",
    category: "Arbetsmiljö",
    status: "coming_soon",
    priceSek: 1890,
    validityMonths: 36,
    estimatedMinutes: 180,
    competenceCode: "FALL-GRUND",
    tags: ["Coming soon"],
  },
  {
    id: "course_sakra_lyft",
    slug: "sakra-lyft",
    name: "Säkra lyft",
    category: "Industri",
    status: "coming_soon",
    priceSek: 1690,
    validityMonths: 60,
    estimatedMinutes: 210,
    competenceCode: "LYFT-GRUND",
    tags: ["Coming soon"],
  },
];

export const apvVersion: CourseVersion = {
  id: "cv_apv_1_0",
  courseId: "course_apv_113",
  version: "1.0",
  status: "published",
  publishedAt: "2026-08-13",
  governingDocuments: ["gov_apv_placeholder"],
  chapters: [
    {
      id: "ch_intro",
      title: "Introduktion och ansvar",
      lessons: [
        { id: "ls_intro", title: "Introduktion", type: "video", minutes: 12 },
        { id: "ls_roles", title: "Roller, ansvar och dokumentation", type: "article", minutes: 28 },
        { id: "ls_intro_quiz", title: "Quiz - introduktion", type: "quiz", minutes: 8 },
      ],
    },
    {
      id: "ch_risk",
      title: "Risker, skyddszoner och arbetsmiljö",
      lessons: [
        { id: "ls_risk", title: "Riskbedömning före arbete", type: "mixed", minutes: 35 },
        { id: "ls_zones", title: "Skyddszoner och trafikmiljö", type: "video", minutes: 42 },
        { id: "ls_tma", title: "TMA och praktiska skydd", type: "article", minutes: 30 },
        { id: "ls_risk_quiz", title: "Quiz - risker", type: "quiz", minutes: 10 },
      ],
    },
    {
      id: "ch_exam",
      title: "Slutprov och certifiering",
      lessons: [
        { id: "ls_exam_prep", title: "Sammanfattning inför prov", type: "article", minutes: 20 },
        { id: "ls_final_exam", title: "Slutprov", type: "exam", minutes: 45 },
      ],
    },
  ],
};

export const questionBank = [
  { id: "q_risk_1", topic: "Riskbedömning", difficulty: "medium", correct: ["a"], points: 1 },
  { id: "q_risk_2", topic: "Riskbedömning", difficulty: "medium", correct: ["b"], points: 1 },
  { id: "q_work_1", topic: "Arbetsmiljö", difficulty: "easy", correct: ["a"], points: 1 },
  { id: "q_sign_1", topic: "Utmärkning", difficulty: "medium", correct: ["c"], points: 1 },
  { id: "q_tma_1", topic: "TMA", difficulty: "hard", correct: ["b"], points: 1 },
] as const;

export function createEnrollment(params: {
  userId: string;
  course: Course;
  version: CourseVersion;
  purchasedAt: string;
  previousEnrollmentIds?: string[];
}): Enrollment {
  const sequence = (params.previousEnrollmentIds?.length ?? 0) + 1;
  return {
    id: `enr_${params.userId}_${params.course.id}_${sequence}`,
    userId: params.userId,
    courseId: params.course.id,
    courseVersionId: params.version.id,
    status: "not_started",
    progressPercent: 0,
    completedLessonIds: [],
    purchasedAt: params.purchasedAt,
  };
}

export function completeLesson(enrollment: Enrollment, version: CourseVersion, lessonId: string): Enrollment {
  const allLessons = version.chapters.flatMap((chapter) => chapter.lessons);
  if (!allLessons.some((lesson) => lesson.id === lessonId)) {
    throw new Error(`Lesson ${lessonId} does not belong to version ${version.id}`);
  }
  const completedLessonIds = Array.from(new Set([...enrollment.completedLessonIds, lessonId]));
  const progressPercent = Math.round((completedLessonIds.length / allLessons.length) * 100);
  return {
    ...enrollment,
    status: progressPercent === 100 ? "completed" : "in_progress",
    progressPercent,
    completedLessonIds,
  };
}

export function gradeExam(params: {
  enrollment: Enrollment;
  version: CourseVersion;
  selectedAnswers: Record<string, string[]>;
  attemptNumber: number;
  now: string;
  passPercent?: number;
}): ExamAttempt {
  const questions = questionBank.slice(0, 5);
  const maxPoints = questions.reduce((sum, question) => sum + question.points, 0);
  const awarded = questions.reduce((sum, question) => {
    const selected = [...(params.selectedAnswers[question.id] ?? [])].sort().join(",");
    const correct = [...question.correct].sort().join(",");
    return sum + (selected === correct ? question.points : 0);
  }, 0);
  const scorePercent = Math.round((awarded / maxPoints) * 100);
  return {
    id: `exam_${params.enrollment.id}_${params.attemptNumber}`,
    enrollmentId: params.enrollment.id,
    courseVersionId: params.version.id,
    attemptNumber: params.attemptNumber,
    startedAt: params.now,
    finishedAt: params.now,
    questionIds: questions.map((question) => question.id),
    selectedAnswers: params.selectedAnswers,
    scorePercent,
    passed: scorePercent >= (params.passPercent ?? 80),
  };
}

export function issueCertificate(params: {
  enrollment: Enrollment;
  course: Course;
  version: CourseVersion;
  examAttempt: ExamAttempt;
  identityVerified: boolean;
  issuedAt: string;
}): { enrollment: Enrollment; certificate: Certificate; id06: Id06Registration } {
  if (!params.examAttempt.passed) throw new Error("Cannot issue certificate before passed exam");
  if (!params.identityVerified) throw new Error("Cannot issue certificate before identity verification");

  const validUntil = addMonths(params.issuedAt, params.course.validityMonths);
  const certificate: Certificate = {
    id: `cert_${params.enrollment.id}`,
    enrollmentId: params.enrollment.id,
    userId: params.enrollment.userId,
    courseId: params.course.id,
    courseVersionId: params.version.id,
    certificateNumber: `KP-${params.issuedAt.slice(0, 4)}-${params.enrollment.id.slice(-6).toUpperCase()}`,
    verificationCode: `KP${Math.abs(hashCode(params.enrollment.id + params.issuedAt)).toString(36).toUpperCase()}`,
    issuedAt: params.issuedAt,
    validUntil,
    status: "issued",
  };

  return {
    enrollment: {
      ...params.enrollment,
      status: "completed",
      progressPercent: 100,
      validFrom: params.issuedAt,
      validUntil,
      certificateId: certificate.id,
    },
    certificate,
    id06: {
      id: `id06_${certificate.id}`,
      enrollmentId: params.enrollment.id,
      certificateId: certificate.id,
      competenceCode: params.course.competenceCode,
      competenceName: params.course.name,
      status: "ready_for_id06",
      educationDate: params.issuedAt,
      validUntil,
    },
  };
}

export function createLicensePool(companyId: string, courseId: string, quantity: number): CourseLicensePool {
  return { companyId, courseId, purchased: quantity, assigned: 0, available: quantity };
}

export function assignLicense(pool: CourseLicensePool): CourseLicensePool {
  if (pool.available <= 0) throw new Error("No available licenses");
  return { ...pool, assigned: pool.assigned + 1, available: pool.available - 1 };
}

export function applyVolumeDiscount(quantity: number, unitPriceSek: number): { discountPercent: number; unitPriceSek: number; label: string } {
  if (quantity >= 20) return { discountPercent: 35, unitPriceSek: Math.round(unitPriceSek * 0.65), label: "20+ företagspris" };
  if (quantity >= 10) return { discountPercent: 30, unitPriceSek: Math.round(unitPriceSek * 0.7), label: "10-19 platser" };
  if (quantity >= 3) return { discountPercent: 20, unitPriceSek: Math.round(unitPriceSek * 0.8), label: "3-9 platser" };
  return { discountPercent: 0, unitPriceSek, label: "Ordinarie pris" };
}

export function expiringCompetenceReminders(validUntil: string, today: string, windows = [90, 60, 30, 7]): number[] {
  const daysLeft = Math.ceil((Date.parse(validUntil) - Date.parse(today)) / 86_400_000);
  return windows.filter((window) => daysLeft === window);
}

function addMonths(dateIso: string, months: number): string {
  const date = new Date(`${dateIso}T00:00:00.000Z`);
  date.setUTCMonth(date.getUTCMonth() + months);
  return date.toISOString().slice(0, 10);
}

function hashCode(value: string): number {
  return value.split("").reduce((hash, char) => ((hash << 5) - hash + char.charCodeAt(0)) | 0, 0);
}

export const demoScenario = (() => {
  const course = demoCourses[0];
  const oldEnrollment: Enrollment = {
    id: "enr_old_2026",
    userId: "user_anna",
    courseId: course.id,
    courseVersionId: apvVersion.id,
    status: "completed",
    progressPercent: 100,
    completedLessonIds: apvVersion.chapters.flatMap((chapter) => chapter.lessons.map((lesson) => lesson.id)),
    purchasedAt: "2026-08-13",
    validFrom: "2026-08-15",
    validUntil: "2031-08-15",
    certificateId: "cert_old_2026",
  };
  const renewal = createEnrollment({
    userId: "user_anna",
    course,
    version: apvVersion,
    purchasedAt: "2031-07-10",
    previousEnrollmentIds: [oldEnrollment.id],
  });
  const pool = Array.from({ length: 13 }).reduce<CourseLicensePool>((current) => assignLicense(current), createLicensePool("company_wpe_demo", course.id, 20));
  return { course, version: apvVersion, oldEnrollment, renewal, pool };
})();
