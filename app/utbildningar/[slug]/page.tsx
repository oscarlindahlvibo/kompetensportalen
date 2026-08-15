/* eslint-disable @next/next/no-html-link-for-pages, @next/next/no-img-element */
import { eq } from "drizzle-orm";
import { notFound } from "next/navigation";
import { PageShell } from "@/app/components/site-chrome";
import CourseInterest from "@/app/components/course-interest";
import { getDb } from "@/db";
import { courses } from "@/db/schema";
import { ensureApvCatalog } from "@/lib/catalog";
import { effectiveCoursePrice } from "@/lib/platform";

export const dynamic = "force-dynamic";

export default async function GenericCoursePage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const db = getDb();
  await ensureApvCatalog(db);
  const course = (await db.select().from(courses).where(eq(courses.slug, slug)).limit(1))[0];
  if (!course || course.status === "draft" || course.status === "archived") notFound();
  const published = course.status === "published";
  const price = effectiveCoursePrice(course, course.basePriceSek);
  return <PageShell><section className="course-detail-hero generic-course-hero"><div className="course-detail-copy"><a className="back-link" href="/utbildningar">← Alla utbildningar</a><div className="course-tags">{parseTags(course.tagsJson).map((tag) => <span key={tag}>{tag}</span>)}</div><h1>{course.name}</h1><p>{course.fullDescription}</p><div className="course-detail-facts"><span><strong>{Math.round(course.estimatedMinutes / 60)} h</strong> uppskattad tid</span><span><strong>{course.validityMonths ? `${Math.round(course.validityMonths / 12)} år` : "-"}</strong> giltighet</span><span><strong>{course.id06Enabled ? "ID06" : "Digital"}</strong> registrering</span></div></div><div className="purchase-card"><div className="purchase-art"><span>{course.category}</span><b>{course.competenceCode ?? "KURS"}</b></div><div className="purchase-body"><div className="purchase-price"><span>{published ? "Pris per deltagare" : "Status"}</span><strong>{published ? `${price.toLocaleString("sv-SE")} kr` : "Kommer snart"}</strong>{published && course.campaignPriceSek !== null && <small>Ordinarie pris {course.basePriceSek.toLocaleString("sv-SE")} kr</small>}</div><p>{published ? "Efter bekräftad betalning skapas ett eget enrollment. Kursmaterialet blir då tillgängligt på Mina sidor." : "Lämna din e-post så meddelar vi dig när utbildningen släpps."}</p>{published ? <a className="button button-dark full-button" href={`/checkout?course=${encodeURIComponent(course.slug)}`}>Fortsätt till köp <span>→</span></a> : <CourseInterest courseId={course.id} />}</div></div></section><section className="section detail-content"><div><p className="eyebrow">Om utbildningen</p><h2>Byggd för dokumenterad kompetens.</h2><p>{course.fullDescription}</p></div><div className="detail-list"><div><span>01</span><strong>Strukturerat kursmaterial</strong><p>Text, video, bilder och dokument i kursmotorn.</p></div><div><span>02</span><strong>Progress och examination</strong><p>Varje genomförande sparas separat och går att följa upp.</p></div><div><span>03</span><strong>Certifiering</strong><p>{course.id06Enabled ? "Godkända krav går vidare till ID06-flödet." : "Certifikat kan utfärdas efter kursens krav."}</p></div></div></section>{course.id06Enabled && <section className="course-accreditation"><img src="/brand/id06-accredited-2026.jpg" alt="ID06 Kompetensdatabas - Ackrediterad kompetensregistrator 2026" /><div><p className="eyebrow">ID06</p><h2>Registrering hanteras efter godkänd utbildning.</h2><p>Efter godkänt slutprov och verifierad identitet kan kompetensen föras vidare till ID06 enligt aktuellt registreringsflöde.</p></div></section>}</PageShell>;
}

function parseTags(value: string) { try { return JSON.parse(value) as string[]; } catch { return []; } }
