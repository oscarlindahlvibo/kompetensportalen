import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { validateOdooImport } from "../lib/odoo-import.ts";

const inputPath = process.argv[2];
const apply = process.argv.includes("--apply");
if (!inputPath) {
  console.error(
    "Usage: node scripts/import-odoo-course.mjs <course-export.json> [--apply]",
  );
  process.exit(1);
}

const raw = await readFile(inputPath, "utf8");
const payload = JSON.parse(raw);
const idempotencyKey = createHash("sha256")
  .update(JSON.stringify(payload))
  .digest("hex");

const report = {
  idempotencyKey,
  importedChapters: payload.chapters?.length ?? 0,
  importedLessons:
    payload.chapters?.flatMap((chapter) => chapter.lessons ?? []).length ?? 0,
  importedQuestions: payload.questions?.length ?? 0,
  importedAnswers:
    payload.questions?.flatMap((question) => question.answers ?? []).length ??
    0,
  importedQuizzes:
    payload.chapters?.flatMap((chapter) => chapter.lessons ?? []).filter((lesson) => lesson.quiz).length ?? 0,
  importedQuizQuestions:
    payload.chapters?.flatMap((chapter) => chapter.lessons ?? []).reduce((count, lesson) => count + (lesson.quiz?.questionIndexes?.length ?? 0), 0) ?? 0,
  missingImages: [],
  missingVideos: [],
  importedGoverningDocuments: payload.governingDocuments?.length ?? 0,
  importedExamConfig: Boolean(payload.version?.exam),
  skippedExistingVersion: false,
  warnings: [],
  errors: [],
};
const validation = validateOdooImport(payload);
report.missingImages = validation.missingImages;
report.missingVideos = validation.missingVideos;
report.warnings = validation.warnings;
report.errors = validation.errors;

if (apply) {
  const endpoint = process.env.KP_IMPORT_ENDPOINT;
  if (!endpoint) {
    report.errors.push("KP_IMPORT_ENDPOINT saknas för --apply");
  } else {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(process.env.KP_IMPORT_USER_EMAIL
          ? { "oai-authenticated-user-email": process.env.KP_IMPORT_USER_EMAIL }
          : {}),
      },
      body: JSON.stringify(payload),
    });
    const result = await response
      .json()
      .catch(() => ({ error: "invalid_server_response" }));
    console.log(JSON.stringify(result, null, 2));
    if (!response.ok) process.exit(1);
    process.exit(0);
  }
}

console.log(JSON.stringify(report, null, 2));
if (report.errors.length) process.exit(1);
