/* eslint-disable @next/next/no-img-element */
"use client";

import { useEffect, useMemo, useState } from "react";

type Question = { id: string; prompt: string; points: number; type: string; imageUrl?: string | null; options: { id: string; label: string }[] };
type Config = { questionCount: number; passPercent: number; timeLimitSeconds: number | null; maxAttempts: number; cooldownSeconds: number };
type Attempt = { id: string; attemptNumber: number; status: string; scorePercent: number | null; passed: boolean; startedAt: string; finishedAt: string | null };

export default function ExamPlayer({ enrollmentId }: { enrollmentId: string }) {
  const [config, setConfig] = useState<Config | null>(null);
  const [attempts, setAttempts] = useState<Attempt[]>([]);
  const [attemptId, setAttemptId] = useState("");
  const [questions, setQuestions] = useState<Question[]>([]);
  const [answers, setAnswers] = useState<Record<string, string[]>>({});
  const [startedAt, setStartedAt] = useState<string | null>(null);
  const [message, setMessage] = useState("Laddar provstatus...");
  const [busy, setBusy] = useState(false);
  const [now, setNow] = useState(Date.now());

  // The enrollment id is the only input that should reload this player.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { void load(); }, [enrollmentId]);
  useEffect(() => { if (!startedAt) return; const timer = window.setInterval(() => setNow(Date.now()), 1000); return () => window.clearInterval(timer); }, [startedAt]);
  const remaining = useMemo(() => config?.timeLimitSeconds && startedAt ? Math.max(0, config.timeLimitSeconds - Math.floor((now - Date.parse(startedAt)) / 1000)) : null, [config, startedAt, now]);
  // Submit once the server-side time window has elapsed.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { if (remaining === 0 && attemptId) void submit(); }, [remaining, attemptId]);

  async function load() {
    const response = await fetch(`/api/exams/attempts?enrollmentId=${encodeURIComponent(enrollmentId)}`);
    const data = await response.json() as { config?: Config; attempts?: Attempt[]; activeAttempt?: { id: string; startedAt: string; snapshot: Question[] } | null };
    if (response.ok) {
      setConfig(data.config ?? null);
      setAttempts(data.attempts ?? []);
      if (data.activeAttempt) {
        setAttemptId(data.activeAttempt.id);
        setStartedAt(data.activeAttempt.startedAt);
        setQuestions(data.activeAttempt.snapshot);
        setAnswers({});
      }
      setMessage("");
    }
    else setMessage("Provstatus kunde inte hämtas.");
  }

  async function start() {
    setBusy(true); setMessage("");
    const response = await fetch("/api/exams/attempts", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ enrollmentId }) });
    const data = await response.json() as { attemptId?: string; snapshot?: Question[]; config?: Config; startedAt?: string; error?: string };
    setBusy(false);
    if (!response.ok || !data.attemptId || !data.snapshot) return setMessage(errorText(data.error));
    setAttemptId(data.attemptId); setQuestions(data.snapshot); setConfig(data.config ?? config); setStartedAt(data.startedAt ?? new Date().toISOString());
    setAnswers({});
  }

  async function submit() {
    if (!attemptId || busy) return;
    setBusy(true);
    const response = await fetch("/api/exams/attempts", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ attemptId, answers }) });
    const data = await response.json() as { passed?: boolean; scorePercent?: number; timedOut?: boolean; error?: string };
    setBusy(false); setAttemptId(""); setStartedAt(null); setAnswers({});
    if (!response.ok) return setMessage(errorText(data.error));
    setMessage(data.timedOut ? "Tiden gick ut. Försöket är underkänt." : data.passed ? `Godkänt prov: ${data.scorePercent} %. Certifiering kan nu granskas.` : `Underkänt prov: ${data.scorePercent} %.`);
    await load();
  }

  function toggle(questionId: string, optionId: string, multiple: boolean) {
    setAnswers((current) => {
      const selected = current[questionId] ?? [];
      const next = selected.includes(optionId) ? selected.filter((id) => id !== optionId) : multiple ? [...selected, optionId] : [optionId];
      return { ...current, [questionId]: next };
    });
  }

  if (attemptId) return <div className="exam-player"><div className="exam-top"><div><p className="eyebrow">Slutprov</p><h2>Visa vad du kan.</h2></div><strong>{remaining === null ? "Ingen tidsgräns" : `${Math.floor(remaining / 60)}:${String(remaining % 60).padStart(2, "0")}`}</strong></div>{questions.map((question, index) => <fieldset className="exam-question" key={question.id}><legend>{index + 1}. {question.prompt}</legend>{question.imageUrl && <img className="question-image" src={question.imageUrl} alt={`Bild till fråga ${index + 1}`} />}{question.options.map((option) => <label key={option.id}><input type={question.type === "multiple" ? "checkbox" : "radio"} name={question.id} checked={(answers[question.id] ?? []).includes(option.id)} onChange={() => toggle(question.id, option.id, question.type === "multiple")} />{option.label}</label>)}</fieldset>)}<button className="button button-dark" type="button" onClick={() => void submit()} disabled={busy}>{busy ? "Sparar prov..." : "Lämna in provet →"}</button></div>;
  const latest = attempts[0];
  return <div className="exam-player exam-closed">{message && <p className="checkout-message" role="status">{message}</p>}<p>Godkäntgräns: {config?.passPercent ?? 80} %. Max {config?.maxAttempts ?? 3} försök.</p>{latest && <p>Senaste försök: {latest.scorePercent ?? 0} % · {latest.passed ? "godkänt" : "underkänt"}.</p>}<button className="button button-dark" type="button" onClick={() => void start()} disabled={busy || (config !== null && attempts.length >= config.maxAttempts)}>{busy ? "Startar..." : "Starta slutprovet →"}</button></div>;
}

function errorText(error?: string) {
  return ({ maximum_attempts_reached: "Du har använt alla försök.", attempt_cooldown_active: "Väntetiden mellan försöken är inte slut.", required_lessons_incomplete: "Slutför alla obligatoriska lektioner innan slutprovet.", exam_question_bank_insufficient: "Slutprovet är inte publiceringsklart ännu. Kursansvarig måste lägga in hela frågebanken." } as Record<string, string>)[error ?? ""] ?? "Slutprovet kunde inte startas.";
}
