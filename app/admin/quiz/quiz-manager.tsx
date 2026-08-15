"use client";

import { useState } from "react";

type Lesson = { id: string; label: string; courseId: string };
type Question = { id: string; courseId: string; prompt: string; topic: string; difficulty: string };
type ExistingQuiz = { id: string; lessonId: string; title: string; feedbackMode: string; passPercent: number | null; questionIds: string[] };

export default function QuizManager({ lessons, questions, existing }: { lessons: Lesson[]; questions: Question[]; existing: ExistingQuiz[] }) {
  const [lessonId, setLessonId] = useState(lessons[0]?.id ?? "");
  const [title, setTitle] = useState("Kapitelquiz");
  const [feedbackMode, setFeedbackMode] = useState("immediate");
  const [passPercent, setPassPercent] = useState("");
  const [selected, setSelected] = useState<string[]>([]);
  const [dragging, setDragging] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const courseId = lessons.find((lesson) => lesson.id === lessonId)?.courseId;
  const available = questions.filter((question) => question.courseId === courseId);
  async function save(event: React.FormEvent) { event.preventDefault(); setMessage(""); const response = await fetch(editingId ? `/api/admin/quizzes/${editingId}` : "/api/admin/quizzes", { method: editingId ? "PATCH" : "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ lessonId, title, feedbackMode, passPercent: passPercent ? Number(passPercent) : null, questionIds: selected }) }); const data = await response.json() as { error?: string; quizId?: string }; setMessage(response.ok ? `Quizet ${editingId ? "uppdaterades" : "skapades"}.` : data.error ?? "Quizet kunde inte sparas."); }
  function edit(quiz: ExistingQuiz) { setEditingId(quiz.id); setLessonId(quiz.lessonId); setTitle(quiz.title); setFeedbackMode(quiz.feedbackMode); setPassPercent(quiz.passPercent?.toString() ?? ""); setSelected(quiz.questionIds); setMessage(""); }
  function toggle(id: string) { setSelected((current) => current.includes(id) ? current.filter((item) => item !== id) : [...current, id]); }
  function moveQuestion(targetId: string) {
    if (!dragging || dragging === targetId) return;
    setSelected((current) => {
      const next = current.filter((id) => id !== dragging);
      const targetIndex = next.indexOf(targetId);
      next.splice(targetIndex < 0 ? next.length : targetIndex, 0, dragging);
      return next;
    });
    setDragging(null);
  }
  return <section className="section course-admin-section"><form className="admin-form quiz-form" onSubmit={save}><p className="eyebrow">{editingId ? "Redigera quiz" : "Nytt quiz"}</p><h2>Koppla frågor till lektion</h2><label>Lektion<select required value={lessonId} disabled={Boolean(editingId)} onChange={(event) => { setLessonId(event.target.value); setSelected([]); }}>{lessons.map((lesson) => <option key={lesson.id} value={lesson.id}>{lesson.label}</option>)}</select></label><label>Rubrik<input required value={title} onChange={(event) => setTitle(event.target.value)} /></label><div className="form-two-columns"><label>Feedback<select value={feedbackMode} onChange={(event) => setFeedbackMode(event.target.value)}><option value="immediate">Efter varje svar</option><option value="after_submit">Efter inlämning</option><option value="none">Ingen feedback</option></select></label><label>Godkäntgräns (%) <span>valfritt</span><input type="number" min="1" max="100" value={passPercent} onChange={(event) => setPassPercent(event.target.value)} /></label></div><fieldset className="quiz-question-list"><legend>Frågor ({selected.length} valda)</legend>{available.map((question) => <label className="quiz-question-option" key={question.id}><input type="checkbox" checked={selected.includes(question.id)} onChange={() => toggle(question.id)} /><span><strong>{question.prompt}</strong><small>{question.topic} · {question.difficulty}</small></span></label>)}{!available.length && <p>Det finns inga aktiva frågor för kursen.</p>}</fieldset>{selected.length > 0 && <fieldset className="quiz-question-list quiz-question-order"><legend>Ordning på quizfrågorna</legend>{selected.map((id, index) => { const question = questions.find((item) => item.id === id); return <div className="quiz-question-option" key={id} draggable onDragStart={() => setDragging(id)} onDragOver={(event) => event.preventDefault()} onDrop={() => moveQuestion(id)} onDragEnd={() => setDragging(null)}><span><strong>{index + 1}. {question?.prompt ?? id}</strong><small>{question?.topic ?? "Fråga"} · dra för att sortera</small></span></div>; })}</fieldset>}<button className="button button-dark" type="submit">{editingId ? "Spara ändringar" : "Skapa quiz →"}</button>{editingId && <button className="button button-light" type="button" onClick={() => { setEditingId(null); setSelected([]); setMessage(""); }}>Avbryt redigering</button>}{message && <p className="admin-message" role="status">{message}</p>}</form>{existing.length > 0 && <div className="admin-list"><p className="eyebrow">Befintliga quiz</p>{existing.map((quiz) => <article className="admin-list-row" key={quiz.id}><div><strong>{quiz.title}</strong><small>{lessons.find((lesson) => lesson.id === quiz.lessonId)?.label ?? "Lektion"} · {quiz.questionIds.length} frågor</small></div><button className="button button-light" type="button" onClick={() => edit(quiz)}>Redigera</button></article>)}</div>}</section>;
}
