"use client";

import { useState } from "react";

export default function CompanySetup() {
  const [form, setForm] = useState({ name: "", organizationNumber: "", invoiceAddress: "", contactEmail: "" });
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);
  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoading(true);
    setMessage("");
    const response = await fetch("/api/company", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(form) });
    const data = await response.json() as { error?: string };
    if (response.status === 401) setMessage("Logga in med ChatGPT för att skapa ett företagskonto.");
    else if (!response.ok) setMessage(data.error ?? "Företagskontot kunde inte skapas.");
    else { setMessage("Företagskontot är skapat. Öppna företagsportalen för att fortsätta."); setForm({ name: "", organizationNumber: "", invoiceAddress: "", contactEmail: "" }); }
    setLoading(false);
  }
  return <section className="section company-setup"><div><p className="eyebrow">Starta företagskonto</p><h2>Samla utbildningarna under ert företag.</h2><p>Skapa ett konto för att köpa platser, bjuda in deltagare och följa kompetensmatrisen.</p><a className="text-link" href="/foretag/portal">Öppna företagsportalen <span>→</span></a></div><form className="company-setup-form" onSubmit={submit}><label>Företagsnamn<input required value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} /></label><label>Organisationsnummer<input required value={form.organizationNumber} onChange={(event) => setForm({ ...form, organizationNumber: event.target.value })} placeholder="556123-4567" /></label><label>Fakturaadress<input value={form.invoiceAddress} onChange={(event) => setForm({ ...form, invoiceAddress: event.target.value })} /></label><label>Kontakt e-post<input type="email" value={form.contactEmail} onChange={(event) => setForm({ ...form, contactEmail: event.target.value })} placeholder="ekonomi@foretag.se" /></label><button className="button button-dark" disabled={loading}>{loading ? "Skapar konto..." : "Skapa företagskonto →"}</button>{message && <p className="checkout-message" role="status">{message}</p>}</form></section>;
}
