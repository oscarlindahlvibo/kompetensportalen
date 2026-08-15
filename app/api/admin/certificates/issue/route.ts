import { eq } from "drizzle-orm";
import { getDb } from "@/db";
import { users } from "@/db/schema";
import { issueCertificateForEnrollment, CertificationError } from "@/lib/certification";
import { requireMutationIdentity, requirePermission, requestMetadata } from "@/lib/server-auth";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const identity = await requireMutationIdentity(request);
  if (identity instanceof Response) return identity;
  const body = (await request.json()) as { enrollmentId?: string };
  if (!body.enrollmentId) return Response.json({ error: "enrollment_required" }, { status: 400 });
  const db = getDb();
  const admin = (await db.select().from(users).where(eq(users.email, identity.email)).limit(1))[0];
  requirePermission((admin?.role ?? "participant") as Parameters<typeof requirePermission>[0], "certification:write");
  try {
    const metadata = await requestMetadata();
    const result = await issueCertificateForEnrollment(db, body.enrollmentId, admin?.id ?? null, metadata);
    return Response.json({ ...result, id06: result.certificate ? undefined : null }, { status: result.idempotent ? 200 : 201 });
  } catch (error) {
    if (error instanceof CertificationError) return Response.json({ error: error.code }, { status: error.status });
    throw error;
  }
}
