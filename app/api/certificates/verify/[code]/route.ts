import { eq } from "drizzle-orm";
import { getDb } from "@/db";
import { certificates, courses } from "@/db/schema";
import { publicCertificateView } from "@/lib/platform";

export async function GET(_request: Request, context: { params: Promise<{ code: string }> }) {
  const { code } = await context.params;
  const db = getDb();
  const rows = await db.select({ certificate: certificates, course: courses }).from(certificates).innerJoin(courses, eq(courses.id, certificates.courseId)).where(eq(certificates.verificationCode, code)).limit(1);
  const row = rows[0];
  if (!row) return Response.json({ valid: false, error: "certificate_not_found" }, { status: 404 });
  return Response.json(publicCertificateView({ verificationCode: row.certificate.verificationCode, certificateNumber: row.certificate.certificateNumber, courseName: row.course.name, issuedAt: row.certificate.issuedAt, validUntil: row.certificate.validUntil, status: row.certificate.status }));
}
