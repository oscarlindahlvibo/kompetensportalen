import type { NormalizedImport } from "@/lib/odoo-import";

export function parseCsv(value: string) {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let index = 0; index < value.length; index += 1) {
    const character = value[index];
    const next = value[index + 1];
    if (quoted) {
      if (character === '"' && next === '"') {
        cell += '"';
        index += 1;
      } else if (character === '"') quoted = false;
      else cell += character;
    } else if (character === '"' && cell.length === 0) quoted = true;
    else if (character === ",") {
      row.push(cell);
      cell = "";
    } else if (character === "\n" || character === "\r") {
      if (character === "\r" && next === "\n") index += 1;
      row.push(cell);
      if (row.some((item) => item.length > 0)) rows.push(row);
      row = [];
      cell = "";
    } else cell += character;
  }
  if (cell.length || row.length) {
    row.push(cell);
    if (row.some((item) => item.length > 0)) rows.push(row);
  }
  const headers = (rows.shift() ?? []).map((header) => header.trim().replace(/^\uFEFF/, ""));
  return rows.map((values) => Object.fromEntries(headers.map((header, index) => [header, (values[index] ?? "").trim()])));
}

export function normalizeOdooCsvBundle(files: Record<string, string>): NormalizedImport {
  const course = first(files, "course.csv");
  const version = first(files, "version.csv");
  if (!course?.name || !version?.version) throw new Error("course.csv kräver name och version.csv kräver version");
  const chapters = parseCsv(files["chapters.csv"] ?? "").map((row, index) => ({
    id: row.id || `chapter-${index + 1}`,
    title: row.title,
    description: row.description || undefined,
    sortOrder: number(row.sortOrder, index),
    lessons: [] as NonNullable<NormalizedImport["chapters"]>[number]["lessons"],
  }));
  const chapterById = new Map(chapters.map((chapter) => [chapter.id, chapter]));
  for (const [index, row] of parseCsv(files["lessons.csv"] ?? "").entries()) {
    const chapter = chapterById.get(row.chapterId) ?? chapters[number(row.chapterIndex, 0)];
    if (!chapter) continue;
    chapter.lessons?.push({
      title: row.title,
      type: (row.type || "article") as NonNullable<NonNullable<NormalizedImport["chapters"]>[number]["lessons"]>[number]["type"],
      body: parseBody(row.body),
      required: bool(row.required, true),
      assetRef: row.assetRef || undefined,
      quiz: row.quizTitle || row.questionIndexes ? {
        title: row.quizTitle || undefined,
        feedbackMode: (row.feedbackMode || "immediate") as "immediate" | "after_submit" | "none",
        passPercent: row.passPercent ? number(row.passPercent, 80) : null,
        questionIndexes: indexes(row.questionIndexes),
      } : undefined,
    });
    void index;
  }
  const questionRows = parseCsv(files["questions.csv"] ?? "");
  const answerRows = parseCsv(files["answers.csv"] ?? "");
  const answersByQuestion = new Map<string, Record<string, string>[]>();
  for (const answer of answerRows) {
    const list = answersByQuestion.get(answer.questionId) ?? [];
    list.push(answer);
    answersByQuestion.set(answer.questionId, list);
  }
  const questions = questionRows.map((row) => ({
    prompt: row.prompt,
    topic: row.topic,
    difficulty: (row.difficulty || "medium") as "easy" | "medium" | "hard",
    chapterIndex: row.chapterId ? chapters.findIndex((chapter) => chapter.id === row.chapterId) : undefined,
    type: (row.type || "single") as "single" | "multiple" | "true_false" | "image",
    explanation: row.explanation || undefined,
    points: number(row.points, 1),
    imageUrl: row.imageUrl || undefined,
    answers: (answersByQuestion.get(row.id) ?? []).map((answer) => ({ label: answer.label, isCorrect: bool(answer.isCorrect, false) })),
  }));
  const exam = version.questionCount ? {
    questionCount: number(version.questionCount, 30),
    passPercent: number(version.passPercent, 80),
    timeLimitSeconds: version.timeLimitSeconds ? number(version.timeLimitSeconds, 3600) : null,
    maxAttempts: number(version.maxAttempts, 3),
    cooldownSeconds: number(version.cooldownSeconds, 0),
    randomizeQuestions: bool(version.randomizeQuestions, true),
    randomizeAnswers: bool(version.randomizeAnswers, true),
    topicRules: (version.topicRules || "").split("|").filter(Boolean).map((rule) => { const [topic, count] = rule.split(":"); return { topic, count: number(count, 0) }; }),
  } : undefined;
  return {
    course: {
      name: course.name,
      slug: course.slug || undefined,
      shortDescription: course.shortDescription || undefined,
      fullDescription: course.fullDescription || undefined,
      category: course.category || undefined,
      imageUrl: course.imageUrl || undefined,
      bannerUrl: course.bannerUrl || undefined,
      tags: split(course.tags),
      basePriceSek: number(course.basePriceSek, 0),
      vatRate: number(course.vatRate, 0.25),
      validityMonths: course.validityMonths ? number(course.validityMonths, 0) : null,
      estimatedMinutes: number(course.estimatedMinutes, 0),
      targetAudience: course.targetAudience || undefined,
      prerequisites: course.prerequisites || undefined,
      regulatoryFramework: course.regulatoryFramework || undefined,
      competenceCode: course.competenceCode || undefined,
      requiresIdentityVerification: bool(course.requiresIdentityVerification, false),
      id06Enabled: bool(course.id06Enabled, false),
      seoTitle: course.seoTitle || undefined,
      seoDescription: course.seoDescription || undefined,
    },
    version: { version: version.version, changelog: version.changelog || undefined, exam },
    chapters: chapters.map((chapter) => ({ title: chapter.title, description: chapter.description, lessons: chapter.lessons })),
    questions,
    governingDocuments: parseCsv(files["governing_documents.csv"] ?? "").map((row) => ({ title: row.title, documentNumber: row.documentNumber, version: row.version, publishedAt: row.publishedAt, url: row.url, lastCheckedAt: row.lastCheckedAt, notes: row.notes })),
  };
}

function first(files: Record<string, string>, name: string) { return parseCsv(files[name] ?? "")[0]; }
function number(value: string | undefined, fallback: number) { const parsed = Number(value); return Number.isFinite(parsed) ? parsed : fallback; }
function bool(value: string | undefined, fallback: boolean) { if (!value) return fallback; return ["1", "true", "yes", "ja"].includes(value.toLowerCase()); }
function split(value: string | undefined) { return (value ?? "").split("|").map((item) => item.trim()).filter(Boolean); }
function indexes(value: string | undefined) { return split(value?.replaceAll(",", "|")).map((item) => number(item, -1)).filter((item) => item >= 0); }
function parseBody(value: string | undefined) { if (!value) return {}; try { return JSON.parse(value); } catch { return { text: value }; } }
