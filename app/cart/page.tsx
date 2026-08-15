import { Suspense } from "react";
import { PageShell } from "@/app/components/site-chrome";
import CartClient from "@/app/cart/cart-client";

export default function CartPage() { return <PageShell><section className="subpage-hero"><p className="eyebrow">Varukorg</p><h1>Dina<br />utbildningar.</h1><p>Samla flera utbildningar och genomför ett gemensamt köp. Kursmaterialet öppnas först efter bekräftad betalning.</p></section><Suspense fallback={<p>Laddar varukorg...</p>}><CartClient /></Suspense></PageShell>; }
