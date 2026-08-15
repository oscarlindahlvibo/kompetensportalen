/* eslint-disable @next/next/no-img-element, @next/next/no-html-link-for-pages */
import { PageShell } from "@/app/components/site-chrome";
import CourseInterest from "@/app/components/course-interest";
import { getDb } from "@/db";
import { courses } from "@/db/schema";
import { ensureApvCatalog } from "@/lib/catalog";
import { effectiveCoursePrice } from "@/lib/platform";
import { inArray } from "drizzle-orm";

export const dynamic = "force-dynamic";

const benefits = [
  ["Spårbart", "Kursversion, provresultat och certifikat sparas för varje genomförande."],
  ["För företag", "Köp platser, tilldela medarbetare och följ kompetenser från ett konto."],
  ["ID06-redo", "Identitetskontroll och ID06-status finns med när utbildningen kräver det."],
];

const steps = [
  ["01", "Välj utbildning", "Jämför kursens innehåll, pris och giltighet."],
  ["02", "Betala eller tilldela", "Efter betald order aktiveras ett personligt enrollment."],
  ["03", "Genomför och certifiera", "Din progress, examination och certifikat hanteras samlat."],
];

export default async function Home() {
  const db = getDb();
  await ensureApvCatalog(db);
  const coursesInCatalog = await db.select().from(courses).where(inArray(courses.status, ["published", "coming_soon"])).orderBy(courses.createdAt);
  const apv = coursesInCatalog.find((course) => course.slug === "arbete-pa-vag-apv-1-1-3") ?? coursesInCatalog[0];

  return (
    <PageShell>

      <section className="hero" id="top">
        <div className="hero-copy">
          <p className="eyebrow">Digital kompetens för arbetslivet</p>
          <h1>Utbildningar som gör jobbet säkrare.</h1>
          <p className="hero-lead">
            Köp utbildning online, genomför den i din egen takt och få dokumenterad kompetens när du är klar.
          </p>
          <div className="hero-actions">
            <a className="button button-primary" href="/utbildningar">Se utbildningar <span>→</span></a>
            <a className="text-link" href="/foretag">För företag <span>↗</span></a>
          </div>
          <div className="hero-note"><span className="status-dot" /> Svensk utbildningsplattform från WPE Sweden AB</div>
        </div>
        <div className="hero-visual" aria-label="Illustration av digital utbildning">
          <div className="visual-label">KOMPETENSPORTALEN / 01</div>
          <div className="visual-shape shape-one" />
          <div className="visual-shape shape-two" />
          <div className="visual-card">
            <span>APV 1.1-1.3</span>
            <strong>Arbete på väg</strong>
            <small>Digital utbildning · ID06</small>
            <div className="visual-line"><i /></div>
            <small>Certifikat efter godkänt slutprov</small>
          </div>
          <div className="visual-index">01<span>/</span>03</div>
        </div>
      </section>

      <section className="trust-strip">
        <span>För bygg</span><span>För entreprenad</span><span>För industri</span><span>För transport</span><span>För infrastruktur</span>
      </section>

      <section className="accreditation-strip" aria-label="ID06 ackreditering">
        <div className="accreditation-copy"><p className="eyebrow">Ackrediterad registrator</p><h2>Kompetens som kan registreras i ID06.</h2><p>WPE Sweden AB är ackrediterad kompetensregistrator 2026 för den aktuella Arbete på väg-kompetensen.</p></div>
        <img src="/brand/id06-accredited-2026.jpg" alt="ID06 Kompetensdatabas - Ackrediterad kompetensregistrator 2026" />
      </section>

      <section className="section courses-section" id="utbildningar">
        <div className="section-intro">
          <div>
            <p className="eyebrow">Utbildningar</p>
            <h2>Välj din utbildning</h2>
          </div>
          <p>Du ser kursens upplägg och villkor innan köp. Själva kursmaterialet blir tillgängligt först när din order är betald eller en plats har tilldelats dig.</p>
        </div>
        <div className="course-grid">
          {coursesInCatalog.slice(0, 6).map((course, index) => {
            const tags = parseTags(course.tagsJson);
            const published = course.status === "published";
            const price = effectiveCoursePrice(course, course.basePriceSek);
            return (
            <article className={`course-card ${index === 0 ? "featured" : ""}`} key={course.id}>
              <div className="course-art"><span>{published ? "ONLINE" : "KOMMER SNART"}</span><b>{String(index + 1).padStart(2, "0")}</b></div>
              <div className="course-body">
                <div className="course-tags">{tags.map((tag) => <span key={tag}>{tag}</span>)}</div>
                <h3>{course.name}</h3>
                <p>{published ? course.shortDescription : "Lämna din e-post så meddelar vi dig när utbildningen släpps."}</p>
                <div className="course-meta"><span>{course.estimatedMinutes} min</span><span>{course.validityMonths ? `${Math.round(course.validityMonths / 12)} års giltighet` : "Varierar"}</span><strong>{price.toLocaleString("sv-SE")} kr</strong></div>
                {published ? <a className="button button-dark" href={`/utbildningar/${course.slug === "arbete-pa-vag-apv-1-1-3" ? "apv-1-1-3" : course.slug}`}>Läs om utbildningen <span>→</span></a> : <CourseInterest courseId={course.id} />}
              </div>
            </article>
            );
          })}
        </div>
        <div className="locked-note"><span className="lock-icon">▣</span><span><strong>Kursinnehåll är skyddat.</strong> Lektioner, quiz och slutprov öppnas först för den deltagare som har ett aktivt enrollment.</span></div>
      </section>

      <section className="section dark-section" id="sa-fungerar-det">
        <div className="section-intro dark-intro"><div><p className="eyebrow">Enkelt från start till certifikat</p><h2>Allt du behöver.<br />På ett ställe.</h2></div><p>Kompetensportalen håller ihop köp, utbildning, examination och dokumentation utan att blanda ihop olika genomföranden.</p></div>
        <div className="steps-grid">{steps.map(([number, title, text]) => <div className="step" key={number}><span>{number}</span><h3>{title}</h3><p>{text}</p></div>)}</div>
      </section>

      <section className="section benefits-section">
        <div className="section-intro"><div><p className="eyebrow">Byggt för verkligheten</p><h2>Tryggt för dig.<br />Enkelt för admin.</h2></div><p>Oavsett om du köper en plats till dig själv eller hanterar hundratals medarbetare finns samma tydliga historik och kontroll.</p></div>
        <div className="benefit-grid">{benefits.map(([title, text]) => <article key={title}><span className="benefit-number">0{benefits.findIndex((item) => item[0] === title) + 1}</span><h3>{title}</h3><p>{text}</p></article>)}</div>
      </section>

      <section className="company-section" id="foretag">
        <div><p className="eyebrow">Företagslösningar</p><h2>Kompetens på<br />hela arbetsplatsen.</h2><p>Köp flera platser, tilldela dem till anställda och få en samlad bild av utbildningar, giltighet och förnyelser.</p><a className="button button-primary" href="/foretag">Se företagslösningar <span>→</span></a></div>
        <div className="company-stat"><span>20</span><small>platser köpta</small><div className="stat-bar"><i /></div><p>13 tilldelade · 7 lediga</p></div>
      </section>

      <section className="checkout-section" id="kop">
        <div><p className="eyebrow">{apv?.status === "published" ? "Redo att börja?" : "Kommer snart"}</p><h2>Arbete på väg<br />APV 1.1-1.3</h2><p>{apv?.status === "published" ? "Betala säkert online. När betalningen är bekräftad skapas ditt personliga enrollment och kursen låses upp på Mina sidor." : "Kursen förbereds för publicering. Lämna din e-post så meddelar vi dig när utbildningen är kvalitetssäkrad och tillgänglig."}</p></div>
        <div className="buy-panel">{apv?.status === "published" ? <><div className="buy-row"><span>Utbildning</span><strong>{apv.basePriceSek.toLocaleString("sv-SE")} kr</strong></div><div className="buy-row"><span>Giltighet</span><strong>{apv.validityMonths ? `${Math.round(apv.validityMonths / 12)} år` : "-"}</strong></div><a className="button button-dark full-button" href={`/utbildningar/${apv.slug === "arbete-pa-vag-apv-1-1-3" ? "apv-1-1-3" : apv.slug}`}>Se kursen och köp <span>→</span></a><small>Stripe Checkout · Kort, Apple Pay och Google Pay där tillgängligt</small></> : apv ? <><div className="buy-row"><span>Status</span><strong>Kommer snart</strong></div><CourseInterest courseId={apv.id} /></> : <p>Ingen utbildning är publicerad ännu.</p>}</div>
      </section>
    </PageShell>
  );
}

function parseTags(value: string) {
  try { return JSON.parse(value) as string[]; } catch { return []; }
}
