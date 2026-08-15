"use client";

import { useState } from "react";
import { getSupabaseBrowserClient } from "@/lib/supabase-browser";

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const returnTo = typeof window === "undefined" ? "/" : new URLSearchParams(window.location.search).get("return_to") || "/";

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setMessage("");
    try {
      const client = getSupabaseBrowserClient();
      const { error } = await client.auth.signInWithPassword({ email, password });
      if (error) { setMessage(error.message); return; }
      window.location.assign(returnTo.startsWith("/") ? returnTo : "/");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Inloggningen kunde inte genomföras.");
    } finally { setBusy(false); }
  }

  async function sendMagicLink() {
    setBusy(true);
    setMessage("");
    try {
      const client = getSupabaseBrowserClient();
      const { error } = await client.auth.signInWithOtp({ email, options: { emailRedirectTo: `${window.location.origin}/auth/callback?return_to=${encodeURIComponent(returnTo)}` } });
      setMessage(error ? error.message : "En inloggningslänk har skickats till din e-post.");
    } catch (error) { setMessage(error instanceof Error ? error.message : "Länken kunde inte skickas."); }
    finally { setBusy(false); }
  }

  return <main className="auth-page"><div className="auth-panel"><p className="eyebrow">Kompetensportalen.se</p><h1>Logga in</h1><p>Använd ditt konto för att öppna Mina sidor, företagets portal eller administrationen.</p><form className="admin-form" onSubmit={submit}><label>E-post<input type="email" required value={email} onChange={(event) => setEmail(event.target.value)} /></label><label>Lösenord<input type="password" required value={password} onChange={(event) => setPassword(event.target.value)} /></label><button className="button button-dark" disabled={busy}>{busy ? "Arbetar..." : "Logga in"}</button><button className="button button-light" type="button" disabled={busy || !email} onClick={() => void sendMagicLink()}>Skicka engångslänk</button>{message && <p className="admin-message" role="status">{message}</p>}</form></div></main>;
}
