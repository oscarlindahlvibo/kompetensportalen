"use client";

import { useState } from "react";

type Message = { id: string; name: string; email: string; message: string; status: "new" | "in_progress" | "closed"; createdAt: string };

export default function ContactMessageManager({ initialMessages }: { initialMessages: Message[] }) {
  const [messages, setMessages] = useState(initialMessages);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState("");
  async function update(id: string, status: Message["status"]) {
    setBusy(id); setError("");
    const response = await fetch("/api/admin/contact-messages", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ id, status }) });
    const data = await response.json() as { error?: string };
    setBusy(null);
    if (!response.ok) return setError(data.error ?? "Statusen kunde inte sparas.");
    setMessages((current) => current.map((item) => item.id === id ? { ...item, status } : item));
  }
  return <section className="section admin-table-section"><div className="section-heading"><div><p className="eyebrow">Kontaktärenden</p><h2>{messages.length} meddelanden</h2></div>{error && <p className="admin-message" role="alert">{error}</p>}</div><div className="admin-table">{messages.length ? messages.map((item) => <article className="admin-table-row" key={item.id}><div><strong>{item.name}</strong><span><a href={`mailto:${item.email}`}>{item.email}</a> · {item.createdAt}</span><p>{item.message}</p></div><select aria-label={`Status för ${item.name}`} value={item.status} disabled={busy === item.id} onChange={(event) => void update(item.id, event.target.value as Message["status"])}><option value="new">Nytt</option><option value="in_progress">Pågår</option><option value="closed">Stängt</option></select></article>) : <p>Inga kontaktmeddelanden ännu.</p>}</div></section>;
}
