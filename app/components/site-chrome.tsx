/* eslint-disable @next/next/no-html-link-for-pages, @next/next/no-img-element */
import CookieBanner from "@/app/components/cookie-banner";

export async function SiteHeader() {
  return (
    <header className="site-header">
      <a className="brand" href="/" aria-label="Kompetensportalen startsida">
        <img className="brand-logo" src="/brand/kompetensportalen.jpg" alt="Kompetensportalen.se" />
      </a>
      <nav aria-label="Huvudnavigation">
        <a href="/utbildningar">Utbildningar</a>
        <a href="/foretag">För företag</a>
        <a href="/om-oss">Om oss</a>
        <a href="/kontakt">Kontakt</a>
        <a href="/mina-sidor">Mina sidor</a>
        <a href="/cart">Varukorg</a>
      </nav>
      <div className="header-actions">
        <a className="header-link" href="/utbildningar">Se utbildningar <span>→</span></a>
        <a className="header-account" href="/login">Logga in</a>
      </div>
    </header>
  );
}

export function SiteFooter() {
  return (
    <footer>
      <div className="footer-brand"><img className="footer-logo" src="/brand/kompetensportalen.jpg" alt="Kompetensportalen.se" /></div>
      <p>Digital utbildning och dokumenterad kompetens för ett säkrare arbetsliv.</p>
      <div className="footer-links"><a href="/utbildningar">Utbildningar</a><a href="/foretag">Företag</a><a href="/om-oss">Om oss</a><a href="/kontakt">Kontakt</a><a href="/faq">FAQ</a><a href="/villkor">Köpvillkor</a><a href="/integritet">Integritet</a></div>
      <small>© 2026 WPE Sweden AB</small>
    </footer>
  );
}

export function PageShell({ children }: { children: React.ReactNode }) {
  return <main><SiteHeader />{children}<SiteFooter /><CookieBanner /></main>;
}
