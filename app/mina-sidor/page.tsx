/* eslint-disable @next/next/no-html-link-for-pages */
import { requireChatGPTUser } from "@/app/chatgpt-auth";
import { PageShell } from "@/app/components/site-chrome";
import { getDb } from "@/db";
import { certificates, courses, enrollments } from "@/db/schema";
import { ensureDbUser } from "@/lib/server-auth";
import { enrollmentDisplayState } from "@/lib/platform";
import { desc, eq } from "drizzle-orm";

export const dynamic = "force-dynamic";

export default async function MyPages() {
  const user = await requireChatGPTUser("/mina-sidor");
  const db = getDb();
  const dbUser = await ensureDbUser(db, user);
  const rows = await db.select({ enrollment: enrollments, course: courses, certificate: certificates }).from(enrollments)
    .innerJoin(courses, eq(courses.id, enrollments.courseId))
    .leftJoin(certificates, eq(certificates.enrollmentId, enrollments.id))
    .where(eq(enrollments.userId, dbUser.id))
    .orderBy(desc(enrollments.createdAt));
  return <PageShell><section className="subpage-hero account-hero"><p className="eyebrow">Mina sidor</p><h1>Välkommen,<br />{user.displayName}.</h1><p>Här visas dina separata kursgenomföranden. Historiska versioner och certifikat påverkas inte när du förnyar en utbildning.</p></section><section className="section account-list"><div className="section-heading"><div><p className="eyebrow">Dina utbildningar</p><h2>{rows.length ? `${rows.length} utbildning${rows.length === 1 ? "" : "ar"}` : "Inga aktiva utbildningar ännu"}</h2></div><div><a className="text-link" href="/mina-sidor/orderer">Orderhistorik <span>→</span></a><br /><a className="text-link" href="/utbildningar">Köp utbildning <span>→</span></a></div></div>{rows.length ? <div className="enrollment-grid">{rows.map(({ enrollment, course, certificate }) => { const state = enrollmentDisplayState(enrollment); const renewal = state === "expired" || state === "expiring"; return <article className="enrollment-card" key={enrollment.id}><div className="enrollment-card-top"><span className="course-status">{state === "completed" ? "Slutförd" : state === "expired" ? "Utgången" : state === "expiring" ? "Snart utgående" : state === "not_started" ? "Ej påbörjad" : "Pågående"}</span><span>Version kopplad</span></div><h3>{course.name}</h3><p>{course.shortDescription}</p><div className="progress-line"><span style={{ width: `${enrollment.progressPercent}%` }} /></div><div className="enrollment-meta"><strong>{enrollment.progressPercent}%</strong><span>Progress</span>{renewal ? <a href={`/utbildningar/${encodeURIComponent(course.slug)}`}>Förnya <span>→</span></a> : <a href={`/utbildning/${enrollment.id}`}>Fortsätt <span>→</span></a>}</div>{certificate && <a className="text-link enrollment-certificate-link" href={`/certifikat/${encodeURIComponent(certificate.verificationCode)}`}>Öppna certifikat <span>→</span></a>}</article>; })}</div> : <div className="account-empty"><div><h2>Din första utbildning börjar här.</h2><p>När en order är betald eller ett företagsenrollment har tilldelats dig blir kursen tillgänglig här. Kursmaterial öppnas först då.</p><a className="button button-dark" href="/utbildningar">Se utbildningar <span>→</span></a></div><div className="account-lock">LÅST TILLS KÖP<br /><span>ENROLLMENT</span></div></div>}</section></PageShell>;
}
