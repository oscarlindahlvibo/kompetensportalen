import { createClient } from "jsr:@supabase/supabase-js@2";

const schema = "kompetensportalen";
const headers = { "content-type": "application/json" };

Deno.serve(async (request) => {
  const expected = Deno.env.get("CRON_SECRET");
  const supplied = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  if (!expected || supplied !== expected) return new Response(JSON.stringify({ error: "unauthorized" }), { status: 401, headers });
  const client = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { db: { schema } });
  const today = new Date().toISOString().slice(0, 10);
  const { data: expiring } = await client.from("competencies").select("id,user_id,course_id,valid_until").not("valid_until", "is", null).lte("valid_until", new Date(Date.now() + 90 * 86400000).toISOString().slice(0, 10)).gte("valid_until", today);
  for (const item of expiring ?? []) {
    await client.from("notifications").upsert({ id: `expiry:${item.id}:90`, user_id: item.user_id, type: "competence_expiring", subject: "Din kompetens löper ut snart", body: `Din utbildning löper ut ${item.valid_until}.`, status: "queued", scheduled_for: today }, { onConflict: "id" });
  }
  return new Response(JSON.stringify({ ok: true, processed: expiring?.length ?? 0 }), { headers });
});
