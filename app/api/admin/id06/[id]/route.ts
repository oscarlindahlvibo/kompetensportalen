import { mutationChanges } from "@/lib/db-compat";
import { and, eq } from "drizzle-orm";
import { getDb } from "@/db";
import { auditLogs, id06Registrations, users } from "@/db/schema";
import { assertId06Transition, type Id06State } from "@/lib/platform";
import { requireMutationIdentity, requirePermission, requestMetadata } from "@/lib/server-auth";

export const dynamic = "force-dynamic";

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const actor = await requireMutationIdentity(request);
  if (actor instanceof Response) return actor;
  const { id } = await context.params;
  const body = (await request.json()) as {
    status?: Id06State;
    id06Reference?: string;
    errorMessage?: string;
  };
  if (!body.status)
    return Response.json({ error: "status_required" }, { status: 400 });
  const db = getDb();
  const actorRows = await db
    .select()
    .from(users)
    .where(eq(users.email, actor.email))
    .limit(1);
  requirePermission(
    (actorRows[0]?.role ?? "participant") as Parameters<
      typeof requirePermission
    >[0],
    "id06:write",
  );
  const currentRows = await db
    .select()
    .from(id06Registrations)
    .where(eq(id06Registrations.id, id))
    .limit(1);
  const current = currentRows[0];
  if (!current)
    return Response.json(
      { error: "id06_registration_not_found" },
      { status: 404 },
    );
  try {
    assertId06Transition(current.status as Id06State, body.status);
  } catch {
    return Response.json(
      {
        error: "invalid_id06_transition",
        currentStatus: current.status,
        requestedStatus: body.status,
      },
      { status: 409 },
    );
  }
  const id06Reference = body.id06Reference?.trim() || current.id06Reference;
  if (body.status === "registered" && !id06Reference)
    return Response.json({ error: "id06_reference_required" }, { status: 400 });
  if (body.status === "failed" && !body.errorMessage?.trim())
    return Response.json(
      { error: "id06_error_message_required" },
      { status: 400 },
    );
  const now = new Date().toISOString();
  const metadata = await requestMetadata();
  const claim = await db
    .update(id06Registrations)
    .set({
      status: body.status,
      id06Reference,
      errorMessage: body.status === "failed" ? body.errorMessage!.trim() : null,
      handledByUserId: actorRows[0]?.id ?? null,
      submittedAt: body.status === "submitted" ? now : current.submittedAt,
      registeredAt: body.status === "registered" ? now : current.registeredAt,
    })
    .where(and(eq(id06Registrations.id, id), eq(id06Registrations.status, current.status)))
    ;
  if ((mutationChanges(claim) ?? 0) !== 1)
    return Response.json(
      { error: "id06_registration_changed", currentStatus: current.status },
      { status: 409 },
    );
  await db
    .insert(auditLogs)
    .values({
      id: crypto.randomUUID(),
      actorUserId: actorRows[0]?.id ?? null,
      targetType: "id06_registration",
      targetId: id,
      action: "status_changed",
      beforeJson: JSON.stringify({ status: current.status }),
      afterJson: JSON.stringify({ status: body.status }),
      ipHash: metadata.ip,
      userAgent: metadata.userAgent,
    });
  return Response.json({ ok: true, status: body.status });
}
