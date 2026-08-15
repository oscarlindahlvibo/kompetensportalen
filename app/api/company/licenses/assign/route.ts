import { mutationChanges } from "@/lib/db-compat";
import { and, desc, eq } from "drizzle-orm";
import { getDb } from "@/db";
import {
  auditLogs,
  companyMembers,
  courseLicenses,
  courseVersions,
  courses,
  enrollments,
  users,
} from "@/db/schema";
import {
  ensureDbUser,
  requireApiIdentity,
  requirePermission,
  requestMetadata,
} from "@/lib/server-auth";
import { addMonthsIso } from "@/lib/order-fulfillment";
import { queueTemplatedNotification } from "@/lib/notifications";
import { sameOriginGuard } from "@/lib/request-security";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const originError = sameOriginGuard(request);
  if (originError) return originError;
  const identity = await requireApiIdentity();
  if (identity instanceof Response) return identity;
  const body = (await request.json()) as {
    licenseId?: string;
    userId?: string;
    email?: string;
    courseId?: string;
    companyId?: string;
    csv?: string;
  };
  if (
    (!body.csv && !body.licenseId) ||
    (!body.csv && !body.userId && !body.email)
  )
    return Response.json(
      { error: "license_and_recipient_required" },
      { status: 400 },
    );
  const db = getDb();
  const actor = await ensureDbUser(db, identity);
  const metadata = await requestMetadata();
  requirePermission(
    actor.role as Parameters<typeof requirePermission>[0],
    "license:write",
  );
  if (body.csv) {
    if (!body.courseId)
      return Response.json(
        { error: "course_required_for_import" },
        { status: 400 },
      );
    const companyMembership = (
      await db
        .select()
        .from(companyMembers)
        .where(
          and(
            eq(companyMembers.userId, actor.id),
            eq(companyMembers.role, "admin"),
            body.companyId
              ? eq(companyMembers.companyId, body.companyId)
              : undefined,
          ),
        )
        .limit(1)
    )[0];
    if (!companyMembership)
      return Response.json({ error: "company_access_denied" }, { status: 403 });
    const emails = parseCsvEmails(body.csv);
    if (!emails.length || emails.length > 1000)
      return Response.json(
        { error: "invalid_participant_import" },
        { status: 400 },
      );
    const available = await db
      .select()
      .from(courseLicenses)
      .where(
        and(
          eq(courseLicenses.companyId, companyMembership.companyId),
          eq(courseLicenses.courseId, body.courseId),
          eq(courseLicenses.status, "available"),
        ),
      )
      .limit(emails.length);
    const version = (
      await db
        .select()
        .from(courseVersions)
        .where(
          and(
            eq(courseVersions.courseId, body.courseId),
            eq(courseVersions.status, "published"),
          ),
        )
        .limit(1)
    )[0];
    const course = (
      await db
        .select()
        .from(courses)
        .where(eq(courses.id, body.courseId))
        .limit(1)
    )[0];
    if (!version)
      return Response.json(
        { error: "published_version_missing" },
        { status: 409 },
      );
    if (!course)
      return Response.json({ error: "course_not_found" }, { status: 404 });
    const assigned: { email: string; enrollmentId: string }[] = [];
    const failed: { email: string; error: string }[] = [];
    for (const [index, email] of emails.entries()) {
      const license = available[index];
      if (!license) {
        failed.push({ email, error: "no_available_license" });
        continue;
      }
      const licenseVersion = license.courseVersionId
        ? (await db.select().from(courseVersions).where(and(eq(courseVersions.id, license.courseVersionId), eq(courseVersions.courseId, body.courseId))).limit(1))[0]
        : version;
      if (!licenseVersion) {
        failed.push({ email, error: "published_version_missing" });
        continue;
      }
      const recipient = await findOrInviteUser(db, email);
      const enrollmentId = crypto.randomUUID();
      await db
        .insert(companyMembers)
        .values({
          id: crypto.randomUUID(),
          companyId: companyMembership.companyId,
          userId: recipient,
          role: "employee",
        })
        .onConflictDoNothing();
      const assignedAt = new Date().toISOString();
      await db
        .insert(enrollments)
        .values({
          id: enrollmentId,
          userId: recipient,
          companyId: companyMembership.companyId,
          courseId: body.courseId,
          courseVersionId: licenseVersion.id,
          licenseId: license.id,
          status: "not_started",
          progressPercent: 0,
          validFrom: assignedAt.slice(0, 10),
          validUntil: addMonthsIso(assignedAt, course.validityMonths),
        });
      const claim = await db
        .update(courseLicenses)
        .set({
          assignedToUserId: recipient,
          assignedEmail: email,
          status: "consumed",
          assignedAt: new Date().toISOString(),
          consumedEnrollmentId: enrollmentId,
        })
        .where(and(eq(courseLicenses.id, license.id), eq(courseLicenses.status, "available")))
        ;
      if ((mutationChanges(claim) ?? 0) !== 1) {
        await db.delete(enrollments).where(eq(enrollments.id, enrollmentId));
        failed.push({ email, error: "license_unavailable" });
        continue;
      }
      await db.insert(auditLogs).values({ id: crypto.randomUUID(), actorUserId: actor.id, targetType: "course_license", targetId: license.id, action: "license.assigned", beforeJson: JSON.stringify({ status: "available" }), afterJson: JSON.stringify({ status: "consumed", assignedToUserId: recipient, enrollmentId }), ipHash: metadata.ip, userAgent: metadata.userAgent });
      await queueAssignmentNotification(
        db,
        recipient,
        course.name,
        enrollmentId,
      );
      assigned.push({ email, enrollmentId });
    }
    return Response.json({
      assigned,
      failed,
      availableBeforeImport: available.length,
    });
  }
  const licenseId = body.licenseId!;
  const licenseRows = await db
    .select()
    .from(courseLicenses)
    .where(eq(courseLicenses.id, licenseId))
    .limit(1);
  const license = licenseRows[0];
  if (!license || license.status !== "available" || !license.companyId)
    return Response.json({ error: "license_unavailable" }, { status: 409 });
  const membership = await db
    .select()
    .from(companyMembers)
    .where(
      and(
        eq(companyMembers.companyId, license.companyId),
        eq(companyMembers.userId, actor.id),
        eq(companyMembers.role, "admin"),
      ),
    )
    .limit(1);
  if (!membership[0])
    return Response.json({ error: "company_access_denied" }, { status: 403 });
  let recipient = body.userId;
  if (!recipient && body.email) {
    const email = normalizeEmail(body.email);
    if (!email) return Response.json({ error: "invalid_recipient_email" }, { status: 400 });
    const recipientRows = await db
      .select()
      .from(users)
      .where(eq(users.email, email))
      .limit(1);
    recipient = recipientRows[0]?.id;
  }
  if (!recipient && body.email) {
    const email = normalizeEmail(body.email);
    if (!email) return Response.json({ error: "invalid_recipient_email" }, { status: 400 });
    recipient = `usr_invite_${email.replace(/[^a-z0-9]/g, "_")}`;
    await db
      .insert(users)
      .values({
        id: recipient,
        email,
        role: "participant",
        status: "invited",
      })
      .onConflictDoNothing();
  }
  if (!recipient)
    return Response.json({ error: "recipient_not_found" }, { status: 404 });
  const recipientMembership = await db
    .select()
    .from(companyMembers)
    .where(
      and(
        eq(companyMembers.companyId, license.companyId),
        eq(companyMembers.userId, recipient),
      ),
    )
    .limit(1);
  if (!recipientMembership[0])
    await db
      .insert(companyMembers)
      .values({
        id: crypto.randomUUID(),
        companyId: license.companyId,
        userId: recipient,
        role: "employee",
      })
      .onConflictDoNothing();
  const versionRows = license.courseVersionId
    ? await db.select().from(courseVersions).where(and(eq(courseVersions.id, license.courseVersionId), eq(courseVersions.courseId, license.courseId))).limit(1)
    : await db.select().from(courseVersions).where(and(eq(courseVersions.courseId, license.courseId), eq(courseVersions.status, "published"))).orderBy(desc(courseVersions.publishedAt), desc(courseVersions.createdAt)).limit(1);
  if (!versionRows[0])
    return Response.json(
      { error: "published_version_missing" },
      { status: 409 },
    );
  const enrollmentId = crypto.randomUUID();
  const course = (
    await db
      .select()
      .from(courses)
      .where(eq(courses.id, license.courseId))
      .limit(1)
  )[0];
  const assignedAt = new Date().toISOString();
  await db
    .insert(enrollments)
    .values({
      id: enrollmentId,
      userId: recipient,
      companyId: license.companyId,
      courseId: license.courseId,
      courseVersionId: versionRows[0].id,
      licenseId: license.id,
      status: "not_started",
      progressPercent: 0,
      validFrom: assignedAt.slice(0, 10),
      validUntil: addMonthsIso(assignedAt, course?.validityMonths ?? null),
    });
  const claim = await db
    .update(courseLicenses)
    .set({
      assignedToUserId: recipient,
      assignedEmail: body.email ? normalizeEmail(body.email) : null,
      status: "consumed",
      assignedAt: new Date().toISOString(),
      consumedEnrollmentId: enrollmentId,
    })
    .where(and(eq(courseLicenses.id, license.id), eq(courseLicenses.status, "available")))
    ;
  if ((mutationChanges(claim) ?? 0) !== 1) {
    await db.delete(enrollments).where(eq(enrollments.id, enrollmentId));
    return Response.json({ error: "license_unavailable" }, { status: 409 });
  }
  await db.insert(auditLogs).values({ id: crypto.randomUUID(), actorUserId: actor.id, targetType: "course_license", targetId: license.id, action: "license.assigned", beforeJson: JSON.stringify({ status: "available" }), afterJson: JSON.stringify({ status: "consumed", assignedToUserId: recipient, enrollmentId }), ipHash: metadata.ip, userAgent: metadata.userAgent });
  await queueAssignmentNotification(
    db,
    recipient,
    course?.name ?? "utbildningen",
    enrollmentId,
  );
  return Response.json({
    ok: true,
    licenseId: license.id,
    assignedToUserId: recipient,
    enrollmentId,
  });
}

