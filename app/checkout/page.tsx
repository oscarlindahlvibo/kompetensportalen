import { Suspense } from "react";
import CheckoutClient from "@/app/checkout/checkout-client";

export const dynamic = "force-dynamic";

export default function CheckoutPage() {
  return <Suspense fallback={<main className="auth-page">Laddar checkout...</main>}><CheckoutClient /></Suspense>;
}
