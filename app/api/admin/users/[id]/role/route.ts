import { and, count, eq } from "drizzle-orm";
import { getDb } from "@/db";
import { auditLogs, users } from "@/db/schema";
import { ensureDbUser, requireMutationIdentity, requirePermission, requestMetadata } from "@/lib/server-auth";
import { canChangeSuperAdminRole, type PlatformRole } from "@/lib/platform";

export const dynamic = "force-dynamic";

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  const identity = await requireMutationIdentity(request);
  if (identity instanceof Response) return identity;
  const { id } = await context.params;
  const body = await request.json() as { role?: PlatformRole };
  const validRoles: PlatformRole[] = ["super_admin", "course_admin", "certification_admin", "customer_support", "company_admin", "participant"];
  if (!body.role || !validRoles.includes(body.role)) return Response.json({ error: "invalid_role" }, { status: 400 });
  const db = getDb();
  const actor = await ensureDbUser(db, identity);
  requirePermission(actor.role, "user:role_write");
  const target = (await db.select().from(users).where(eq(users.id, id)).limit(1))[0];
  if (!target) return Response.json({ error: "user_not_found" }, { status: 404 });
  if (target.role === "super_admin" && body.role !== "super_admin") {
    const activeSuperAdmins = await db
      .select({ value: count() })
      .from(users)
      .where(and(eq(users.role, "super_admin"), eq(users.status, "active")));
    if (!canChangeSuperAdminRole(target.role, body.role, activeSuperAdmins[0]?.value ?? 0))
      return Response.json({ error: "last_super_admin_cannot_be_demoted" }, { status: 409 });
  }
  const updatedAt = new Date().toISOString();
  await db.update(users).set({ role: body.role, updatedAt }).where(eq(users.id, id));
  const metadata = await requestMetadata();
  await db.insert(auditLogs).values({ id: crypto.randomUUID(), actorUserId: actor.id, targetType: "user", targetId: id, action: "role_changed", beforeJson: JSON.stringify({ role: target.role }), afterJson: JSON.stringify({ role: body.role }), ipHash: metadata.ip, userAgent: metadata.userAgent });
  return Response.json({ ok: true, userId: id, role: body.role });
}
