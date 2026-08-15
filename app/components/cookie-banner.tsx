"use client";

import { useState, useSyncExternalStore } from "react";

const cookieListeners = new Set<() => void>();
const subscribe = (listener: () => void) => { cookieListeners.add(listener); return () => cookieListeners.delete(listener); };
const snapshot = () => typeof document !== "undefined" && !document.cookie.includes("kp_cookie_choice");
const serverSnapshot = () => false;

export default function CookieBanner() {
  const [hidden, setHidden] = useState(false);
  const hasNoChoice = useSyncExternalStore(subscribe, snapshot, serverSnapshot);
  const visible = hasNoChoice && !hidden;
  async function choose(choice: "accepted" | "declined") { document.cookie = `kp_cookie_choice=${choice}; Max-Age=31536000; Path=/; SameSite=Lax`; setHidden(true); cookieListeners.forEach((listener) => listener()); await fetch("/api/privacy/consents", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ consentType: "cookies", policyVersion: "2026-01", granted: choice === "accepted" }) }).catch(() => undefined); }
  if (!visible) return null;
  return <aside className="cookie-banner" aria-label="Cookieinställningar"><div><strong>Cookies och integritet</strong><p>Vi använder nödvändiga cookies för inloggning och säker drift. Valet sparas i ett år.</p></div><div className="cookie-actions"><button className="button button-light" type="button" onClick={() => void choose("declined")}>Endast nödvändiga</button><button className="button button-dark" type="button" onClick={() => void choose("accepted")}>Acceptera</button></div></aside>;
}
