"use client";

import { useState } from "react";

type Row = {
  id: string;
  status: string;
  participant: string;
  personalIdentity: string | null;
  course: string;
  competenceCode: string;
  validUntil: string | null;
  id06Reference: string | null;
};
const nextStatus: Record<string, string | null> = {
  not_ready: "ready_for_id06",
  ready_for_id06: "submitted",
  submitted: "registered",
  failed: "ready_for_id06",
  registered: null,
};

export default function Id06Queue({ initialRows }: { initialRows: Row[] }) {
  const [rows, setRows] = useState(initialRows);
  const [message, setMessage] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [references, setReferences] = useState<Record<string, string>>(() =>
    Object.fromEntries(
      initialRows.map((row) => [row.id, row.id06Reference ?? ""]),
    ),
  );
  async function advance(row: Row, requestedStatus = nextStatus[row.status]) {
    const status = requestedStatus;
    if (!status) return;
    if (status === "failed" && !errors[row.id]?.trim()) {
      setMessage("Ange en felorsak innan registreringen markeras som fel.");
      return;
    }
    const response = await fetch(`/api/admin/id06/${row.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        status,
        id06Reference: references[row.id] || undefined,
        errorMessage: status === "failed" ? errors[row.id] : undefined,
      }),
    });
    const data = (await response.json()) as { error?: string };
    if (!response.ok)
      return setMessage(data.error ?? "Statusen kunde inte ändras.");
    setRows((current) =>
      current.map((item) => (item.id === row.id ? { ...item, status } : item)),
    );
    setMessage(`Status ändrad till ${status}.`);
  }
  return (
    <section className="section admin-table-section">
      <div className="section-heading">
        <div>
          <p className="eyebrow">ID06-kö</p>
          <h2>{rows.length} registreringar</h2>
        </div>
        {message && <span className="admin-message">{message}</span>}
      </div>
      <div className="admin-table">
        {rows.length ? (
          rows.map((row) => (
            <div className="admin-table-row" key={row.id}>
              <div>
                <strong>{row.participant}</strong>
                <span>{row.personalIdentity ?? "Personnummer saknas"}</span>
              </div>
              <div>
                <span>{row.course}</span>
                <small>{row.competenceCode}</small>
              </div>
              <span className={`status-pill status-${row.status}`}>
                {row.status}
              </span>
              <span>{row.validUntil ?? "-"}</span>
              {row.status === "submitted" && (
                <input
                  aria-label={`ID06-referens för ${row.participant}`}
                  value={references[row.id] ?? ""}
                  onChange={(event) =>
                    setReferences((current) => ({
                      ...current,
                      [row.id]: event.target.value,
                    }))
                  }
                  placeholder="ID06-referens"
                />
              )}
              {row.status !== "registered" && <input aria-label={`Felorsak för ${row.participant}`} value={errors[row.id] ?? ""} onChange={(event) => setErrors((current) => ({ ...current, [row.id]: event.target.value }))} placeholder="Felorsak vid behov" />}
              <button
                className="button button-light"
                disabled={!nextStatus[row.status]}
                onClick={() => advance(row)}
              >
                {nextStatus[row.status]
                  ? `→ ${nextStatus[row.status]}`
                  : "Klar"}
              </button>
              {row.status !== "registered" && <button className="button button-light" type="button" onClick={() => void advance(row, "failed")}>Markera fel</button>}
            </div>
          ))
        ) : (
          <p>Ingen ID06-registrering väntar.</p>
        )}
      </div>
    </section>
  );
}
