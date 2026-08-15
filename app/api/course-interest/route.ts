import { and, eq } from "drizzle-orm";
import { getDb } from "@/db";
import { courseInterest, courses } from "@/db/schema";
import { rateLimit } from "@/lib/rate-limit";
import { sameOriginGuard } from "@/lib/request-security";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const originError = sameOriginGuard(request);
  if (originError) return originError;
  const limited = rateLimit(request, "course-interest", 10);
  if (limited) return limited;
  const body = await request.json() as { courseId?: string; email?: string };
  const email = body.email?.trim().toLowerCase();
  if (!body.courseId || !email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return Response.json({ error: "valid_course_and_email_required" }, { status: 400 });
  const db = getDb();
  const course = (await db.select().from(courses).where(and(eq(courses.id, body.courseId), eq(courses.status, "coming_soon"))).limit(1))[0];
  if (!course) return Response.json({ error: "course_not_available_for_interest" }, { status: 404 });
  await db.insert(courseInterest).values({ id: crypto.randomUUID(), courseId: course.id, email }).onConflictDoNothing();
  return Response.json({ ok: true, message: "Du får ett meddelande när kursen släpps." }, { status: 201 });
}
