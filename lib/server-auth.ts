import { headers } from "next/headers";
import { getChatGPTUser, type ChatGPTUser } from "@/app/chatgpt-auth";
import { hasPermission, type PlatformRole } from "@/lib/platform";
import { eq } from "drizzle-orm";
import { profiles, users } from "@/db/schema";
import { getDb } from "@/db";
import { ensureDefaultEmailTemplates, queueTemplatedNotification } from "@/lib/notifications";
import { sameOriginGuard } from "@/lib/request-security";
import { envString } from "@/lib/runtime-env";

type Database = ReturnType<typeof getDb>;

export async function currentIdentity(): Promise<ChatGPTUser | null> {
  return getChatGPTUser();
}

export async function requireIdentity(): Promise<ChatGPTUser> {
  const user = await currentIdentity();
  if (!user) throw new Response(JSON.stringify({ error: "authentication_required" }), { status: 401, headers: { "content-type": "application/json" } });
  return user;
}

export async function requireApiIdentity(): Promise<ChatGPTUser | Response> {
  const user = await currentIdentity();
  return user ?? Response.json({ error: "authentication_required" }, { status: 401 });
}

export async function requireMutationIdentity(
  request: Request,
): Promise<ChatGPTUser | Response> {
  const originError = sameOriginGuard(request);
  if (originError) return originError;
  return requireApiIdentity();
}

export async function ensureDbUser(db: Database, identity: ChatGPTUser) {
  const existing = await db.select().from(users).where(eq(users.email, identity.email)).limit(1);
  const configuredRole = roleFromEmail(identity.email);
  if (existing[0]) {
    if (existing[0].status === "suspended" || existing[0].status === "anonymized")
      throw new Response(JSON.stringify({ error: "account_inactive" }), { status: 403, headers: { "content-type": "application/json" } });
    // Keep deployment configuration authoritative when an account was first created before its admin email was configured.
    if (configuredRole === "super_admin" && existing[0].role !== "super_admin") {
      await db.update(users).set({ role: configuredRole, updatedAt: new Date().toISOString() }).where(eq(users.id, existing[0].id));
      const promoted = { ...existing[0], role: configuredRole };
      await ensureProfile(db, promoted.id, identity);
      return promoted;
    }
    const loginAt = new Date().toISOString();
    await db.update(users).set({ status: "active", lastLoginAt: loginAt, updatedAt: loginAt }).where(eq(users.id, existing[0].id));
    await ensureProfile(db, existing[0].id, identity);
    return { ...existing[0], status: "active" as const, lastLoginAt: loginAt };
  }
  const id = `usr_${stableId(identity.email)}`;
  await db.insert(users).values({ id, email: identity.email, role: configuredRole, status: "active" });
  const created = (await db.select().from(users).where(eq(users.id, id)).limit(1))[0];
  await ensureProfile(db, id, identity);
  await ensureDefaultEmailTemplates(db);
  await queueTemplatedNotification(db, {
    userId: id,
    type: "welcome",
    variables: { accountUrl: "/mina-sidor" },
    fallbackSubject: "Välkommen till Kompetensportalen",
    fallbackBody: "Välkommen till Kompetensportalen. Öppna Mina sidor för att se dina utbildningar.",
    scheduledFor: `welcome:${id}`,
  });
  return created;
}

async function ensureProfile(db: Database, userId: string, identity: ChatGPTUser) {
  const existing = await db.select({ userId: profiles.userId }).from(profiles).where(eq(profiles.userId, userId)).limit(1);
  if (existing[0]) return;
  const parts = (identity.fullName ?? "").trim().split(/\s+/).filter(Boolean);
  await db.insert(profiles).values({
    userId,
    firstName: parts[0] ?? "Deltagare",
    lastName: parts.slice(1).join(" "),
  }).onConflictDoNothing();
}

export async function requestMetadata() {
  const requestHeaders = await headers();
  const ip = requestHeaders.get("cf-connecting-ip") ?? requestHeaders.get("x-forwarded-for");
  return {
    ip: ip ? await hashAuditIp(ip) : null,
    userAgent: requestHeaders.get("user-agent"),
  };
}

async function hashAuditIp(value: string) {
  const configuredKey = envString("PII_ENCRYPTION_KEY");
  const secret = configuredKey || "kompetensportalen-audit-ip";
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const digest = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function roleFromEmail(email: string): PlatformRole {
  const configuredAdmins = envString("KP_ADMIN_EMAILS");
  const adminEmails = (configuredAdmins ?? "").split(",").map((value) => value.trim().toLowerCase()).filter(Boolean);
  if (adminEmails.includes(email.toLowerCase())) return "super_admin";
  return "participant";
}

export function requirePermission(role: PlatformRole, permission: string) {
  if (!hasPermission(role, permission)) throw new Response(JSON.stringify({ error: "forbidden" }), { status: 403, headers: { "content-type": "application/json" } });
}

function stableId(value: string) {
  let hash = 2166136261;
  for (const char of value) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619);
  return (hash >>> 0).toString(36);
}
