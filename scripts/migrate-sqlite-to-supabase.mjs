import { DatabaseSync } from "node:sqlite";
import postgres from "postgres";

const sqlitePath = process.argv[2] ?? "./legacy.sqlite";
const connectionString = process.env.SUPABASE_DB_URL ?? process.env.DATABASE_URL;
if (!connectionString || connectionString.startsWith("file:")) throw new Error("Set SUPABASE_DB_URL to a PostgreSQL connection string.");

const tables = [
  "users", "profiles", "companies", "company_members", "courses", "course_versions", "chapters", "lessons", "products", "orders", "order_items", "payments", "course_licenses", "enrollments", "lesson_progress", "quizzes", "questions", "answer_options", "quiz_questions", "quiz_attempts", "exam_configs", "exam_attempts", "exam_answers", "identity_verifications", "certificates", "competencies", "id06_registrations", "discount_codes", "price_rules", "governing_documents", "course_version_governing_documents", "quality_reviews", "notifications", "email_templates", "course_interest", "contact_messages", "consents", "odoo_imports", "audit_logs", "system_settings",
];
const booleanColumns = new Set(["invoice_purchase_enabled", "activate_invoice_licenses_immediately", "requires_identity_verification", "id06_enabled", "randomize_questions", "randomize_answers", "required", "active", "is_correct", "passed", "correct", "content_reviewed", "exam_reviewed", "certificate_reviewed", "id06_code_verified", "publication_approved"]);
const sqlite = new DatabaseSync(sqlitePath, { readOnly: true });
const sql = postgres(connectionString, { max: 4, prepare: false });
const report = [];

try {
  await sql.begin(async (transaction) => {
    for (const table of tables) {
      const rows = sqlite.prepare(`select * from "${table}"`).all();
      let imported = 0;
      for (const row of rows) {
        const columns = Object.keys(row);
        const values = columns.map((column) => booleanColumns.has(column) ? Boolean(row[column]) : row[column]);
        const quotedColumns = columns.map((column) => `"${column}"`).join(", ");
        const placeholders = columns.map((_, index) => `$${index + 1}`).join(", ");
        const key = columns.includes("id") ? "id" : "key";
        const updates = columns.filter((column) => column !== key).map((column) => `"${column}" = excluded."${column}"`).join(", ");
        await transaction.unsafe(`insert into kompetensportalen."${table}" (${quotedColumns}) values (${placeholders}) on conflict ("${key}") do update set ${updates}`, values);
        imported += 1;
      }
      report.push({ table, imported });
    }
  });
} finally {
  sqlite.close();
  await sql.end({ timeout: 5 });
}

console.log(JSON.stringify({ sqlitePath, tables: report, totalRows: report.reduce((sum, item) => sum + item.imported, 0) }, null, 2));
