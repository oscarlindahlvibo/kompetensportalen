"use client";

import { useState } from "react";

export default function CourseInterest({ courseId }: { courseId: string }) {
  const [email, setEmail] = useState("");
  const [message, setMessage] = useState("");
  async function submit(event: React.FormEvent) {
    event.preventDefault();
    const response = await fetch("/api/course-interest", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ courseId, email }) });
    const data = await response.json() as { message?: string; error?: string };
    setMessage(response.ok ? data.message ?? "Tack!" : data.error ?? "Det gick inte att spara e-postadressen.");
    if (response.ok) setEmail("");
  }
  return <form className="interest-form" onSubmit={submit}><input aria-label="E-post för kursnotis" type="email" required value={email} onChange={(event) => setEmail(event.target.value)} placeholder="din@email.se" /><button className="button button-light" type="submit">Meddela mig <span>→</span></button>{message && <small role="status">{message}</small>}</form>;
}
