"use client";

import { useState } from "react";

type Company = { id: string; name: string; organizationNumber: string; contactEmail: string; invoiceAddress: string | null; invoicePurchaseEnabled: boolean; activateInvoiceLicensesImmediately: boolean };

export default function CompanySettings({ initialCompanies }: { initialCompanies: Company[] }) {
  const [companies, setCompanies] = useState(initialCompanies);
  const [message, setMessage] = useState("");
  async function toggle(company: Company, field: "invoicePurchaseEnabled" | "activateInvoiceLicensesImmediately") {
    setMessage("");
    const response = await fetch(`/api/admin/companies/${company.id}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ [field]: !company[field] }) });
    const data = await response.json() as { company?: Company; error?: string };
    if (!response.ok || !data.company) return setMessage(data.error ?? "Företagsinställningen kunde inte ändras.");
    setCompanies((current) => current.map((item) => item.id === company.id ? data.company! : item));
    setMessage("Företagsinställningen sparades och loggades.");
  }
  return <section className="section admin-table-section"><div className="section-heading"><div><p className="eyebrow">Företagskunder</p><h2>{companies.length} företag</h2></div>{message && <span className="admin-message" role="status">{message}</span>}</div><div className="admin-table">{companies.length ? companies.map((company) => <div className="admin-table-row company-settings-row" key={company.id}><div><strong>{company.name}</strong><span>{company.organizationNumber} · {company.contactEmail}</span></div><button className="button button-light" type="button" onClick={() => void toggle(company, "invoicePurchaseEnabled")}>{company.invoicePurchaseEnabled ? "Faktura aktiv" : "Faktura av"}</button><button className="button button-light" type="button" onClick={() => void toggle(company, "activateInvoiceLicensesImmediately")}>{company.activateInvoiceLicensesImmediately ? "Aktivering direkt" : "Aktivering efter godkännande"}</button></div>) : <p>Inga företagskunder ännu.</p>}</div></section>;
}
