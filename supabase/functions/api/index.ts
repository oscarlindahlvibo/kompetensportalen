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
  if (path.startsWith("/quizzes/") && method === "GET") {
    const quizId = path.split("/")[2];
    const { data: quiz, error } = await client.from("quizzes").select("*, quiz_questions(*, questions(*, answer_options(*)))").eq("id", quizId).maybeSingle();
    if (error) return json({ error: error.message }, 500);
    if (!quiz) return json({ error: "not_found" }, 404);
    const safe = { ...quiz, quiz_questions: (quiz.quiz_questions ?? []).map((item: any) => ({ ...item, questions: item.questions ? { ...item.questions, answer_options: (item.questions.answer_options ?? []).map((option: any) => ({ id: option.id, label: option.label })) } : null })) };
    return json({ quiz: safe });
  }
  if (path.startsWith("/quizzes/") && path.endsWith("/submit") && method === "POST") {
    const quizId = path.split("/")[2];
    const enrollmentId = String(payload.enrollmentId ?? "");
    const { data: enrollment } = await client.from("enrollments").select("id,user_id,course_id,course_version_id").eq("id", enrollmentId).eq("user_id", dbUser?.id ?? "").maybeSingle();
    if (!enrollment) return json({ error: "not_found" }, 404);
    const { data: quiz } = await client.from("quizzes").select("*, quiz_questions(*, questions(*, answer_options(*)))").eq("id", quizId).maybeSingle();
    if (!quiz) return json({ error: "not_found" }, 404);
    const answers = payload.answers ?? {};
    let correct = 0;
    const feedback = (quiz.quiz_questions ?? []).map((item: any) => { const expected = (item.questions?.answer_options ?? []).filter((option: any) => option.is_correct).map((option: any) => option.id).sort(); const actual = (Array.isArray(answers[item.question_id]) ? answers[item.question_id] : [answers[item.question_id]]).filter(Boolean).sort(); const passed = JSON.stringify(expected) === JSON.stringify(actual); if (passed) correct += 1; return { questionId: item.question_id, correct: passed }; });
    const scorePercent = feedback.length ? Math.round((correct / feedback.length) * 100) : 0;
    const passed = scorePercent >= Number(quiz.pass_percent ?? 80);
    await client.from("quiz_attempts").insert({ id: crypto.randomUUID(), enrollment_id: enrollmentId, quiz_id: quizId, course_version_id: enrollment.course_version_id, attempt_number: Number(payload.attemptNumber ?? 1), question_snapshot_json: JSON.stringify(quiz.quiz_questions ?? []), answers_json: JSON.stringify(answers), score_percent: scorePercent, passed, submitted_at: new Date().toISOString() });
    return json({ passed, scorePercent, feedback });
  }
  if (path === "/exams/attempts" && method === "POST") {
    const enrollmentId = String(payload.enrollmentId ?? "");
    const { data: enrollment } = await client.from("enrollments").select("id,user_id,course_id,course_version_id").eq("id", enrollmentId).eq("user_id", dbUser?.id ?? "").maybeSingle();
    if (!enrollment) return json({ error: "not_found" }, 404);
    const { data: config } = await client.from("exam_configs").select("*").eq("course_version_id", enrollment.course_version_id).maybeSingle();
    const { data: questions } = await client.from("questions").select("*, answer_options(*)").eq("course_id", enrollment.course_id).eq("active", true).limit(config?.question_count ?? 30);
    const attemptId = crypto.randomUUID();
    await client.from("exam_attempts").insert({ id: attemptId, enrollment_id: enrollmentId, course_version_id: enrollment.course_version_id, attempt_number: Number(payload.attemptNumber ?? 1), status: "started", started_at: new Date().toISOString(), question_snapshot_json: JSON.stringify(questions ?? []), score_percent: 0, passed: false });
    const safeQuestions = (questions ?? []).map((question: any) => ({ ...question, answer_options: (question.answer_options ?? []).map((option: any) => ({ id: option.id, label: option.label })) }));
    return json({ attemptId, questions: safeQuestions, config });
  }
  if (path.startsWith("/exams/attempts/") && method === "POST") {
    const attemptId = path.split("/")[3];
    const { data: attempt } = await client.from("exam_attempts").select("*").eq("id", attemptId).maybeSingle();
    if (!attempt || attempt.enrollment_id === null) return json({ error: "not_found" }, 404);
    const { data: enrollment } = await client.from("enrollments").select("user_id").eq("id", attempt.enrollment_id).eq("user_id", dbUser?.id ?? "").maybeSingle();
    if (!enrollment) return json({ error: "forbidden" }, 403);
    const questions = JSON.parse(attempt.question_snapshot_json ?? "[]");
    const answers = payload.answers ?? {};
    let correct = 0;
    for (const question of questions) { const expected = (question.answer_options ?? []).filter((option: any) => option.is_correct).map((option: any) => option.id).sort(); const actual = (Array.isArray(answers[question.id]) ? answers[question.id] : [answers[question.id]]).filter(Boolean).sort(); if (JSON.stringify(expected) === JSON.stringify(actual)) correct += 1; }
    const scorePercent = questions.length ? Math.round((correct / questions.length) * 100) : 0;
    const passed = scorePercent >= 80;
    await client.from("exam_attempts").update({ score_percent: scorePercent, passed, status: passed ? "passed" : "failed", finished_at: new Date().toISOString() }).eq("id", attemptId);
    return json({ passed, scorePercent });
  }
  if (path === "/admin/certificates/issue" && method === "POST") {
    if (!dbUser || !["super_admin", "certification_admin"].includes(dbUser.role)) return json({ error: "forbidden" }, 403);
    const enrollmentId = String(payload.enrollmentId ?? "");
    const { data: enrollment } = await client.from("enrollments").select("*, courses(*), course_versions(*)").eq("id", enrollmentId).maybeSingle();
    if (!enrollment) return json({ error: "not_found" }, 404);
    const { data: passed } = await client.from("exam_attempts").select("id").eq("enrollment_id", enrollmentId).eq("passed", true).limit(1);
    const { data: identity } = await client.from("identity_verifications").select("id").eq("enrollment_id", enrollmentId).eq("status", "identity_verified").limit(1);
    if (!passed?.length || (enrollment.courses?.requires_identity_verification && !identity?.length)) return json({ error: "certification_requirements_not_met" }, 400);
    const certificateNumber = `KP-${new Date().getFullYear()}-${crypto.randomUUID().slice(0, 8).toUpperCase()}`;
    const verificationCode = crypto.randomUUID().replaceAll("-", "").slice(0, 12).toUpperCase();
    const issuedAt = new Date().toISOString();
    const validUntil = enrollment.valid_until;
    const { data: certificate, error } = await client.from("certificates").insert({ id: crypto.randomUUID(), enrollment_id: enrollmentId, user_id: enrollment.user_id, course_id: enrollment.course_id, course_version_id: enrollment.course_version_id, certificate_number: certificateNumber, verification_code: verificationCode, issued_at: issuedAt, valid_until: validUntil, status: "issued" }).select().single();
    if (error) return json({ error: error.message }, 400);
    if (enrollment.courses?.id06_enabled) await client.from("id06_registrations").insert({ id: crypto.randomUUID(), certificate_id: certificate.id, enrollment_id: enrollmentId, competence_code: enrollment.courses.competence_code ?? "", competence_name: enrollment.courses.name, status: "ready_for_id06" });
    return json({ certificate }, 201);
  }
  if (path === "/admin/id06" && method === "GET") {
    if (!dbUser || !["super_admin", "certification_admin"].includes(dbUser.role)) return json({ error: "forbidden" }, 403);
    const { data, error } = await client.from("id06_registrations").select("*, certificates(*), enrollments(*, users(email), courses(name))").in("status", ["ready_for_id06", "submitted", "failed"]).order("created_at");
    return error ? json({ error: error.message }, 500) : json({ registrations: data ?? [] });
  }
  if (path.startsWith("/admin/id06/") && method === "PATCH") {
    if (!dbUser || !["super_admin", "certification_admin"].includes(dbUser.role)) return json({ error: "forbidden" }, 403);
    const registrationId = path.split("/")[3];
    const nextStatus = String(payload.status ?? "");
    if (!["submitted", "registered", "failed"].includes(nextStatus)) return json({ error: "invalid_status" }, 400);
    const { data, error } = await client.from("id06_registrations").update({ status: nextStatus, handled_by_user_id: dbUser.id, id06_reference: payload.reference ?? null, error_message: payload.errorMessage ?? null, registered_at: nextStatus === "registered" ? new Date().toISOString() : null }).eq("id", registrationId).select().single();
    return error ? json({ error: error.message }, 400) : json({ registration: data });
  }
  if (path === "/orders" && method === "POST") {
    const courseId = String(payload.courseId ?? "");
    const quantity = Math.max(1, Math.min(10000, Number(payload.quantity ?? 1)));
    const { data: course } = await client.from("courses").select("*").eq("id", courseId).eq("status", "published").maybeSingle();
    if (!course) return json({ error: "course_not_available" }, 400);
    const now = new Date().toISOString();
    const orderId = crypto.randomUUID();
    const itemId = crypto.randomUUID();
    const productId = `product:${course.id}`;
    const total = Number(course.campaign_price_sek ?? course.base_price_sek) * quantity;
    await client.from("products").upsert({ id: productId, course_id: course.id, sku: productId, name: course.name, price_sek: Number(course.campaign_price_sek ?? course.base_price_sek), active: true }, { onConflict: "id" });
    const { error: orderError } = await client.from("orders").insert({ id: orderId, buyer_user_id: dbUser?.id, buyer_type: "private", status: "checkout_pending", subtotal_sek: total, discount_sek: 0, vat_sek: Math.round(total * Number(course.vat_rate ?? 0.25)), total_sek: total + Math.round(total * Number(course.vat_rate ?? 0.25)), created_at: now, updated_at: now });
    if (orderError) return json({ error: orderError.message }, 400);
    await client.from("order_items").insert({ id: itemId, order_id: orderId, product_id: productId, course_id: course.id, quantity, unit_price_sek: Number(course.campaign_price_sek ?? course.base_price_sek), discount_sek: 0 });
    await client.from("payments").insert({ id: crypto.randomUUID(), order_id: orderId, provider: "stripe", status: "pending", amount_sek: total, created_at: now, updated_at: now });
    const stripeSecret = Deno.env.get("STRIPE_SECRET_KEY");
    if (!stripeSecret) return json({ orderId, configurationRequired: true }, 201);
    const form = new URLSearchParams({ mode: "payment", success_url: `${Deno.env.get("APP_ORIGIN") ?? url.origin}/mina-sidor?order=success`, cancel_url: `${Deno.env.get("APP_ORIGIN") ?? url.origin}/utbildningar/${course.slug}`, "line_items[0][price_data][currency]": "sek", "line_items[0][price_data][product_data][name]": course.name, "line_items[0][price_data][unit_amount]": String(Math.round(Number(course.campaign_price_sek ?? course.base_price_sek) * 100)), "line_items[0][quantity]": String(quantity), "metadata[orderId]": orderId });
    const stripeResponse = await fetch("https://api.stripe.com/v1/checkout/sessions", { method: "POST", headers: { Authorization: `Bearer ${stripeSecret}`, "content-type": "application/x-www-form-urlencoded" }, body: form });
    const session = await stripeResponse.json();
    if (!stripeResponse.ok) return json({ orderId, error: session.error?.message ?? "stripe_error" }, 502);
    await client.from("orders").update({ stripe_checkout_session_id: session.id }).eq("id", orderId);
    return json({ orderId, url: session.url }, 201);
  }
  if (path === "/company/licenses/assign" && method === "POST") {
    const { data: membership } = await client.from("company_members").select("company_id").eq("user_id", dbUser?.id ?? "").eq("role", "admin").maybeSingle();
    if (!membership) return json({ error: "forbidden" }, 403);
    const licenseId = String(payload.licenseId ?? "");
    const email = String(payload.email ?? "").trim().toLowerCase();
    if (!email) return json({ error: "email_required" }, 400);
    const { data: license } = await client.from("course_licenses").select("*").eq("id", licenseId).eq("company_id", membership.company_id).eq("status", "available").maybeSingle();
    if (!license) return json({ error: "license_not_available" }, 400);
    const { data: participant } = await client.from("users").select("id").eq("email", email).maybeSingle();
    const { data, error } = await client.from("course_licenses").update({ assigned_email: email, assigned_to_user_id: participant?.id ?? null, assigned_at: new Date().toISOString(), status: "assigned" }).eq("id", licenseId).select().single();
    return error ? json({ error: error.message }, 400) : json({ license: data });
  }
  if (path === "/privacy/export" && method === "GET") {
    const [{ data: profile }, { data: enrollments }, { data: certificates }, { data: audit }] = await Promise.all([client.from("profiles").select("*").eq("user_id", dbUser?.id ?? "").maybeSingle(), client.from("enrollments").select("*").eq("user_id", dbUser?.id ?? ""), client.from("certificates").select("*").eq("user_id", dbUser?.id ?? ""), client.from("audit_logs").select("target_type,target_id,action,created_at").eq("actor_user_id", dbUser?.id ?? "")]);
    return json({ profile, enrollments, certificates, audit });
  }
  if (path === "/admin/question-bank" && method === "GET") {
    if (!dbUser || !["super_admin", "course_admin"].includes(dbUser.role)) return json({ error: "forbidden" }, 403);
    const { data, error } = await client.from("questions").select("*, answer_options(*)").order("created_at", { ascending: false });
    return error ? json({ error: error.message }, 500) : json({ questions: data ?? [] });
  }
  if (path === "/admin/question-bank" && method === "POST") {
    if (!dbUser || !["super_admin", "course_admin"].includes(dbUser.role)) return json({ error: "forbidden" }, 403);
    const id = crypto.randomUUID();
    const { data, error } = await client.from("questions").insert({ id, course_id: payload.courseId, chapter_id: payload.chapterId ?? null, topic: payload.topic ?? "Övrigt", difficulty: payload.difficulty ?? "medium", type: payload.type ?? "single", prompt: payload.prompt, explanation: payload.explanation ?? null, points: Number(payload.points ?? 1), active: payload.active !== false, image_url: payload.imageUrl ?? null }).select().single();
    if (error) return json({ error: error.message }, 400);
    for (const [index, option] of (payload.options ?? []).entries()) await client.from("answer_options").insert({ id: crypto.randomUUID(), question_id: id, label: option.label, is_correct: Boolean(option.isCorrect), sort_order: index });
    return json({ question: data }, 201);
  }
  if (path.startsWith("/admin/courses/") && path.endsWith("/versions") && method === "GET") {
    if (!dbUser || !["super_admin", "course_admin"].includes(dbUser.role)) return json({ error: "forbidden" }, 403);
    const courseId = path.split("/")[3];
    const { data, error } = await client.from("course_versions").select("*").eq("course_id", courseId).order("created_at", { ascending: false });
    return error ? json({ error: error.message }, 500) : json({ versions: data ?? [] });
  }
  if (path === "/identity-verifications" && method === "POST") {
    const enrollmentId = String(payload.enrollmentId ?? "");
    const { data: enrollment } = await client.from("enrollments").select("id,user_id").eq("id", enrollmentId).eq("user_id", dbUser?.id ?? "").maybeSingle();
    if (!enrollment) return json({ error: "not_found" }, 404);
    const { data, error } = await client.from("identity_verifications").upsert({ id: crypto.randomUUID(), user_id: dbUser?.id, enrollment_id: enrollmentId, status: "identity_pending", method: payload.method ?? "manual_bankid_document" }, { onConflict: "enrollment_id" }).select().single();
    return error ? json({ error: error.message }, 400) : json({ verification: data }, 201);
  }
  if (path.startsWith("/admin/identity/") && method === "PATCH") {
    if (!dbUser || !["super_admin", "certification_admin"].includes(dbUser.role)) return json({ error: "forbidden" }, 403);
    const verificationId = path.split("/")[3];
    const status = String(payload.status ?? "identity_pending");
    if (!["identity_pending", "identity_verified", "rejected"].includes(status)) return json({ error: "invalid_status" }, 400);
    const { data, error } = await client.from("identity_verifications").update({ status, reference: payload.reference ?? null, notes: payload.notes ?? null, verified_at: status === "identity_verified" ? new Date().toISOString() : null, verified_by_user_id: dbUser.id }).eq("id", verificationId).select().single();
    return error ? json({ error: error.message }, 400) : json({ verification: data });
  }
  if (path === "/admin/audit" && method === "GET") {
    if (!dbUser || dbUser.role === "participant") return json({ error: "forbidden" }, 403);
    const { data, error } = await client.from("audit_logs").select("id,target_type,target_id,action,created_at,actor_user_id").order("created_at", { ascending: false }).limit(200);
    return error ? json({ error: error.message }, 500) : json({ audit: data ?? [] });
  }
  if (path === "/course-assets" && method === "POST") {
    if (!dbUser || !["super_admin", "course_admin"].includes(dbUser.role)) return json({ error: "forbidden" }, 403);
    const key = String(payload.key ?? "").replace(/^\/+/, "");
    const encoded = String(payload.base64 ?? "").replace(/^data:[^;]+;base64,/, "");
    if (!key || !encoded || key.includes("..") || key.includes("\\")) return json({ error: "invalid_asset" }, 400);
    const bytes = Uint8Array.from(atob(encoded), (char) => char.charCodeAt(0));
    if (bytes.byteLength > 500 * 1024 * 1024) return json({ error: "asset_too_large" }, 413);
    const bucket = Deno.env.get("SUPABASE_STORAGE_BUCKET") ?? "kompetensportalen-course-assets";
    const { error } = await client.storage.from(bucket).upload(key, bytes, { contentType: payload.contentType ?? "application/octet-stream", upsert: true });
    return error ? json({ error: error.message }, 400) : json({ assetRef: `course-assets://${key}` }, 201);
  }
  if (path === "/admin/dashboard" && method === "GET") { if (!dbUser || dbUser.role === "participant") return json({ error: "forbidden" }, 403); const [{ count: courses }, { count: participants }, { count: id06_pending }] = await Promise.all([client.from("courses").select("id", { count: "exact", head: true }), client.from("users").select("id", { count: "exact", head: true }), client.from("id06_registrations").select("id", { count: "exact", head: true }).eq("status", "ready_for_id06")]); return json({ courses: courses ?? 0, participants: participants ?? 0, id06_pending: id06_pending ?? 0 }); }
  return json({ error: "not_found", path }, 404);
}

Deno.serve((request) => handle(request).catch((error) => json({ error: error instanceof Error ? error.message : "internal_error" }, 500)));
