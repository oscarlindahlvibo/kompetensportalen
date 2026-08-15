/* eslint-disable @next/next/no-img-element */
import { PageShell } from "@/app/components/site-chrome";

export const dynamic = "force-dynamic";

export default function AboutPage() {
  return (
    <PageShell>
      <section className="subpage-hero">
        <p className="eyebrow">Om Kompetensportalen</p>
        <h1>Kompetens som<br />går att lita på.</h1>
        <p>
          Kompetensportalen är WPE Sweden AB:s plattform för digital utbildning,
          dokumenterad kompetens och enklare uppföljning i arbetslivet.
        </p>
      </section>
      <section className="section detail-content">
        <div>
          <p className="eyebrow">Vårt fokus</p>
          <h2>Utbildning ska vara enkel att genomföra och möjlig att följa upp.</h2>
        </div>
        <div className="detail-list">
          <div><span>01</span><strong>För arbetslivet</strong><p>Utbildningar för bygg, entreprenad, industri, transport, infrastruktur och arbetsmiljö.</p></div>
          <div><span>02</span><strong>Spårbart från köp till certifikat</strong><p>Varje genomförande, kursversion, provresultat och giltighet sparas separat.</p></div>
          <div><span>03</span><strong>Redo för företag</strong><p>Företag kan köpa platser, tilldela deltagare och följa kompetens i en samlad matris.</p></div>
        </div>
      </section>
      <section className="course-accreditation">
        <img src="/brand/id06-accredited-2026.jpg" alt="ID06 Kompetensdatabas - Ackrediterad kompetensregistrator 2026" />
        <div><p className="eyebrow">WPE Sweden AB</p><h2>Första kursen är Arbete på väg APV 1.1–1.3.</h2><p>WPE Sweden AB är ackrediterad kompetensregistrator för den aktuella kompetensen. Registrering sker efter genomförd utbildning, godkänt slutprov och verifierad identitet enligt gällande krav.</p></div>
      </section>
      <section className="section checkout-section">
        <div><p className="eyebrow">Kontakt</p><h2>Vill du veta mer?</h2><p>Besök kontaktsidan för frågor om utbildningar, företagslösningar eller registrering.</p></div>
        <a className="button button-dark" href="/kontakt">Kontakta oss <span>→</span></a>
      </section>
    </PageShell>
  );
}
