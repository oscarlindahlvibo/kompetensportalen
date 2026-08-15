import { PageShell } from "@/app/components/site-chrome";

export default function TermsPage() {
  return <PageShell><section className="subpage-hero legal-hero"><p className="eyebrow">Juridik</p><h1>Köpvillkor</h1><p>Information om köp, åtkomst och digitala utbildningar hos Kompetensportalen.se.</p></section><section className="section legal-content"><h2>Digital utbildning</h2><p>Efter bekräftad betalning skapas ett personligt enrollment och tillgång till den köpta kursversionen. Åtkomst är personlig och får inte delas.</p><h2>Certifikat</h2><p>Certifikat utfärdas först när utbildningens obligatoriska moment, examination och eventuella identitetskrav är uppfyllda.</p><h2>Företagsplatser</h2><p>Företagsköp skapar separata platser som företagets administratör tilldelar till deltagare.</p></section></PageShell>;
}
