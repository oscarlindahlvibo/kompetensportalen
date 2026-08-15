"use client";

import { useState } from "react";

export default function ContactForm() {
  const [values, setValues] = useState({ name: "", email: "", message: "" });
  const [status, setStatus] = useState("");
  async function submit(event: React.FormEvent) {
    event.preventDefault();
    const response = await fetch("/api/contact", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(values) });
    const data = await response.json() as { message?: string; error?: string };
    setStatus(response.ok ? data.message ?? "Skickat." : data.error ?? "Förfrågan kunde inte skickas.");
    if (response.ok) setValues({ name: "", email: "", message: "" });
  }
  return <form className="contact-form" onSubmit={submit}><label>Namn<input name="name" required value={values.name} onChange={(event) => setValues({ ...values, name: event.target.value })} placeholder="Ditt namn" /></label><label>E-post<input name="email" required type="email" value={values.email} onChange={(event) => setValues({ ...values, email: event.target.value })} placeholder="din@email.se" /></label><label>Vad gäller det?<textarea name="message" required rows={5} value={values.message} onChange={(event) => setValues({ ...values, message: event.target.value })} placeholder="Skriv ditt meddelande" /></label><button className="button button-dark" type="submit">Skicka förfrågan <span>→</span></button>{status && <p className="checkout-message" role="status">{status}</p>}</form>;
}
