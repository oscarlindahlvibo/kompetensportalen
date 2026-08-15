export type ImportAnswer = { label?: string; isCorrect?: boolean };
export type ImportLesson = {
  title?: string;
  type?: "article" | "video" | "image" | "document" | "quiz" | "exam" | "mixed";
  body?: unknown;
  required?: boolean;
  assetRef?: string;
  quiz?: {
    title?: string;
    feedbackMode?: "immediate" | "after_submit" | "none";
    passPercent?: number | null;
    questionIndexes?: number[];
  };
};
export type ImportChapter = {
  title?: string;
  description?: string;
  lessons?: ImportLesson[];
};
export type ImportQuestion = {
  prompt?: string;
  topic?: string;
  difficulty?: "easy" | "medium" | "hard";
  chapterIndex?: number;
  type?: "single" | "multiple" | "true_false" | "image";
  explanation?: string;
  points?: number;
  imageUrl?: string;
  answers?: ImportAnswer[];
};
export type ImportExam = {
  questionCount?: number;
  passPercent?: number;
  timeLimitSeconds?: number | null;
  maxAttempts?: number;
  cooldownSeconds?: number;
  randomizeQuestions?: boolean;
  randomizeAnswers?: boolean;
  topicRules?: { topic?: string; count?: number }[];
};
export type ImportDocument = {
  title?: string;
  documentNumber?: string;
  version?: string;
  publishedAt?: string;
  url?: string;
  lastCheckedAt?: string;
  notes?: string;
};
export type NormalizedImport = {
  course?: {
    name?: string;
    slug?: string;
    shortDescription?: string;
    fullDescription?: string;
    category?: string;
    imageUrl?: string;
    bannerUrl?: string;
    tags?: string[];
    basePriceSek?: number;
    vatRate?: number;
    validityMonths?: number | null;
    estimatedMinutes?: number;
    targetAudience?: string;
    prerequisites?: string;
    regulatoryFramework?: string;
    competenceCode?: string;
    requiresIdentityVerification?: boolean;
    id06Enabled?: boolean;
    seoTitle?: string;
    seoDescription?: string;
  };
  version?: { version?: string; changelog?: string; exam?: ImportExam };
  chapters?: ImportChapter[];
  questions?: ImportQuestion[];
  governingDocuments?: ImportDocument[];
};

export function importPayloadMatchesSnapshot(
  snapshot: string | null | undefined,
  payload: NormalizedImport,
) {
  if (!snapshot) return false;
  try {
    return JSON.stringify(JSON.parse(snapshot)) === JSON.stringify(payload);
  } catch {
    return false;
  }
}

