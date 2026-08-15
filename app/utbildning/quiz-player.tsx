/* eslint-disable @next/next/no-img-element */
"use client";

import { useEffect, useState } from "react";

type Question = { id: string; prompt: string; type: string; imageUrl?: string | null; options: { id: string; label: string }[] };
type Result = { scorePercent: number; passed: boolean; results: { questionId: string; correct: boolean; explanation: string | null }[] };
type ImmediateResult = { correct: boolean; explanation: string | null; correctOptionLabels: string[] };

export default function QuizPlayer({ quizId, enrollmentId }: { quizId: string; enrollmentId: string }) {
  const [title, setTitle] = useState("Quiz");
  const [passPercent, setPassPercent] = useState<number | null>(null);
  const [feedbackMode, setFeedbackMode] = useState("after_submit");
  const [questions, setQuestions] = useState<Question[]>([]);
  const [answers, setAnswers] = useState<Record<string, string[]>>({});
  const [result, setResult] = useState<Result | null>(null);
  const [message, setMessage] = useState("Laddar quiz...");
  const [busy, setBusy] = useState(false);
  const [checking, setChecking] = useState<string | null>(null);
  const [immediateResults, setImmediateResults] = useState<Record<string, ImmediateResult>>({});

  useEffect(() => {
    void (async () => {
      const response = await fetch(`/api/quizzes/${encodeURIComponent(quizId)}?enrollmentId=${encodeURIComponent(enrollmentId)}`);
      const data = await response.json() as { quiz?: { title: string; feedbackMode: string; passPercent: number | null }; questions?: Question[] };
      if (!response.ok || !data.quiz) return setMessage("Quizet kunde inte laddas.");
      setTitle(data.quiz.title); setPassPercent(data.quiz.passPercent ?? null); setFeedbackMode(data.quiz.feedbackMode); setQuestions(data.questions ?? []); setMessage("");
    })();
  }, [enrollmentId, quizId]);

  function toggle(question: Question, optionId: string) {
    setAnswers((current) => {
      const selected = current[question.id] ?? [];
      const next = question.type === "multiple"
        ? selected.includes(optionId) ? selected.filter((id) => id !== optionId) : [...selected, optionId]
        : [optionId];
      return { ...current, [question.id]: next };
    });
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault(); setBusy(true); setMessage("");
    const response = await fetch(`/api/quizzes/${encodeURIComponent(quizId)}/submit`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ enrollmentId, answers }) });
    const data = await response.json() as Result & { error?: string };
    setBusy(false);
    if (!response.ok) return setMessage(data.error ?? "Quizet kunde inte lämnas in.");
    setResult(data); setMessage("");
  }

  async function checkAnswer(question: Question) {
    setChecking(question.id);
    const response = await fetch(`/api/quizzes/${encodeURIComponent(quizId)}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ enrollmentId, questionId: question.id, selectedOptionIds: answers[question.id] ?? [] }) });
    const data = await response.json() as ImmediateResult & { error?: string };
    setChecking(null);
    if (!response.ok) return setMessage(data.error ?? "Svaret kunde inte kontrolleras.");
    setImmediateResults((current) => ({ ...current, [question.id]: data }));
  }

  if (result) return <section className="quiz-player"><div className="quiz-result"><p className="eyebrow">Resultat</p><h2>{result.passed ? "Rätt genomfört." : "Försök igen."}</h2><strong>{result.scorePercent} %</strong>{passPercent !== null && <p>Godkäntgräns: {passPercent} %.</p>}</div><div className="quiz-feedback">{result.results.map((item, index) => <div key={item.questionId}><span>{item.correct ? "✓" : "✕"}</span><p>Fråga {index + 1}: {item.correct ? "Rätt" : "Fel"}{item.explanation ? ` · ${item.explanation}` : ""}</p></div>)}</div></section>;
  return <form className="quiz-player" onSubmit={submit}><p className="eyebrow">Kapitelquiz</p><h2>{title}</h2>{message && <p className="checkout-message" role="status">{message}</p>}{questions.map((question, index) => { const immediate = immediateResults[question.id]; return <fieldset className="quiz-question" key={question.id}><legend>{index + 1}. {question.prompt}</legend>{question.imageUrl && <img className="question-image" src={question.imageUrl} alt={`Bild till fråga ${index + 1}`} />}{question.options.map((option) => <label key={option.id}><input type={question.type === "multiple" ? "checkbox" : "radio"} name={question.id} checked={(answers[question.id] ?? []).includes(option.id)} onChange={() => toggle(question, option.id)} />{option.label}</label>)}{feedbackMode === "immediate" && <><button className="button button-light" type="button" disabled={checking === question.id || !(answers[question.id] ?? []).length} onClick={() => void checkAnswer(question)}>{checking === question.id ? "Kontrollerar..." : "Kontrollera svar"}</button>{immediate && <p className="checkout-message" role="status">{immediate.correct ? "Rätt!" : `Fel. Rätt svar: ${immediate.correctOptionLabels.join(", ")}`}{immediate.explanation ? ` ${immediate.explanation}` : ""}</p>}</>}</fieldset>; })}<button className="button button-dark" type="submit" disabled={busy || !questions.length}>{busy ? "Rättar..." : "Lämna in quizet →"}</button></form>;
}
