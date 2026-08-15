"use client";

import { useState } from "react";

type Company = { id: string; name: string };

export default function BroadcastForm({ companies }: { companies: Company[] }) {
  const [audience, setAudience] = useState<"all_participants" | "company">("all_participants");
  const [companyId, setCompanyId] = useState("");
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setMessage("");
    const response = await fetch("/api/admin/notifications/broadcast", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ audience, companyId: audience === "company" ? companyId : undefined, subject, body }) });
    const data = await response.json() as { queued?: number; error?: string };
    setBusy(false);
    if (!response.ok) return setMessage(data.error ?? "Utskicket kunde inte köas.");
    setMessage(`${data.queued ?? 0} mottagare har fått meddelandet i utskickskön.`);
    setSubject("");
    setBody("");
  }

  return <section className="section admin-table-section"><div className="section-heading"><div><p className="eyebrow">Nytt utskick</p><h2>Skicka meddelande</h2></div><p>Utskicket köas och skickas först när mailadaptern är konfigurerad.</p></div><form className="admin-form broadcast-form" onSubmit={submit}><label>Mottagare<select value={audience} onChange={(event) => setAudience(event.target.value as typeof audience)}><option value="all_participants">Alla aktiva deltagare</option><option value="company">Ett företag</option></select></label>{audience === "company" && <label>Företag<select required value={companyId} onChange={(event) => setCompanyId(event.target.value)}><option value="">Välj företag</option>{companies.map((company) => <option key={company.id} value={company.id}>{company.name}</option>)}</select></label>}<label>Ämne<input required maxLength={200} value={subject} onChange={(event) => setSubject(event.target.value)} /></label><label>Meddelande<textarea required maxLength={50000} rows={8} value={body} onChange={(event) => setBody(event.target.value)} placeholder="Skriv meddelandet här. HTML kan användas av betrodda administratörer." /></label><button className="button button-dark" type="submit" disabled={busy}>{busy ? "Köar utskick..." : "Köa utskick →"}</button>{message && <p className="admin-message" role="status">{message}</p>}</form></section>;
}
