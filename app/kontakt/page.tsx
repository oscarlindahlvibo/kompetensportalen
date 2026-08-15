import { PageShell } from "@/app/components/site-chrome";
import ContactForm from "@/app/components/contact-form";

export default function ContactPage() {
  return <PageShell><section className="subpage-hero contact-hero"><p className="eyebrow">Kontakt</p><h1>Vi hjälper dig<br />komma igång.</h1><p>Frågor om utbildningar, företagsplatser eller migreringen från Odoo? Hör av dig så återkommer vi.</p></section><section className="section contact-grid"><div><p className="eyebrow">WPE Sweden AB</p><h2>Prata med oss</h2><p>Vi hjälper företag och deltagare att hitta rätt utbildning och upplägg.</p><a className="contact-link" href="mailto:info@wpesweden.se">info@wpesweden.se <span>↗</span></a></div><ContactForm /></section></PageShell>;
}
