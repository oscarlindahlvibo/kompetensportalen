"use client";

import { useState } from "react";

type NotificationRow = { id: string; type: string; subject: string; recipient: string; status: string; scheduledFor: string | null; createdAt: string };

export default function NotificationQueue({ initialRows }: { initialRows: NotificationRow[] }) {
  const [rows, setRows] = useState(initialRows);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  async function dispatch() {
    setBusy(true);
    const response = await fetch("/api/admin/notifications/dispatch", { method: "POST" });
    const data = await response.json() as { sent?: number; failed?: number; pending?: number; sentIds?: string[]; failedIds?: string[]; pendingIds?: string[]; configurationRequired?: boolean };
    setBusy(false);
    if (!response.ok) return setMessage("Utskicket kunde inte köras.");
    const sentIds = new Set(data.sentIds ?? []);
    const failedIds = new Set(data.failedIds ?? []);
    const pendingIds = new Set(data.pendingIds ?? []);
    setRows((current) => current.map((row) => sentIds.has(row.id) ? { ...row, status: "sent" } : failedIds.has(row.id) ? { ...row, status: "failed" } : pendingIds.has(row.id) ? { ...row, status: "queued" } : row));
    setMessage(data.configurationRequired ? "Mailadapter saknas. Köade meddelanden ligger kvar." : `${data.sent ?? 0} skickade · ${data.failed ?? 0} misslyckade · ${data.pending ?? 0} kvar i kö.`);
  }
  return <section className="section admin-table-section"><div className="section-heading"><div><p className="eyebrow">Utskick</p><h2>{rows.length} senaste meddelanden</h2></div><button className="button button-dark" type="button" disabled={busy} onClick={() => void dispatch()}>Skicka köade mejl →</button></div>{message && <p className="admin-message" role="status">{message}</p>}<div className="admin-table">{rows.length ? rows.map((row) => <div className="admin-table-row" key={row.id}><div><strong>{row.subject}</strong><span>{row.type} · {row.recipient}</span></div><span>{row.status}</span><small>{row.scheduledFor ?? row.createdAt}</small></div>) : <p>Inga meddelanden i kön.</p>}</div></section>;
}
