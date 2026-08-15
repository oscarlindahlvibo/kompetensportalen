/* eslint-disable @next/next/no-img-element */
import { eq } from "drizzle-orm";
import { requireChatGPTUser } from "@/app/chatgpt-auth";
import { PageShell } from "@/app/components/site-chrome";
import { getDb } from "@/db";
import { certificates, courses, courseVersions, profiles, users } from "@/db/schema";
import { headers } from "next/headers";
import QRCode from "qrcode";
import { ensureDbUser } from "@/lib/server-auth";
import { hasPermission } from "@/lib/platform";
import PrintCertificateButton from "@/app/certifikat/print-certificate-button";

export const dynamic = "force-dynamic";

export default async function CertificatePage({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  const identity = await requireChatGPTUser(`/certifikat/${encodeURIComponent(code)}`);
  const db = getDb();
  const viewer = await ensureDbUser(db, identity);
  const row = (await db.select({ certificate: certificates, course: courses, version: courseVersions, participant: users, profile: profiles }).from(certificates).innerJoin(courses, eq(courses.id, certificates.courseId)).innerJoin(courseVersions, eq(courseVersions.id, certificates.courseVersionId)).innerJoin(users, eq(users.id, certificates.userId)).leftJoin(profiles, eq(profiles.userId, certificates.userId)).where(eq(certificates.verificationCode, code)).limit(1))[0];
  if (!row) return <PageShell><section className="verify-page"><h1>Certifikatet kunde inte hittas.</h1></section></PageShell>;
  if (row.certificate.userId !== viewer.id && !hasPermission(viewer.role, "certification:read")) return <PageShell><section className="verify-page"><h1>Du saknar åtkomst till certifikatet.</h1><p>Öppna den publika verifieringssidan om du bara vill kontrollera äktheten.</p></section></PageShell>;
  const requestHeaders = await headers();
  const host = requestHeaders.get("host") ?? "kompetensportalen.se";
  const protocol = requestHeaders.get("x-forwarded-proto") ?? "https";
  const verificationUrl = `${protocol}://${host}/verify/${row.certificate.verificationCode}`;
  const qrDataUrl = await QRCode.toDataURL(verificationUrl, { errorCorrectionLevel: "M", margin: 1, width: 180 });
  const participantName = [row.profile?.firstName, row.profile?.lastName].filter(Boolean).join(" ") || row.participant.email;
  return <PageShell><section className="certificate-page"><img src="/brand/kompetensportalen.jpg" alt="Kompetensportalen.se" /><p className="eyebrow">Digitalt kompetensbevis</p><h1>{participantName}</h1><h2>{row.course.name}</h2><p>Detta certifikat är utfärdat av WPE Sweden AB.</p><div className="certificate-facts"><span>Certifikatnummer<strong>{row.certificate.certificateNumber}</strong></span><span>Kursversion<strong>{row.version.version}</strong></span><span>Utfärdat<strong>{row.certificate.issuedAt.slice(0, 10)}</strong></span><span>Giltigt till<strong>{row.certificate.validUntil ?? "Tills vidare"}</strong></span></div><div className="certificate-verification"><img src={qrDataUrl} alt="QR-kod för certifikatverifiering" /><p className="certificate-code">Verifiera på<br /><strong>/verify/{row.certificate.verificationCode}</strong></p></div>{row.course.id06Enabled && <img className="certificate-accreditation-logo" src="/brand/id06-accredited-2026.jpg" alt="ID06 Kompetensdatabas - Ackrediterad kompetensregistrator 2026" />}<p className="verify-note">Skanna QR-koden eller öppna verifieringssidan. Sidan är anpassad för utskrift som kompetensbevis.</p><PrintCertificateButton /></section></PageShell>;
}
