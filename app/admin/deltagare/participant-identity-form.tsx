"use client";

import { useState } from "react";

export default function ParticipantIdentityForm({
  userId,
  identityLast4,
}: {
  userId: string;
  identityLast4: string | null;
}) {
  const [value, setValue] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  async function save() {
    setBusy(true);
    setMessage("");
    const response = await fetch(
      `/api/admin/participants/${encodeURIComponent(userId)}/identity`,
      {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ personalIdentity: value }),
      },
    );
    const data = (await response.json()) as {
      error?: string;
      identityLast4?: string;
    };
    setBusy(false);
    if (!response.ok) {
      setMessage(
        data.error === "personal_identity_invalid"
          ? "Personnumret måste vara giltigt."
          : (data.error ?? "Personnumret kunde inte sparas."),
      );
      return;
    }
    setValue("");
    setMessage(`Sparat. Slutar på ${data.identityLast4 ?? "****"}.`);
  }

  return (
    <div className="privacy-actions">
      <small>{identityLast4 ? `Personnummer: ••••••${identityLast4}` : "Personnummer saknas"}</small>
      <input
        aria-label="Personnummer"
        inputMode="numeric"
        autoComplete="off"
        placeholder="ÅÅMMDD-XXXX"
        value={value}
        onChange={(event) => setValue(event.target.value)}
      />
      <button
        className="button button-light"
        type="button"
        disabled={busy || !value.trim()}
        onClick={() => void save()}
      >
        {busy ? "Sparar..." : "Spara ID"}
      </button>
      {message && <small role="status">{message}</small>}
    </div>
  );
}
