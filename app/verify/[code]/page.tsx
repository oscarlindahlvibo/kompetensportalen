import { eq } from "drizzle-orm";
import { PageShell } from "@/app/components/site-chrome";
import { getDb } from "@/db";
import { certificates, courses } from "@/db/schema";

export const dynamic = "force-dynamic";

export default async function VerifyCertificate({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  const rows = await getDb().select({ certificate: certificates, course: courses }).from(certificates).innerJoin(courses, eq(courses.id, certificates.courseId)).where(eq(certificates.verificationCode, code)).limit(1);
  const record = rows[0];
  const today = new Date().toISOString().slice(0, 10);
  const valid = Boolean(record && record.certificate.status === "issued" && (!record.certificate.validUntil || record.certificate.validUntil.slice(0, 10) >= today));
  return <PageShell><section className="verify-page"><div className={`verify-mark ${valid ? "valid" : "invalid"}`}>{valid ? "✓" : "!"}</div><p className="eyebrow">Certifikatverifiering</p><h1>{valid ? "Certifikatet är giltigt." : "Certifikatet kunde inte verifieras."}</h1>{record ? <div className="verify-facts"><span><small>Utbildning</small><strong>{record.course.name}</strong></span><span><small>Utfärdat</small><strong>{record.certificate.issuedAt}</strong></span><span><small>Giltigt till</small><strong>{record.certificate.validUntil ?? "Tills vidare"}</strong></span><span><small>Certifikatnummer</small><strong>{record.certificate.certificateNumber}</strong></span></div> : <p>Kontrollera verifieringskoden och försök igen.</p>}{record && !valid && record.certificate.status === "issued" && record.certificate.validUntil && <p className="verify-note">Certifikatet har löpt ut.</p>}<p className="verify-note">Verifieringen visar endast nödvändiga uppgifter och ingen privat information om deltagaren.</p></section></PageShell>;
}
