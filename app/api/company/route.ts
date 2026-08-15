import { eq } from "drizzle-orm";
import { getDb } from "@/db";
import { auditLogs, companies, companyMembers, users } from "@/db/schema";
import { ensureDbUser, requireApiIdentity, requestMetadata } from "@/lib/server-auth";
import { rateLimit } from "@/lib/rate-limit";
import { sameOriginGuard } from "@/lib/request-security";

export const dynamic = "force-dynamic";

type CompanyInput = { organizationNumber?: string; name?: string; invoiceAddress?: string; contactEmail?: string };

export async function GET() {
  const identity = await requireApiIdentity();
  if (identity instanceof Response) return identity;
  const db = getDb();
  const user = await ensureDbUser(db, identity);
  const rows = await db.select({ company: companies, membership: companyMembers }).from(companyMembers).innerJoin(companies, eq(companies.id, companyMembers.companyId)).where(eq(companyMembers.userId, user.id));
  return Response.json({ companies: rows.map(({ company, membership }) => ({ ...company, role: membership.role })) });
}

export async function POST(request: Request) {
  const originError = sameOriginGuard(request);
  if (originError) return originError;
  const limited = rateLimit(request, "company-create", 5);
  if (limited) return limited;
  const identity = await requireApiIdentity();
  if (identity instanceof Response) return identity;
  const input = await request.json().catch(() => ({})) as CompanyInput;
  const organizationNumber = input.organizationNumber?.replace(/\s+/g, "").trim();
  const name = input.name?.trim();
  const contactEmail = (input.contactEmail?.trim() || identity.email).toLowerCase();
  if (!organizationNumber || organizationNumber.length < 6 || !name || name.length < 2 || !contactEmail.includes("@")) return Response.json({ error: "company_fields_required" }, { status: 400 });
  const db = getDb();
  const user = await ensureDbUser(db, identity);
  const existing = await db.select().from(companies).where(eq(companies.organizationNumber, organizationNumber)).limit(1);
  if (existing[0]) return Response.json({ error: "organization_number_already_exists" }, { status: 409 });
  const companyId = crypto.randomUUID();
  const memberId = crypto.randomUUID();
  const company = { id: companyId, organizationNumber, name, invoiceAddress: input.invoiceAddress?.trim() || null, contactEmail, invoicePurchaseEnabled: false, activateInvoiceLicensesImmediately: false };
  try {
    await db.insert(companies).values(company);
    await db.insert(companyMembers).values({ id: memberId, companyId, userId: user.id, role: "admin" });
    if (user.role === "participant") await db.update(users).set({ role: "company_admin", updatedAt: new Date().toISOString() }).where(eq(users.id, user.id));
    const metadata = await requestMetadata();
    await db.insert(auditLogs).values({ id: crypto.randomUUID(), actorUserId: user.id, targetType: "company", targetId: companyId, action: "company.created", beforeJson: null, afterJson: JSON.stringify({ name, organizationNumber }), ipHash: metadata.ip, userAgent: metadata.userAgent });
  } catch {
    return Response.json({ error: "company_creation_failed" }, { status: 409 });
  }
  return Response.json({ company }, { status: 201 });
}
