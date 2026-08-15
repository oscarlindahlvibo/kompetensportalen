import { getDb } from "@/db";
import { auditLogs } from "@/db/schema";
import { ensureDbUser, requireMutationIdentity } from "@/lib/server-auth";
import { hasPermission } from "@/lib/platform";
import { rateLimit } from "@/lib/rate-limit";
import { allowedCourseAssetTypes, courseAssetSizeLimit, encodeCourseAssetKey, isSafeCourseAssetKey } from "@/lib/course-assets";
import { courseStorageConfigured, uploadCourseAsset } from "@/lib/course-storage";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const limited = rateLimit(request, "course-asset-upload", 30);
  if (limited) return limited;
  const identity = await requireMutationIdentity(request);
  if (identity instanceof Response) return identity;
  const db = getDb();
  const actor = await ensureDbUser(db, identity);
  if (!hasPermission(actor.role, "migration:write") && !hasPermission(actor.role, "course:write"))
    return Response.json({ error: "forbidden" }, { status: 403 });
  const form = await request.formData().catch(() => null);
  const file = form?.get("file");
  const requestedKey = String(form?.get("key") ?? "").trim();
  if (!(file instanceof File) || !requestedKey)
    return Response.json({ error: "file_and_key_required" }, { status: 400 });
  if (!isSafeCourseAssetKey(requestedKey))
    return Response.json({ error: "invalid_asset_key" }, { status: 400 });
  if (!allowedCourseAssetTypes.has(file.type))
    return Response.json({ error: "unsupported_asset_type" }, { status: 415 });
  const limit = courseAssetSizeLimit(file.type);
  if (file.size < 1 || file.size > limit)
    return Response.json({ error: "asset_size_limit_exceeded", maxBytes: limit }, { status: 413 });
  if (!courseStorageConfigured()) return Response.json({ error: "course_assets_not_configured" }, { status: 503 });
  const stored = await uploadCourseAsset(requestedKey, file);
  if (!stored) return Response.json({ error: "course_assets_not_configured" }, { status: 503 });
  await db.insert(auditLogs).values({
    id: crypto.randomUUID(),
    actorUserId: actor.id,
    targetType: "course_asset",
    targetId: requestedKey,
    action: "course_asset.uploaded",
    beforeJson: null,
    afterJson: JSON.stringify({ contentType: file.type, size: file.size }),
    ipHash: null,
    userAgent: null,
  });
  return Response.json({ assetRef: `course-assets://${requestedKey}`, url: `/api/course-assets/${encodeCourseAssetKey(requestedKey)}`, contentType: file.type, size: file.size }, { status: 201 });
}
