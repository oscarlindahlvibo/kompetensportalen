"use client";

import { useState } from "react";

type Review = { id: string; courseId: string; latestReviewAt: string | null; nextReviewAt: string | null; notes: string | null; contentReviewed: boolean; examReviewed: boolean; certificateReviewed: boolean; id06CodeVerified: boolean; publicationApproved: boolean };
type Course = { id: string; name: string };
const checks = [{ key: "contentReviewed", label: "Innehåll granskat" }, { key: "examReviewed", label: "Prov granskat" }, { key: "certificateReviewed", label: "Certifikat granskat" }, { key: "id06CodeVerified", label: "ID06-kod verifierad" }, { key: "publicationApproved", label: "Publicering godkänd" }] as const;

export default function QualityManager({ initialReviews, courses }: { initialReviews: Review[]; courses: Course[] }) {
  const [reviews, setReviews] = useState(initialReviews);
  const [message, setMessage] = useState("");
  async function create(courseId: string) {
    const response = await fetch("/api/admin/quality-reviews", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ courseId, latestReviewAt: new Date().toISOString().slice(0, 10) }) });
    const data = await response.json() as { review?: Review; error?: string };
    if (!response.ok || !data.review) return setMessage(data.error ?? "Granskningen kunde inte skapas.");
    setReviews((current) => [...current, data.review!]); setMessage("Kvalitetsgranskningen skapades.");
  }
  async function toggle(review: Review, key: typeof checks[number]["key"]) {
    const next = { ...review, [key]: !review[key] };
    const response = await fetch("/api/admin/quality-reviews", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ id: review.id, [key]: next[key] }) });
    if (!response.ok) return setMessage("Checklistan kunde inte sparas.");
    setReviews((current) => current.map((item) => item.id === review.id ? next : item)); setMessage("Checklistan sparades.");
  }
  async function saveDetails(review: Review) {
    const response = await fetch("/api/admin/quality-reviews", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ id: review.id, latestReviewAt: review.latestReviewAt, nextReviewAt: review.nextReviewAt, notes: review.notes }) });
    setMessage(response.ok ? "Granskningsuppgifterna sparades." : "Granskningsuppgifterna kunde inte sparas.");
  }
  function updateDetails(id: string, values: Partial<Review>) {
    setReviews((current) => current.map((item) => item.id === id ? { ...item, ...values } : item));
  }
  return <section className="section admin-table-section"><div className="section-heading"><div><p className="eyebrow">Redigera kvalitetskontroll</p><h2>{reviews.length} granskningar</h2></div>{message && <span className="admin-message" role="status">{message}</span>}</div><div className="quality-grid">{reviews.map((review) => <article className="quality-card" key={review.id}><h3>{courses.find((course) => course.id === review.courseId)?.name ?? review.courseId}</h3><div className="form-two-columns"><label>Senast granskad<input type="date" value={review.latestReviewAt ?? ""} onChange={(event) => updateDetails(review.id, { latestReviewAt: event.target.value || null })} /></label><label>Nästa granskning<input type="date" value={review.nextReviewAt ?? ""} onChange={(event) => updateDetails(review.id, { nextReviewAt: event.target.value || null })} /></label></div><label>Revisionsanteckningar<textarea value={review.notes ?? ""} onChange={(event) => updateDetails(review.id, { notes: event.target.value || null })} placeholder="Vad granskades och vad ska ändras?" /></label><button className="button button-light" type="button" onClick={() => void saveDetails(review)}>Spara uppgifter</button><div className="quality-checks">{checks.map((check) => <label key={check.key}><input type="checkbox" checked={review[check.key]} onChange={() => void toggle(review, check.key)} />{check.label}</label>)}</div></article>)}</div><div className="admin-form"><p className="eyebrow">Ny granskning</p><div className="form-two-columns">{courses.map((course) => <button className="button button-light" type="button" key={course.id} onClick={() => void create(course.id)}>Skapa för {course.name}</button>)}</div></div></section>;
}
