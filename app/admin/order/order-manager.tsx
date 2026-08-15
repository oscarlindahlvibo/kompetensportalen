"use client";

import { useState } from "react";

type Row = {
  id: string;
  shortId: string;
  buyer: string;
  buyerType: string;
  status: string;
  totalSek: number;
  createdAt: string;
};

export default function OrderManager({ initialRows }: { initialRows: Row[] }) {
  const [rows, setRows] = useState(initialRows);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState<string | null>(null);

  async function approve(row: Row) {
    setBusy(row.id);
    setMessage("");
    const response = await fetch(`/api/admin/orders/${row.id}/approve-invoice`, { method: "POST" });
    const data = (await response.json()) as { error?: string };
    setBusy(null);
    if (!response.ok) return setMessage(data.error ?? "Fakturan kunde inte godkännas.");
    setRows((current) => current.map((item) => item.id === row.id ? { ...item, status: "paid" } : item));
    setMessage(`Order ${row.shortId} är godkänd och platserna har aktiverats.`);
  }

  return <>
    {message && <p className="admin-message" role="status">{message}</p>}
    <div className="admin-table">
      {rows.length ? rows.map((row) => <div className="admin-table-row order-admin-row" key={row.id}>
        <div><strong>{row.shortId}</strong><span>{row.buyer} · {row.buyerType}</span></div>
        <span className="status-pill">{row.status}</span>
        <span>{row.totalSek.toLocaleString("sv-SE")} kr</span>
        <span>{row.createdAt}</span>
        {row.status === "invoice_pending" ? <button className="button button-light" type="button" disabled={busy === row.id} onClick={() => void approve(row)}>{busy === row.id ? "Godkänner..." : "Godkänn faktura"}</button> : <span />}
      </div>) : <p>Inga order ännu.</p>}
    </div>
  </>;
}
