import { desc } from "drizzle-orm";
import { requireChatGPTUser } from "@/app/chatgpt-auth";
import { PageShell } from "@/app/components/site-chrome";
import { getDb } from "@/db";
import { answerOptions, courses, questions } from "@/db/schema";
import { ensureDbUser, requirePermission } from "@/lib/server-auth";
import QuestionManager from "@/app/admin/fragor/question-manager";

export const dynamic = "force-dynamic";

export default async function QuestionBankPage() {
  const identity = await requireChatGPTUser("/admin/fragor");
  const db = getDb();
  const actor = await ensureDbUser(db, identity);
  requirePermission(actor.role, "course:read");
  const [rows, courseRows, answerRows] = await Promise.all([db.select().from(questions).orderBy(desc(questions.createdAt)), db.select({ id: courses.id, name: courses.name }).from(courses).orderBy(courses.name), db.select().from(answerOptions)]);
  const answersByQuestion = new Map<string, { label: string; isCorrect: boolean }[]>();
  for (const answer of answerRows) answersByQuestion.set(answer.questionId, [...(answersByQuestion.get(answer.questionId) ?? []), { label: answer.label, isCorrect: answer.isCorrect }]);
  return <PageShell><section className="subpage-hero admin-hero"><p className="eyebrow">Administration · Frågebank</p><h1>Frågor som<br />håller.</h1><p>Frågor är versionsoberoende i banken men snapshotas på varje slutprov.</p></section><section className="section admin-table-section"><div className="section-heading"><div><p className="eyebrow">Frågebank</p><h2>Skapa och hantera</h2></div><a className="text-link" href="/admin/kurser">Till kursbyggaren <span>→</span></a></div><QuestionManager initialCourses={courseRows} initialQuestions={rows.map((row) => ({ id: row.id, courseId: row.courseId, prompt: row.prompt, topic: row.topic, type: row.type, difficulty: row.difficulty, points: row.points, active: row.active, imageUrl: row.imageUrl, explanation: row.explanation, answers: answersByQuestion.get(row.id) ?? [] }))} /></section></PageShell>;
}
