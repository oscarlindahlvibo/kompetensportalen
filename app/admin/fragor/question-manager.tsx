"use client";

import { useState } from "react";

type Course = { id: string; name: string };
type Answer = { label: string; isCorrect: boolean };
type Question = { id: string; courseId: string; prompt: string; topic: string; type: string; difficulty: string; points: number; active: boolean; imageUrl?: string | null; explanation?: string | null; answers: Answer[] };

const emptyAnswers = () => [{ label: "", isCorrect: false }, { label: "", isCorrect: false }];

export default function QuestionManager({ initialCourses, initialQuestions }: { initialCourses: Course[]; initialQuestions: Question[] }) {
  const [questions, setQuestions] = useState(initialQuestions);
  const [courseId, setCourseId] = useState(initialCourses[0]?.id ?? "");
  const [topic, setTopic] = useState("");
  const [difficulty, setDifficulty] = useState("medium");
  const [type, setType] = useState("single");
  const [prompt, setPrompt] = useState("");
  const [imageUrl, setImageUrl] = useState("");
  const [explanation, setExplanation] = useState("");
  const [points, setPoints] = useState("1");
  const [answers, setAnswers] = useState<Answer[]>(emptyAnswers);
  const [message, setMessage] = useState("");
  const [editingQuestionId, setEditingQuestionId] = useState<string | null>(null);

  function updateAnswer(index: number, update: Partial<Answer>) {
    setAnswers((current) => current.map((answer, answerIndex) => answerIndex === index ? { ...answer, ...update } : answer));
  }

  function resetForm() {
    setEditingQuestionId(null); setPrompt(""); setImageUrl(""); setExplanation(""); setAnswers(emptyAnswers());
  }

  async function saveQuestion(event: React.FormEvent) {
    event.preventDefault(); setMessage("");
    const validAnswers = answers.filter((answer) => answer.label.trim());
    if (!validAnswers.length || !validAnswers.some((answer) => answer.isCorrect)) return setMessage("Lägg till svarsalternativ och markera minst ett rätt svar.");
    const response = await fetch("/api/admin/question-bank", { method: editingQuestionId ? "PATCH" : "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ id: editingQuestionId ?? undefined, courseId, topic, difficulty, type, prompt, imageUrl: imageUrl.trim() || null, explanation, points: Number(points), answers: validAnswers.map((answer) => ({ ...answer, label: answer.label.trim() })) }) });
    const data = await response.json() as { questionId?: string; updated?: boolean; error?: string };
    if (!response.ok || (editingQuestionId ? !data.updated : !data.questionId)) return setMessage(data.error ?? "Frågan kunde inte sparas.");
    if (editingQuestionId) setQuestions((current) => current.map((item) => item.id === editingQuestionId ? { ...item, courseId, prompt, topic, type, difficulty, points: Number(points), imageUrl: imageUrl.trim() || null, explanation, answers: validAnswers } : item));
    else setQuestions((current) => [{ id: data.questionId!, courseId, prompt, topic, type, difficulty, points: Number(points), active: true, imageUrl: imageUrl.trim() || null, explanation, answers: validAnswers }, ...current]);
    resetForm(); setMessage(editingQuestionId ? "Ändringarna sparades." : "Frågan sparades i frågebanken.");
  }

  function editQuestion(question: Question) {
    setEditingQuestionId(question.id); setCourseId(question.courseId); setTopic(question.topic); setDifficulty(question.difficulty); setType(question.type); setPrompt(question.prompt); setImageUrl(question.imageUrl ?? ""); setExplanation(question.explanation ?? ""); setPoints(String(question.points)); setAnswers(question.answers.length ? question.answers : emptyAnswers()); setMessage("");
  }

  async function toggleQuestion(question: Question) {
    const response = await fetch("/api/admin/question-bank", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ id: question.id, active: !question.active }) });
    const data = await response.json() as { error?: string };
    if (!response.ok) return setMessage(data.error ?? "Frågestatus kunde inte ändras.");
    setQuestions((current) => current.map((item) => item.id === question.id ? { ...item, active: !item.active } : item));
  }

  return <div className="question-manager"><form className="admin-form" onSubmit={saveQuestion}><p className="eyebrow">{editingQuestionId ? "Redigera fråga" : "Ny fråga"}</p><h2>{editingQuestionId ? "Ändra frågan" : "Bygg en fråga"}</h2><label>Utbildning<select required value={courseId} onChange={(event) => setCourseId(event.target.value)}><option value="">Välj utbildning</option>{initialCourses.map((course) => <option value={course.id} key={course.id}>{course.name}</option>)}</select></label><div className="form-two-columns"><label>Ämne<input required value={topic} onChange={(event) => setTopic(event.target.value)} placeholder="Exempel: Riskbedömning" /></label><label>Poäng<input required type="number" min="1" max="100" value={points} onChange={(event) => setPoints(event.target.value)} /></label></div><div className="form-two-columns"><label>Frågetyp<select value={type} onChange={(event) => setType(event.target.value)}><option value="single">Envalsfråga</option><option value="multiple">Flervalsfråga</option><option value="true_false">Sant eller falskt</option><option value="image">Bildfråga</option></select></label><label>Svårighetsgrad<select value={difficulty} onChange={(event) => setDifficulty(event.target.value)}><option value="easy">Lätt</option><option value="medium">Medel</option><option value="hard">Svår</option></select></label></div><label>Fråga<textarea required value={prompt} onChange={(event) => setPrompt(event.target.value)} placeholder="Skriv frågan här" /></label>{type === "image" && <label>Bild-URL<input type="url" required value={imageUrl} onChange={(event) => setImageUrl(event.target.value)} placeholder="https://..." /></label>}<div className="answer-editor"><div className="answer-editor-heading"><strong>Svarsalternativ</strong><span>Markera rätt svar</span></div>{answers.map((answer, index) => <div className="answer-row" key={index}><input required={index < 2} value={answer.label} onChange={(event) => updateAnswer(index, { label: event.target.value })} placeholder={`Svar ${index + 1}`} /><label className="checkbox-label"><input type={type === "multiple" ? "checkbox" : "radio"} name="correct-answer" checked={answer.isCorrect} onChange={() => type === "multiple" ? updateAnswer(index, { isCorrect: !answer.isCorrect }) : setAnswers((current) => current.map((item, itemIndex) => ({ ...item, isCorrect: itemIndex === index })))} /> Rätt</label></div>)}<button className="button button-light" type="button" onClick={() => setAnswers((current) => [...current, { label: "", isCorrect: false }])}>+ Svarsalternativ</button></div><label>Förklaring efter svar<textarea value={explanation} onChange={(event) => setExplanation(event.target.value)} placeholder="Förklara varför svaret är rätt" /></label><div className="button-row"><button className="button button-dark" type="submit">{editingQuestionId ? "Spara ändringar →" : "Spara fråga →"}</button>{editingQuestionId && <button className="button button-light" type="button" onClick={() => { resetForm(); setMessage(""); }}>Avbryt</button>}</div>{message && <p className="admin-message" role="status">{message}</p>}</form><div className="admin-table question-manager-list"><div className="section-heading"><div><p className="eyebrow">Frågor</p><h2>{questions.length} sparade</h2></div></div>{questions.map((question) => <div className="admin-table-row question-row" key={question.id}><div><strong>{question.prompt}</strong><span>{question.topic} · {question.type} · {question.points} p</span></div><span className={`status-pill ${question.active ? "status-registered" : ""}`}>{question.active ? "Aktiv" : "Inaktiv"}</span><span>{question.difficulty}</span><button className="button button-light" type="button" onClick={() => editQuestion(question)}>Redigera</button><button className="button button-light" type="button" onClick={() => void toggleQuestion(question)}>{question.active ? "Inaktivera" : "Aktivera"}</button></div>)}</div></div>;
}
