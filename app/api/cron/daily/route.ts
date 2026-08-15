import { getDb } from "@/db";
import { runtimeEnv } from "@/lib/runtime-env";
import { runDailyMaintenance } from "@/lib/maintenance";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const expected = process.env.CRON_SECRET ?? String(runtimeEnv().CRON_SECRET ?? "");
  const supplied = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? request.headers.get("x-cron-secret");
  if (!expected || supplied !== expected) return Response.json({ error: "unauthorized" }, { status: 401 });
  const result = await runDailyMaintenance(getDb(), runtimeEnv());
  return Response.json({ ok: true, result });
}
