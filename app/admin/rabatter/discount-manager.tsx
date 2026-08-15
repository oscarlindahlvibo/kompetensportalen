"use client";

import { useState } from "react";

type Course = { id: string; name: string };
type Code = {
  id: string;
  code: string;
  type: string;
  value: number;
  uses: number;
  maxUses: number | null;
  active: boolean;
  startsAt: string | null;
  endsAt: string | null;
  courseIds: string[];
};

const emptyForm = {
  code: "",
  type: "percent",
  value: "20",
  maxUses: "",
  minimumOrderSek: "",
  startsAt: "",
  endsAt: "",
  courseIds: [] as string[],
};

export default function DiscountManager({ initialCourses, initialCodes }: { initialCourses: Course[]; initialCodes: Code[] }) {
  const [codes, setCodes] = useState(initialCodes);
  const [form, setForm] = useState(emptyForm);
  const [message, setMessage] = useState("");

  async function create(event: React.FormEvent) {
    event.preventDefault();
    setMessage("");
    const toIso = (value: string) => value ? new Date(value).toISOString() : null;
    const response = await fetch("/api/admin/discount-codes", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        code: form.code,
        type: form.type,
        value: Number(form.value),
        maxUses: form.maxUses ? Number(form.maxUses) : null,
        minimumOrderSek: form.minimumOrderSek ? Number(form.minimumOrderSek) : null,
        startsAt: toIso(form.startsAt),
        endsAt: toIso(form.endsAt),
        courseIdsJson: JSON.stringify(form.courseIds),
      }),
    });
    const data = await response.json() as { code?: Code; error?: string };
    if (!response.ok || !data.code) return setMessage(data.error ?? "Rabattkoden kunde inte skapas.");
    setCodes((current) => [data.code!, ...current]);
    setForm(emptyForm);
    setMessage("Rabattkoden skapades.");
  }

  async function toggle(code: Code) {
    const response = await fetch("/api/admin/discount-codes", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ id: code.id, active: !code.active }) });
    if (response.ok) setCodes((current) => current.map((item) => item.id === code.id ? { ...item, active: !item.active } : item));
  }

  function updateCourses(event: React.ChangeEvent<HTMLSelectElement>) {
    setForm({ ...form, courseIds: Array.from(event.target.selectedOptions, (option) => option.value) });
  }

  return <section className="section course-admin-section"><div className="course-admin-grid"><form className="admin-form" onSubmit={create}><p className="eyebrow">Ny rabattkod</p><h2>Skapa kod</h2><label>Kod<input required value={form.code} onChange={(event) => setForm({ ...form, code: event.target.value })} placeholder="SOMMAR20" /></label><label>Typ<select value={form.type} onChange={(event) => setForm({ ...form, type: event.target.value })}><option value="percent">Procent</option><option value="fixed">Fast belopp</option></select></label><label>Värde<input type="number" min="1" required value={form.value} onChange={(event) => setForm({ ...form, value: event.target.value })} /></label><label>Max användningar <span>valfritt</span><input type="number" min="1" value={form.maxUses} onChange={(event) => setForm({ ...form, maxUses: event.target.value })} /></label><label>Minsta ordervärde <span>SEK, valfritt</span><input type="number" min="0" value={form.minimumOrderSek} onChange={(event) => setForm({ ...form, minimumOrderSek: event.target.value })} /></label><div className="form-two-columns"><label>Gäller från <span>valfritt</span><input type="datetime-local" value={form.startsAt} onChange={(event) => setForm({ ...form, startsAt: event.target.value })} /></label><label>Gäller till <span>valfritt</span><input type="datetime-local" value={form.endsAt} onChange={(event) => setForm({ ...form, endsAt: event.target.value })} /></label></div><label>Begränsa till kurser <span>tomt = alla</span><select multiple value={form.courseIds} onChange={updateCourses}>{initialCourses.map((course) => <option key={course.id} value={course.id}>{course.name}</option>)}</select></label><button className="button button-dark" type="submit">Skapa rabattkod →</button>{message && <p className="admin-message" role="status">{message}</p>}</form><div className="admin-table-section"><p className="eyebrow">Aktiva koder</p><h2>{codes.length} koder</h2><div className="admin-table">{codes.map((code) => <div className="admin-table-row" key={code.id}><div><strong>{code.code}</strong><span>{code.type === "percent" ? `${code.value} %` : `${code.value} kr`} · {code.uses}/{code.maxUses ?? "∞"}{code.courseIds.length ? ` · ${code.courseIds.length} kurser` : " · alla kurser"}</span></div><span>{code.active ? "Aktiv" : "Avstängd"}</span><button className="button button-light" type="button" onClick={() => void toggle(code)}>{code.active ? "Stäng av" : "Aktivera"}</button></div>)}</div></div></div></section>;
}
