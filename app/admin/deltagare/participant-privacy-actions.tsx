"use client";

import { useState } from "react";

export default function ParticipantPrivacyActions({ userId }: { userId: string }) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  async function anonymize() {
    if (!window.confirm("Anonymisera kontot? Historisk elevdokumentation sparas.")) return;
    setBusy(true); setMessage("");
    const response = await fetch(`/api/admin/participants/${encodeURIComponent(userId)}/privacy`, { method: "POST" });
    const data = (await response.json()) as { error?: string };
    setBusy(false);
    setMessage(response.ok ? "Kontot anonymiserades." : (data.error ?? "Anonymisering misslyckades."));
  }
  return <div className="privacy-actions"><a className="button button-light" href={`/api/admin/participants/${encodeURIComponent(userId)}/privacy`}>Exportera data</a><button className="button button-light" type="button" disabled={busy} onClick={() => void anonymize()}>{busy ? "Anonymiserar..." : "Anonymisera"}</button>{message && <small role="status">{message}</small>}</div>;
}
