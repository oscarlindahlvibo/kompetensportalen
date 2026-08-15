"use client";

import { useState } from "react";

type DocumentRecord = {
  id: string;
  title: string;
  documentNumber: string | null;
  version: string | null;
  publishedAt: string | null;
  url: string | null;
  lastCheckedAt: string | null;
  notes: string | null;
};

type DocumentForm = Omit<DocumentRecord, "id">;

const emptyForm: DocumentForm = {
  title: "",
  documentNumber: "",
  version: "",
  publishedAt: "",
  url: "",
  lastCheckedAt: "",
  notes: "",
};

export default function GoverningDocumentManager({
  initialDocuments,
}: {
  initialDocuments: DocumentRecord[];
}) {
  const [documents, setDocuments] = useState(initialDocuments);
  const [selectedId, setSelectedId] = useState("");
  const [form, setForm] = useState<DocumentForm>(emptyForm);
  const [message, setMessage] = useState("");

  function selectDocument(id: string) {
    setSelectedId(id);
    const document = documents.find((item) => item.id === id);
    if (document) {
      setForm({
        title: document.title,
        documentNumber: document.documentNumber,
        version: document.version,
        publishedAt: document.publishedAt,
        url: document.url,
        lastCheckedAt: document.lastCheckedAt,
        notes: document.notes,
      });
    } else {
      setForm(emptyForm);
    }
    setMessage("");
  }

  function update(field: keyof DocumentForm, value: string) {
    setForm((current) => ({ ...current, [field]: value }));
  }

  async function save(event: React.FormEvent) {
    event.preventDefault();
    setMessage("");
    const payload = {
      ...form,
      ...(selectedId ? { id: selectedId } : {}),
    };
    const response = await fetch("/api/admin/governing-documents", {
      method: selectedId ? "PATCH" : "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    });
    const data = (await response.json().catch(() => ({}))) as {
      document?: DocumentRecord;
      error?: string;
    };
    if (!response.ok) {
      setMessage(data.error ?? "Dokumentet kunde inte sparas.");
      return;
    }
    if (data.document) {
      setDocuments((current) =>
        selectedId
          ? current.map((item) => (item.id === selectedId ? data.document! : item))
          : [data.document!, ...current],
      );
    } else if (selectedId) {
      setDocuments((current) =>
        current.map((item) => (item.id === selectedId ? { ...item, ...form } : item)),
      );
    }
    setMessage(selectedId ? "Dokumentet uppdaterades." : "Dokumentet registrerades.");
    if (!selectedId) setForm(emptyForm);
  }

  return (
    <section className="section admin-table-section">
      <div className="section-heading">
        <div>
          <p className="eyebrow">Styrande dokument</p>
          <h2>{documents.length} registrerade dokument</h2>
        </div>
        {message && <span className="admin-message" role="status">{message}</span>}
      </div>
      <div className="course-admin-grid">
        <form className="admin-form" onSubmit={save}>
          <p className="eyebrow">{selectedId ? "Redigera dokument" : "Nytt dokument"}</p>
          <label>
            Dokumentets namn
            <input required value={form.title} onChange={(event) => update("title", event.target.value)} placeholder="Aktuellt kravdokument" />
          </label>
          <div className="form-two-columns">
            <label>
              Dokumentnummer <span>valfritt</span>
              <input value={form.documentNumber ?? ""} onChange={(event) => update("documentNumber", event.target.value)} />
            </label>
            <label>
              Version <span>valfritt</span>
              <input value={form.version ?? ""} onChange={(event) => update("version", event.target.value)} />
            </label>
          </div>
          <div className="form-two-columns">
            <label>
              Publiceringsdatum <span>valfritt</span>
              <input type="date" value={form.publishedAt ?? ""} onChange={(event) => update("publishedAt", event.target.value)} />
            </label>
            <label>
              Senast kontrollerad <span>valfritt</span>
              <input type="date" value={form.lastCheckedAt ?? ""} onChange={(event) => update("lastCheckedAt", event.target.value)} />
            </label>
          </div>
          <label>
            URL eller referens <span>valfritt</span>
            <input type="url" value={form.url ?? ""} onChange={(event) => update("url", event.target.value)} placeholder="https://..." />
          </label>
          <label>
            Anteckningar <span>valfritt</span>
            <textarea value={form.notes ?? ""} onChange={(event) => update("notes", event.target.value)} />
          </label>
          <div className="form-two-columns">
            <button className="button button-dark" type="submit">{selectedId ? "Spara ändringar" : "Registrera dokument"} →</button>
            {selectedId && <button className="button button-light" type="button" onClick={() => selectDocument("")}>Nytt dokument</button>}
          </div>
        </form>
        <div className="admin-table">
          {documents.length ? documents.map((document) => (
            <div className="admin-table-row governing-row" key={document.id}>
              <div>
                <strong>{document.title}</strong>
                <span>{document.documentNumber || "Dokumentnummer saknas"} · version {document.version || "-"}</span>
              </div>
              <span>Kontrollerad {document.lastCheckedAt || "aldrig"}</span>
              <button className="button button-light" type="button" onClick={() => selectDocument(document.id)}>Redigera</button>
            </div>
          )) : <p>Inga styrande dokument är registrerade.</p>}
        </div>
      </div>
    </section>
  );
}
