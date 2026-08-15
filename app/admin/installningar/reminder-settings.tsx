"use client";

import { useState } from "react";

export default function ReminderSettings({ initialWindows }: { initialWindows: number[] }) {
  const [value, setValue] = useState(initialWindows.join(", "));
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  async function save(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setMessage("");
    const reminderWindows = value.split(",").map((item) => Number(item.trim())).filter((item) => Number.isInteger(item));
    const response = await fetch("/api/admin/settings", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ reminderWindows }) });
    const data = await response.json() as { reminderWindows?: number[]; error?: string };
    setBusy(false);
    if (!response.ok || !data.reminderWindows) return setMessage(data.error ?? "Inställningen kunde inte sparas.");
    setValue(data.reminderWindows.join(", ")); setMessage("Påminnelsefönstren sparades.");
  }
  return <section className="section admin-table-section"><div className="section-heading"><div><p className="eyebrow">Påminnelser</p><h2>Utgående kompetens</h2></div><p>Worker-cronen skickar påminnelser exakt det antal dagar före giltighetens slut som anges här.</p></div><form className="admin-form" onSubmit={save}><label>Dagar före utgång, kommaseparerat<input inputMode="numeric" value={value} onChange={(event) => setValue(event.target.value)} placeholder="90, 60, 30, 7" /></label><button className="button button-dark" type="submit" disabled={busy}>{busy ? "Sparar..." : "Spara påminnelsefönster →"}</button>{message && <p className="admin-message" role="status">{message}</p>}</form></section>;
}
