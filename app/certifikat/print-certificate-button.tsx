"use client";

export default function PrintCertificateButton() {
  return (
    <button
      className="button button-dark certificate-print-button"
      type="button"
      onClick={() => window.print()}
    >
      Skriv ut eller spara som PDF <span>↓</span>
    </button>
  );
}
