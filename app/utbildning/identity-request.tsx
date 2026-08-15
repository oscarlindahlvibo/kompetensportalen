"use client";

import { useState } from "react";

export default function IdentityRequest({
  enrollmentId,
}: {
  enrollmentId: string;
}) {
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [verificationId, setVerificationId] = useState<string | null>(null);
  const [verificationMethod, setVerificationMethod] = useState<"manual_bankid_document" | "bankid" | null>(null);
  async function request(method: "manual_bankid_document" | "bankid") {
    setBusy(true);
    const response = await fetch("/api/identity-verifications", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ enrollmentId, method }),
    });
    const data = (await response.json()) as {
      error?: string;
      verification?: { id: string };
      bankid?: { autoStartToken?: string };
    };
    setBusy(false);
    if (!response.ok)
      return setMessage(
        data.error === "bankid_not_configured"
          ? "BankID är inte konfigurerat ännu. Använd den manuella kontrollen."
          : data.error === "bankid_identity_mismatch"
            ? "BankID-identiteten stämmer inte med det registrerade personnumret."
          : (data.error ?? "Identitetskontrollen kunde inte startas."),
      );
    setVerificationId(data.verification?.id ?? null);
    setVerificationMethod(method);
    setMessage(
      method === "bankid"
        ? `BankID-verifieringen är startad${data.bankid?.autoStartToken ? ". Följ BankID-länken från leverantören." : ". Kontrollera status när du har signerat."}`
        : "Identitetskontroll är begärd. Följ instruktionerna från utbildningsanordnaren.",
    );
  }
  async function collect() {
    if (!verificationId) return;
    setBusy(true);
    const response = await fetch(
      `/api/identity-verifications/${verificationId}`,
      { method: "PATCH" },
    );
    const data = (await response.json()) as { error?: string; status?: string };
    setBusy(false);
    setMessage(
      response.ok
        ? data.status === "identity_verified"
          ? "Identiteten är verifierad."
          : "BankID-signeringen är ännu inte klar."
        : (data.error ?? "Statusen kunde inte hämtas."),
    );
  }
  return (
    <div className="identity-request">
      <strong>Identitetskontroll krävs för certifikat</strong>
      <p>
        Välj BankID när integrationen är aktiv, annars begär manuell kontroll.
      </p>
      <div className="identity-actions">
        <button
          className="button button-dark"
          type="button"
          onClick={() => void request("bankid")}
          disabled={busy}
        >
          Verifiera med BankID <span>→</span>
        </button>
        <button
          className="button button-light"
          type="button"
          onClick={() => void request("manual_bankid_document")}
          disabled={busy}
        >
          Begär manuell kontroll
        </button>
        {verificationId && verificationMethod === "bankid" && (
          <button
            className="button button-light"
            type="button"
            onClick={() => void collect()}
            disabled={busy}
          >
            Kontrollera BankID-status
          </button>
        )}
      </div>
      {message && <small role="status">{message}</small>}
    </div>
  );
}
