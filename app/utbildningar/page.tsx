import { inArray } from "drizzle-orm";
import { PageShell } from "@/app/components/site-chrome";
import CourseInterest from "@/app/components/course-interest";
import AddToCart from "@/app/components/add-to-cart";
import { getDb } from "@/db";
import { courses } from "@/db/schema";
import { ensureApvCatalog } from "@/lib/catalog";
import { effectiveCoursePrice } from "@/lib/platform";

export const dynamic = "force-dynamic";

export default async function CoursesPage() {
  const db = getDb();
  await ensureApvCatalog(db);
  const rows = await db.select().from(courses).where(inArray(courses.status, ["published", "coming_soon"]));
  return <PageShell>
    <section className="subpage-hero"><p className="eyebrow">Utbildningar</p><h1>Kompetens som<br />följer med dig.</h1><p>Välj en utbildning, köp din plats och genomför kursen i din egen takt. Allt sparas i ditt personliga enrollment.</p></section>
    <section className="section catalog-page"><div className="catalog-heading"><div><p className="eyebrow">Kurskatalog</p><h2>Aktuella utbildningar</h2></div><span>{String(rows.length).padStart(2, "0")} utbildningar</span></div><div className="course-grid">{rows.map((course, index) => { const tags = parseTags(course.tagsJson); const published = course.status === "published"; const price = effectiveCoursePrice(course, course.basePriceSek); return <article className={`course-card ${index === 0 ? "featured" : ""}`} key={course.id}><div className={`course-art art-${(index % 3) + 1}`}><span>{published ? "ONLINE" : "KOMMER SNART"}</span><b>{String(index + 1).padStart(2, "0")}</b></div><div className="course-body"><div className="course-tags">{tags.map((tag) => <span key={tag}>{tag}</span>)}</div><h3>{course.name}</h3><p>{published ? course.shortDescription : "Utbildningen släpps snart. Anmäl intresse så hör vi av oss."}</p><div className="course-meta"><span>{Math.round(course.estimatedMinutes / 60)} h</span><span>{course.validityMonths ? `${Math.round(course.validityMonths / 12)} år` : "Varierar"}</span><strong>{price.toLocaleString("sv-SE")} kr</strong></div>{published ? <><a className="button button-dark" href={`/utbildningar/${course.slug === "arbete-pa-vag-apv-1-1-3" ? "apv-1-1-3" : course.slug}`}>Läs om utbildningen <span>→</span></a><AddToCart courseSlug={course.slug} name={course.name} /></> : <CourseInterest courseId={course.id} />}</div></article>; })}</div><div className="locked-note"><span className="lock-icon">▣</span><span><strong>Kursinnehåll är skyddat.</strong> Lektioner, quiz och slutprov öppnas först för deltagare med aktivt enrollment.</span></div></section>
  </PageShell>;
}

function parseTags(value: string) {
  try { return JSON.parse(value) as string[]; } catch { return []; }
}
