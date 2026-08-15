import { getDb } from "@/db";
import { ensureDbUser, requireMutationIdentity, requirePermission } from "@/lib/server-auth";
import { dispatchQueuedNotifications } from "@/lib/notifications";
import { runtimeEnv } from "@/lib/runtime-env";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const identity = await requireMutationIdentity(request);
  if (identity instanceof Response) return identity;
  const db = getDb();
  const actor = await ensureDbUser(db, identity);
  requirePermission(actor.role, "communication:write");
  const runtime = runtimeEnv() as Parameters<typeof dispatchQueuedNotifications>[1];
  return Response.json(await dispatchQueuedNotifications(db, runtime));
}
