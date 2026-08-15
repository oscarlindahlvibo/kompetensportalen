"use client";

import { useSearchParams } from "next/navigation";
import { useState } from "react";
import { PageShell } from "@/app/components/site-chrome";

export default function CheckoutPage() {
  const searchParams = useSearchParams();
  const courseSlug = searchParams.get("course") ?? "arbete-pa-vag-apv-1-1-3";
  const companyId = searchParams.get("company");
  const courseLabel = courseSlug === "arbete-pa-vag-apv-1-1-3" ? "Arbete på väg APV 1.1-1.3" : courseSlug.split("-").map((part) => part.charAt(0).toUpperCase() + part.slice(1)).join(" ");
  const [quantity, setQuantity] = useState(1);
  const [discountCode, setDiscountCode] = useState("");
  const [paymentMethod, setPaymentMethod] = useState<"stripe" | "invoice">("stripe");
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);
  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoading(true); setMessage("");
    const response = await fetch("/api/orders", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ courseSlug, quantity, companyId: companyId || undefined, paymentMethod, discountCode: discountCode || undefined }) });
    const data = await response.json() as { error?: string; payment?: { url?: string; configurationRequired?: boolean }; totals?: { totalSek: number } };
    if (response.status === 401) setMessage("Logga in med ChatGPT för att fortsätta till betalning.");
    else if (!response.ok) setMessage(data.error ?? "Det gick inte att skapa ordern.");
    else if (data.payment?.url) window.location.href = data.payment.url;
    else setMessage(`Ordern är skapad. Stripe behöver konfigureras innan betalningen kan slutföras. Ordervärde: ${data.totals?.totalSek ?? 0} kr.`);
    setLoading(false);
  }
  return <PageShell><section className="subpage-hero"><p className="eyebrow">{companyId ? "Företagscheckout" : "Checkout"}</p><h1>Din utbildning<br />börjar här.</h1><p>Varje köpt plats skapar ett separat enrollment. Progress och certifikat hålls åtskilda från tidigare genomföranden.</p></section><section className="section checkout-section"><form className="checkout-form" onSubmit={submit}><label>Antal platser<input type="number" min="1" max="10000" value={quantity} onChange={(event) => setQuantity(Number(event.target.value))} /></label>{companyId && <label>Betalsätt<select value={paymentMethod} onChange={(event) => setPaymentMethod(event.target.value as "stripe" | "invoice")}><option value="stripe">Kort / Apple Pay / Google Pay</option><option value="invoice">Faktura</option></select></label>}<label>Rabattkod <span>valfritt</span><input value={discountCode} onChange={(event) => setDiscountCode(event.target.value)} placeholder="SOMMAR20" /></label><button className="button button-dark" type="submit" disabled={loading}>{loading ? "Skapar order..." : paymentMethod === "invoice" ? "Skicka fakturaförfrågan →" : "Fortsätt till säker betalning →"}</button>{message && <p className="checkout-message" role="status">{message}</p>}</form><aside className="checkout-summary"><p className="eyebrow">Vald utbildning</p><h2>{courseLabel}</h2><p>Kursmaterialet öppnas först när betalningen är bekräftad server-side.</p><ul><li>Digital kursmotor</li><li>Quiz och slutprov</li><li>Certifiering enligt kursens krav</li></ul></aside></section></PageShell>;
}
