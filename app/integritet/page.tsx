import { PageShell } from "@/app/components/site-chrome";

export default function PrivacyPage() {
  return <PageShell><section className="subpage-hero legal-hero"><p className="eyebrow">Juridik</p><h1>Integritet</h1><p>Så hanterar Kompetensportalen personuppgifter, utbildningshistorik och certifikat.</p></section><section className="section legal-content"><h2>Personuppgifter</h2><p>Vi behandlar de uppgifter som behövs för konto, betalning, utbildning, certifikat och eventuell ID06-hantering. Känsliga uppgifter skyddas med begränsad åtkomst.</p><h2>Utbildningshistorik</h2><p>Dokumentation som måste sparas av avtals-, revisions- eller kompetensskäl raderas inte automatiskt när ett konto avslutas.</p><h2>Dina rättigheter</h2><p>Du kan begära registerutdrag, rättelse och radering där lagen tillåter. Kontakta oss för frågor om behandlingen.</p></section></PageShell>;
}
