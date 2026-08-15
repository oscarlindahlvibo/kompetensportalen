import { getDb } from "@/db";
import { contactMessages } from "@/db/schema";
import { rateLimit } from "@/lib/rate-limit";
import { sameOriginGuard } from "@/lib/request-security";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const originError = sameOriginGuard(request);
  if (originError) return originError;
  const limited = rateLimit(request, "contact", 5);
  if (limited) return limited;
  const body = await request.json() as { name?: string; email?: string; message?: string };
  const name = body.name?.trim();
  const email = body.email?.trim().toLowerCase();
  const message = body.message?.trim();
  if (!name || !email || !message || name.length > 160 || message.length > 5000 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return Response.json({ error: "valid_contact_fields_required" }, { status: 400 });
  await getDb().insert(contactMessages).values({ id: crypto.randomUUID(), name, email, message });
  return Response.json({ ok: true, message: "Tack! Vi återkommer så snart vi kan." }, { status: 201 });
}