async function queueAssignmentNotification(
  db: ReturnType<typeof import("@/db").getDb>,
  userId: string,
  courseName: string,
  enrollmentId: string,
) {
  await queueTemplatedNotification(db, {
    userId,
    type: "course_assigned",
    variables: {
      courseName,
      enrollmentId,
      courseUrl: `/utbildning/${enrollmentId}`,
    },
    fallbackSubject: `Du har fått utbildningen ${courseName}`,
    fallbackBody: `Du har fått tillgång till ${courseName}. Logga in på Mina sidor för att börja utbildningen. Enrollment: ${enrollmentId}.`,
    scheduledFor: `enrollment:${enrollmentId}`,
  });
}

function parseCsvEmails(value: string) {
  const emails: string[] = [];
  for (const line of value.split(/\r?\n/)) {
    const first = line
      .split(",")[0]
      ?.trim()
      .replace(/^"|"$/g, "")
      .toLowerCase();
    if (
      !first ||
      first === "email" ||
      first === "e-post" ||
      !/^\S+@\S+\.\S+$/.test(first)
    )
      continue;
    if (!emails.includes(first)) emails.push(first);
  }
  return emails;
}

function normalizeEmail(value: string) {
  const email = value.trim().toLowerCase();
  return /^\S+@\S+\.\S+$/.test(email) ? email : null;
}

async function findOrInviteUser(db: ReturnType<typeof getDb>, email: string) {
  const existing = (
    await db.select().from(users).where(eq(users.email, email)).limit(1)
  )[0];
  if (existing) return existing.id;
  const id = `usr_invite_${email.replace(/[^a-z0-9]/g, "_")}`;
  await db
    .insert(users)
    .values({ id, email, role: "participant", status: "invited" })
    .onConflictDoNothing();
  return (
    await db.select().from(users).where(eq(users.email, email)).limit(1)
  )[0].id;
}
