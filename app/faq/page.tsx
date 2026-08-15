import { PageShell } from "@/app/components/site-chrome";

const questions = [
  ["När får jag tillgång till kursen?", "Efter bekräftad betalning skapas ett eget enrollment och kursmaterialet öppnas på Mina sidor."],
  ["Hur länge gäller en utbildning?", "Giltighetstiden står på kurssidan och kopplas till certifikatet när utbildningen godkänns."],
  ["Kan företaget köpa flera platser?", "Ja. Företag kan köpa kursplatser och tilldela dem till anställda via företagsportalen."],
  ["Registreras kompetensen i ID06?", "För utbildningar med ID06-koppling krävs godkänt slutprov och verifierad identitet innan registreringen kan hanteras."],
  ["Kan jag förnya innan giltighetstiden löper ut?", "Ja. Varje förnyelse skapar ett nytt separat kursgenomförande och påverkar inte tidigare certifikat eller historik."],
  ["Hur verifierar jag ett certifikat?", "Använd verifieringskoden eller QR-länken på certifikatet på vår publika verifieringssida."],
];

export default function FaqPage() {
  return <PageShell><section className="subpage-hero"><p className="eyebrow">Vanliga frågor</p><h1>Svar på det<br />viktigaste.</h1><p>Information om köp, utbildning, certifikat och företagslösningar.</p></section><section className="section faq-list">{questions.map(([question, answer], index) => <details key={question} open={index === 0}><summary><span>{String(index + 1).padStart(2, "0")}</span>{question}<b>+</b></summary><p>{answer}</p></details>)}</section><section className="section faq-cta"><p className="eyebrow">Behöver du hjälp?</p><h2>Vi svarar på dina frågor.</h2><a className="button button-dark" href="/kontakt">Kontakta oss <span>→</span></a></section></PageShell>;
}
