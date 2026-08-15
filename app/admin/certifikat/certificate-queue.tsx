"use client";

import { useState } from "react";

type Row = { enrollmentId: string; participant: string; course: string; examPassed: boolean; identityVerificationId: string | null; identityStatus: string | null; identityReference: string | null; identityNotes: string | null; certificateId: string | null; certificateNumber: string | null; certificateStatus: string | null };

function IdentityEditor({ row, onSaved }: { row: Row; onSaved: (status: string, verificationId: string) => void }) {
  const [reference, setReference] = useState(row.identityReference ?? "");
  const [notes, setNotes] = useState(row.identityNotes ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function save(status: "identity_verified" | "rejected") {
    setBusy(true); setError("");
    const response = await fetch(row.identityVerificationId ? `/api/admin/identity/${row.identityVerificationId}` : "/api/admin/identity", { method: row.identityVerificationId ? "PATCH" : "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ enrollmentId: row.enrollmentId, status, reference, notes }) });
    const data = await response.json() as { error?: string; status?: string; verificationId?: string };
    setBusy(false);
    if (!response.ok) return setError(data.error === "personal_identity_required" ? "Personnummer måste finnas verifierat innan ID06-certifiering." : (data.error ?? "Identitetskontrollen kunde inte sparas."));
    onSaved(data.status ?? status, data.verificationId ?? row.identityVerificationId ?? "");
  }
  return <div className="identity-admin-editor"><input aria-label="Verifieringsreferens" placeholder="Verifieringsreferens" value={reference} onChange={(event) => setReference(event.target.value)} /><input aria-label="Anteckning" placeholder="Anteckning" value={notes} onChange={(event) => setNotes(event.target.value)} /><div className="identity-admin-actions"><button className="button button-light" type="button" disabled={busy} onClick={() => void save("identity_verified")}>Markera verifierad</button><button className="button button-light" type="button" disabled={busy} onClick={() => void save("rejected")}>Avvisa</button></div>{error && <small role="alert">{error}</small>}</div>;
}

export default function CertificateQueue({ rows: initialRows, canRevoke }: { rows: Row[]; canRevoke: boolean }) {
  const [rows, setRows] = useState(initialRows);
  const [message, setMessage] = useState("");
  async function issue(enrollmentId: string) { setMessage(""); const response = await fetch("/api/admin/certificates/issue", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ enrollmentId }) }); const data = await response.json() as { certificate?: { certificateNumber: string }; error?: string }; if (!response.ok) return setMessage(data.error ?? "Certifikatet kunde inte utfärdas."); setRows((current) => current.map((row) => row.enrollmentId === enrollmentId ? { ...row, certificateNumber: data.certificate?.certificateNumber ?? "Utfärdat" } : row)); setMessage("Certifikatet utfärdades och ID06-kön uppdaterades."); }
  async function revoke(row: Row) { const reason = window.prompt("Anledning till återkallelse"); if (!reason?.trim() || !row.certificateId) return; setMessage(""); const response = await fetch(`/api/admin/certificates/${row.certificateId}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ status: "revoked", reason }) }); const data = await response.json() as { error?: string }; if (!response.ok) return setMessage(data.error ?? "Certifikatet kunde inte återkallas."); setRows((current) => current.map((item) => item.enrollmentId === row.enrollmentId ? { ...item, certificateStatus: "revoked" } : item)); setMessage("Certifikatet återkallades och händelsen loggades."); }
  return <section className="section admin-table-section"><div className="section-heading"><div><p className="eyebrow">Certifieringskö</p><h2>{rows.length} enrollment</h2></div>{message && <span className="admin-message" role="status">{message}</span>}</div><div className="admin-table">{rows.length ? rows.map((row) => <div className="admin-table-row certificate-admin-row" key={row.enrollmentId}><div><strong>{row.participant}</strong><span>{row.course}</span></div><span>{row.examPassed ? "Prov godkänt" : "Prov saknas"}</span><div><span>{row.identityStatus === "identity_verified" ? "ID verifierad" : row.identityStatus === "rejected" ? "ID avvisad" : "ID saknas"}</span>{row.identityStatus !== "identity_verified" && <IdentityEditor row={row} onSaved={(status, verificationId) => setRows((current) => current.map((item) => item.enrollmentId === row.enrollmentId ? { ...item, identityStatus: status, identityVerificationId: verificationId } : item))} />}</div>{row.certificateNumber ? <><span className={`status-pill ${row.certificateStatus === "revoked" ? "status-rejected" : "status-registered"}`}>{row.certificateStatus === "revoked" ? "Återkallat" : row.certificateNumber}</span>{canRevoke && row.certificateStatus !== "revoked" && <button className="button button-light" type="button" onClick={() => void revoke(row)}>Återkalla</button>}</> : <button className="button button-light" type="button" disabled={!row.examPassed || row.identityStatus !== "identity_verified"} onClick={() => void issue(row.enrollmentId)}>Utfärda</button>}</div>) : <p>Inga enrollment att granska.</p>}</div></section>;
}