export function validateOdooImport(payload: NormalizedImport) {
  const errors: string[] = [];
  const warnings: string[] = [];
  const missingImages: string[] = [];
  const missingVideos: string[] = [];
  const course = payload.course;
  if (!course?.name?.trim()) errors.push("course.name saknas");
  if (!course?.slug?.trim() && !course?.name?.trim())
    errors.push("course.slug saknas");
  if (!payload.version?.version?.trim()) errors.push("version.version saknas");
  if (
    course?.basePriceSek !== undefined &&
    (!Number.isInteger(course.basePriceSek) || course.basePriceSek < 0)
  )
    errors.push("course.basePriceSek måste vara ett heltal >= 0");
  if (
    course?.vatRate !== undefined &&
    (course.vatRate < 0 || course.vatRate > 1)
  )
    errors.push("course.vatRate måste ligga mellan 0 och 1");
  if (!payload.chapters?.length)
    errors.push("chapters måste innehålla minst ett kapitel");
  else if (!payload.chapters.some((chapter) => (chapter.lessons?.length ?? 0) > 0))
    errors.push("chapters måste innehålla minst en lektion");
  for (const [chapterIndex, chapter] of (payload.chapters ?? []).entries()) {
    if (!chapter.title?.trim())
      warnings.push(`Kapitel ${chapterIndex + 1} saknar titel.`);
    for (const [lessonIndex, lesson] of (chapter.lessons ?? []).entries()) {
      if (!lesson.title?.trim())
        warnings.push(
          `Kapitel ${chapterIndex + 1}, lektion ${lessonIndex + 1} saknar titel.`,
        );
      if (!lesson.type)
        errors.push(
          `Kapitel ${chapterIndex + 1}, lektion ${lessonIndex + 1} saknar typ.`,
        );
      if (
        (lesson.type === "image" || lesson.type === "document") &&
        !lesson.assetRef
      )
        missingImages.push(lesson.title ?? `Lektion ${lessonIndex + 1}`);
      if (lesson.type === "video" && !lesson.assetRef)
        missingVideos.push(lesson.title ?? `Lektion ${lessonIndex + 1}`);
      if (lesson.quiz && !(lesson.quiz.questionIndexes?.length ?? 0))
        errors.push(
          `Kapitel ${chapterIndex + 1}, lektion ${lessonIndex + 1} har ett quiz utan questionIndexes.`,
        );
      for (const questionIndex of lesson.quiz?.questionIndexes ?? [])
        if (!Number.isInteger(questionIndex) || questionIndex < 0 || questionIndex >= (payload.questions?.length ?? 0))
          errors.push(`Kapitel ${chapterIndex + 1}, lektion ${lessonIndex + 1} refererar till ogiltig fråga ${String(questionIndex)}.`);
    }
  }
  for (const [questionIndex, question] of (payload.questions ?? []).entries()) {
    if (!question.prompt?.trim())
      errors.push(`Fråga ${questionIndex + 1} saknar text.`);
    const answers = question.answers ?? [];
    if (answers.length < 2)
      errors.push(`Fråga ${questionIndex + 1} måste ha minst två svar.`);
    if (answers.some((answer) => !answer.label?.trim()))
      errors.push(`Fråga ${questionIndex + 1} har ett tomt svar.`);
    const correct = answers.filter((answer) => answer.isCorrect).length;
    if (question.type === "multiple" ? correct < 1 : correct !== 1)
      errors.push(
        `Fråga ${questionIndex + 1} måste ha ${question.type === "multiple" ? "minst ett" : "exakt ett"} rätt svar.`,
      );
    if (
      question.points !== undefined &&
      (!Number.isInteger(question.points) || question.points < 1)
    )
      errors.push(`Fråga ${questionIndex + 1} har ogiltig poäng.`);
    if (question.chapterIndex !== undefined && (!Number.isInteger(question.chapterIndex) || question.chapterIndex < 0 || question.chapterIndex >= (payload.chapters?.length ?? 0)))
      errors.push(`Fråga ${questionIndex + 1} har ogiltigt chapterIndex.`);
    if (question.type === "image" && !question.imageUrl)
      missingImages.push(`Fråga ${questionIndex + 1}`);
  }
  const exam = payload.version?.exam;
  if (exam) {
    if (!Number.isInteger(exam.questionCount) || (exam.questionCount ?? 0) < 1)
      errors.push("version.exam.questionCount måste vara >= 1");
    if (
      exam.passPercent === undefined ||
      exam.passPercent < 1 ||
      exam.passPercent > 100
    )
      errors.push("version.exam.passPercent måste ligga mellan 1 och 100");
    if (
      exam.maxAttempts !== undefined &&
      (!Number.isInteger(exam.maxAttempts) || exam.maxAttempts < 1)
    )
      errors.push("version.exam.maxAttempts måste vara >= 1");
    if ((exam.questionCount ?? 0) > (payload.questions?.length ?? 0))
      errors.push("Slutprovet begär fler importerade frågor än exporten innehåller.");
    for (const [ruleIndex, rule] of (exam.topicRules ?? []).entries()) {
      if (!rule.topic?.trim() || !Number.isInteger(rule.count) || (rule.count ?? 0) < 1)
        errors.push(`version.exam.topicRules[${ruleIndex}] är ogiltig.`);
    }
    if ((exam.topicRules ?? []).length && (exam.topicRules ?? []).reduce((total, rule) => total + (rule.count ?? 0), 0) !== exam.questionCount)
      errors.push("version.exam.topicRules måste summera till questionCount.");
    for (const rule of exam.topicRules ?? []) {
      const available = (payload.questions ?? []).filter((question) => question.topic?.trim() === rule.topic?.trim()).length;
      if (available < (rule.count ?? 0))
        errors.push(`Slutprovet saknar frågor för ämnet ${rule.topic ?? "(saknas)"}: ${rule.count ?? 0} krävs, ${available} finns.`);
    }
  }
  if (!payload.governingDocuments?.length)
    warnings.push(
      "Inga styrande dokument angavs. Registrera aktuella dokument innan publicering.",
    );
  for (const [documentIndex, document] of (
    payload.governingDocuments ?? []
  ).entries())
    if (!document.title?.trim())
      warnings.push(`Styrande dokument ${documentIndex + 1} saknar titel.`);
  return { errors, warnings, missingImages, missingVideos };
}
