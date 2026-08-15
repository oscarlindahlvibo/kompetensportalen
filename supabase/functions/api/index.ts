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
  if (path.startsWith("/enrollments/") && method === "GET") {
    const enrollmentId = path.split("/")[2];
    const { data: enrollment, error } = await client.from("enrollments").select("*, courses(*), course_versions(*)").eq("id", enrollmentId).eq("user_id", dbUser?.id ?? "").maybeSingle();
    if (error) return json({ error: error.message }, 500);
    if (!enrollment) return json({ error: "not_found" }, 404);
    const [{ data: chapters }, { data: progress }] = await Promise.all([
      client.from("chapters").select("*, lessons(*)").eq("course_version_id", enrollment.course_version_id).order("sort_order"),
      client.from("lesson_progress").select("*").eq("enrollment_id", enrollmentId),
    ]);
    return json({ enrollment, chapters: chapters ?? [], progress: progress ?? [] });
  }
  if (path === "/progress" && method === "POST") {
    const enrollmentId = String(payload.enrollmentId ?? "");
    const lessonId = String(payload.lessonId ?? "");
    const { data: enrollment } = await client.from("enrollments").select("id,course_version_id").eq("id", enrollmentId).eq("user_id", dbUser?.id ?? "").maybeSingle();
    if (!enrollment) return json({ error: "not_found" }, 404);
    const { data: lesson } = await client.from("lessons").select("id,chapter_id,type,required,chapters!inner(course_version_id)").eq("id", lessonId).eq("chapters.course_version_id", enrollment.course_version_id).maybeSingle();
    if (!lesson || ["quiz", "exam"].includes(lesson.type)) return json({ error: "invalid_lesson" }, 400);
    const { error } = await client.from("lesson_progress").upsert({ id: `${enrollmentId}:${lessonId}`, enrollment_id: enrollmentId, lesson_id: lessonId, status: "completed", completed_at: new Date().toISOString() }, { onConflict: "enrollment_id,lesson_id" });
    if (error) return json({ error: error.message }, 400);
    const { count } = await client.from("lessons").select("id,chapters!inner(course_version_id)", { count: "exact", head: true }).eq("required", true).eq("chapters.course_version_id", enrollment.course_version_id);
    const { count: completed } = await client.from("lesson_progress").select("id,lessons!inner(required)", { count: "exact", head: true }).eq("enrollment_id", enrollmentId).eq("status", "completed").eq("lessons.required", true);
    const progressPercent = count ? Math.min(100, Math.round(((completed ?? 0) / count) * 100)) : 0;
    await client.from("enrollments").update({ progress_percent: progressPercent, status: progressPercent >= 100 ? "completed" : "in_progress", started_at: new Date().toISOString() }).eq("id", enrollmentId);
    return json({ ok: true, progressPercent });
  }
  if (path.startsWith("/certificates/verify/") && method === "GET") {
    const code = path.slice("/certificates/verify/".length);
    const { data, error } = await client.from("certificates").select("certificate_number,verification_code,issued_at,valid_until,status,courses(name),course_versions(version)").eq("verification_code", code).maybeSingle();
    if (error) return json({ error: error.message }, 500);
    if (!data) return json({ valid: false }, 404);
    return json({ valid: data.status === "issued" && (!data.valid_until || data.valid_until >= new Date().toISOString().slice(0, 10)), certificate: { certificateNumber: data.certificate_number, course: data.courses?.name, version: data.course_versions?.version, issuedAt: data.issued_at, validUntil: data.valid_until, status: data.status } });
  }
  if (path === "/company" && method === "GET") {
    const { data: membership } = await client.from("company_members").select("company_id,role,companies(*)").eq("user_id", dbUser?.id ?? "").maybeSingle();
    if (!membership) return json({ error: "company_not_found" }, 404);
    const { data: members } = await client.from("company_members").select("user_id,role,users(email),enrollments(*)").eq("company_id", membership.company_id);
    return json({ company: membership.companies, members: members ?? [] });
  }
  if (path === "/company/licenses" && method === "GET") {
    const { data: membership } = await client.from("company_members").select("company_id").eq("user_id", dbUser?.id ?? "").eq("role", "admin").maybeSingle();
    if (!membership) return json({ error: "forbidden" }, 403);
    const { data, error } = await client.from("course_licenses").select("*, courses(name)").eq("company_id", membership.company_id).order("created_at", { ascending: false });
    return error ? json({ error: error.message }, 500) : json({ licenses: data ?? [] });
  }
  if (path === "/admin/courses" && method === "GET") {
    if (!dbUser || !["super_admin", "course_admin"].includes(dbUser.role)) return json({ error: "forbidden" }, 403);
    const { data, error } = await client.from("courses").select("*").order("created_at", { ascending: false });
    return error ? json({ error: error.message }, 500) : json({ courses: data ?? [] });
  }
  if (path === "/admin/courses" && method === "POST") {
    if (!dbUser || !["super_admin", "course_admin"].includes(dbUser.role)) return json({ error: "forbidden" }, 403);
    const id = crypto.randomUUID();
    const { data, error } = await client.from("courses").insert({ id, slug: payload.slug, name: payload.name, short_description: payload.shortDescription ?? "", full_description: payload.fullDescription ?? "", category: payload.category ?? "Övrigt", base_price_sek: Number(payload.basePriceSek ?? 0), estimated_minutes: Number(payload.estimatedMinutes ?? 0), validity_months: payload.validityMonths ? Number(payload.validityMonths) : null, status: "draft", tags_json: JSON.stringify(payload.tags ?? []) }).select().single();
    return error ? json({ error: error.message }, 400) : json({ course: data }, 201);
  }
  if (path.startsWith("/admin/courses/") && method === "PATCH") {
    if (!dbUser || !["super_admin", "course_admin"].includes(dbUser.role)) return json({ error: "forbidden" }, 403);
    const courseId = path.split("/")[3];
    const allowed = ["name", "slug", "short_description", "full_description", "category", "base_price_sek", "campaign_price_sek", "validity_months", "estimated_minutes", "status", "tags_json"];
    const update = Object.fromEntries(Object.entries(payload).filter(([key]) => allowed.includes(key)));
    const { data, error } = await client.from("courses").update(update).eq("id", courseId).select().single();
    return error ? json({ error: error.message }, 400) : json({ course: data });
  }
  if (path === "/orders" && method === "POST") { return json({ error: "stripe_not_configured", message: "Order creation is handled by the Stripe Edge Function." }, 501); }
  if (path === "/admin/dashboard" && method === "GET") { if (!dbUser || dbUser.role === "participant") return json({ error: "forbidden" }, 403); const [{ count: courses }, { count: participants }, { count: id06_pending }] = await Promise.all([client.from("courses").select("id", { count: "exact", head: true }), client.from("users").select("id", { count: "exact", head: true }), client.from("id06_registrations").select("id", { count: "exact", head: true }).eq("status", "ready_for_id06")]); return json({ courses: courses ?? 0, participants: participants ?? 0, id06_pending: id06_pending ?? 0 }); }
  return json({ error: "not_found", path }, 404);
}

Deno.serve((request) => handle(request).catch((error) => json({ error: error instanceof Error ? error.message : "internal_error" }, 500)));
