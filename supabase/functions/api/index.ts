import { createClient } from "jsr:@supabase/supabase-js@2";

const schema = "kompetensportalen";
const cors = { "Access-Control-Allow-Origin": Deno.env.get("APP_ORIGIN") ?? "*", "Access-Control-Allow-Headers": "authorization, content-type", "Access-Control-Allow-Methods": "GET,POST,PATCH,PUT,DELETE,OPTIONS" };
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...cors, "content-type": "application/json" } });
const db = () => createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { db: { schema } });

async function identity(request: Request) {
  const token = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  if (!token) return null;
  const client = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!);
  const { data } = await client.auth.getUser(token);
  return data.user;
}

async function handle(request: Request) {
  if (request.method === "OPTIONS") return new Response("ok", { headers: cors });
  const url = new URL(request.url);
  const input = request.method === "GET" ? Object.fromEntries(url.searchParams) : await request.json().catch(() => ({}));
  const path = String(input.path ?? url.searchParams.get("path") ?? "/").replace(/\/+/g, "/");
  const method = String(input.method ?? request.method).toUpperCase();
  const payload = input.body ?? input;
  const client = db();

  if (path === "/courses" && method === "GET") {
    const { data, error } = await client.from("courses").select("*").in("status", ["published", "coming_soon"]).order("created_at");
    return error ? json({ error: error.message }, 500) : json({ courses: data ?? [] });
  }
  if (path.startsWith("/courses/") && method === "GET") {
    const { data, error } = await client.from("courses").select("*").eq("slug", path.slice(9)).maybeSingle();
    return error ? json({ error: error.message }, 500) : data ? json({ course: data }) : json({ error: "not_found" }, 404);
  }
  if (path === "/session" && method === "GET") { const user = await identity(request); return json({ user: user ? { id: user.id, email: user.email } : null }); }
  if (path === "/contact" && method === "POST") { const { error } = await client.from("contact_messages").insert({ id: crypto.randomUUID(), name: payload.name, email: payload.email, message: payload.message }); return error ? json({ error: error.message }, 400) : json({ ok: true }, 201); }
  if (path === "/course-interest" && method === "POST") { const { error } = await client.from("course_interest").upsert({ id: crypto.randomUUID(), course_id: payload.courseId, email: payload.email, status: "subscribed" }, { onConflict: "course_id,email" }); return error ? json({ error: error.message }, 400) : json({ ok: true }, 201); }

  const user = await identity(request);
  if (!user) return json({ error: "authentication_required" }, 401);
  const { data: dbUser } = await client.from("users").select("*").eq("email", user.email?.toLowerCase()).maybeSingle();
  if (path === "/enrollments" && method === "GET") { const { data, error } = await client.from("enrollments").select("*, courses(name, slug)").eq("user_id", dbUser?.id ?? ""); return error ? json({ error: error.message }, 500) : json({ enrollments: data ?? [] }); }
  if (path === "/orders" && method === "POST") { return json({ error: "stripe_not_configured", message: "Order creation is handled by the Stripe Edge Function." }, 501); }
  if (path === "/admin/dashboard" && method === "GET") { if (!dbUser || dbUser.role === "participant") return json({ error: "forbidden" }, 403); const [{ count: courses }, { count: participants }, { count: id06_pending }] = await Promise.all([client.from("courses").select("id", { count: "exact", head: true }), client.from("users").select("id", { count: "exact", head: true }), client.from("id06_registrations").select("id", { count: "exact", head: true }).eq("status", "ready_for_id06")]); return json({ courses: courses ?? 0, participants: participants ?? 0, id06_pending: id06_pending ?? 0 }); }
  return json({ error: "not_found", path }, 404);
}

Deno.serve((request) => handle(request).catch((error) => json({ error: error instanceof Error ? error.message : "internal_error" }, 500)));
