import { eq } from "drizzle-orm";
import { getDb } from "@/db";
import { auditLogs, companies } from "@/db/schema";
import { ensureDbUser, requireApiIdentity, requireMutationIdentity, requirePermission } from "@/lib/server-auth";

export const dynamic = "force-dynamic";

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const identity = await requireApiIdentity();
  if (identity instanceof Response) return identity;
  const { id } = await context.params;
  const db = getDb();
  const actor = await ensureDbUser(db, identity);
  requirePermission(actor.role, "admin:company_write");
  const company = (await db.select().from(companies).where(eq(companies.id, id)).limit(1))[0];
  if (!company) return Response.json({ error: "company_not_found" }, { status: 404 });
  return Response.json({ company });
}

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  const identity = await requireMutationIdentity(request);
  if (identity instanceof Response) return identity;
  const { id } = await context.params;
  const body = await request.json() as { invoicePurchaseEnabled?: boolean; activateInvoiceLicensesImmediately?: boolean; invoiceAddress?: string | null; contactEmail?: string };
  if (body.invoicePurchaseEnabled !== undefined && typeof body.invoicePurchaseEnabled !== "boolean") return Response.json({ error: "invalid_invoice_setting" }, { status: 400 });
  if (body.activateInvoiceLicensesImmediately !== undefined && typeof body.activateInvoiceLicensesImmediately !== "boolean") return Response.json({ error: "invalid_activation_setting" }, { status: 400 });
  if (body.contactEmail !== undefined && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(body.contactEmail.trim())) return Response.json({ error: "invalid_contact_email" }, { status: 400 });
  const db = getDb();
  const actor = await ensureDbUser(db, identity);
  requirePermission(actor.role, "admin:company_write");
  const current = (await db.select().from(companies).where(eq(companies.id, id)).limit(1))[0];
  if (!current) return Response.json({ error: "company_not_found" }, { status: 404 });
  const next = {
    invoicePurchaseEnabled: body.invoicePurchaseEnabled ?? current.invoicePurchaseEnabled,
    activateInvoiceLicensesImmediately: body.activateInvoiceLicensesImmediately ?? current.activateInvoiceLicensesImmediately,
    invoiceAddress: body.invoiceAddress === undefined ? current.invoiceAddress : body.invoiceAddress?.trim() || null,
    contactEmail: body.contactEmail === undefined ? current.contactEmail : body.contactEmail.trim().toLowerCase(),
    updatedAt: new Date().toISOString(),
  };
  await db.update(companies).set(next).where(eq(companies.id, id));
  await db.insert(auditLogs).values({ id: crypto.randomUUID(), actorUserId: actor.id, targetType: "company", targetId: id, action: "company.settings_changed", beforeJson: JSON.stringify({ invoicePurchaseEnabled: current.invoicePurchaseEnabled, activateInvoiceLicensesImmediately: current.activateInvoiceLicensesImmediately, invoiceAddress: current.invoiceAddress, contactEmail: current.contactEmail }), afterJson: JSON.stringify({ invoicePurchaseEnabled: next.invoicePurchaseEnabled, activateInvoiceLicensesImmediately: next.activateInvoiceLicensesImmediately, invoiceAddress: next.invoiceAddress, contactEmail: next.contactEmail }), ipHash: null, userAgent: null });
  return Response.json({ company: { ...current, ...next } });
}
