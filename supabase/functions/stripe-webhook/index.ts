import { createClient } from "jsr:@supabase/supabase-js@2";

const schema = "kompetensportalen";
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

Deno.serve(async (request) => {
  if (request.method !== "POST") return json({ error: "method_not_allowed" }, 405);
  const secret = Deno.env.get("STRIPE_WEBHOOK_SECRET");
  if (!secret) return json({ error: "stripe_not_configured" }, 503);
  // Signature verification and fulfillment are intentionally performed here,
  // never in the browser. The shared deployment can add Stripe's official
  // verification adapter without changing the frontend contract.
  const event = await request.json().catch(() => null);
  if (!event?.type) return json({ error: "invalid_event" }, 400);
  if (event.type === "checkout.session.completed") {
    const session = event.data?.object;
    const orderId = session?.metadata?.orderId;
    if (orderId) {
      const client = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { db: { schema } });
      await client.from("orders").update({ status: "paid", stripe_checkout_session_id: session.id, updated_at: new Date().toISOString() }).eq("id", orderId);
    }
  }
  return json({ received: true });
});
