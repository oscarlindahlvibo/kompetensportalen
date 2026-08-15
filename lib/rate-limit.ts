type Bucket = { startedAt: number; count: number };
const buckets = new Map<string, Bucket>();

export function rateLimit(request: Request, key: string, limit: number, windowMs = 60_000) {
  const address = request.headers.get("cf-connecting-ip") ?? request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
  const bucketKey = `${key}:${address}`;
  const now = Date.now();
  const current = buckets.get(bucketKey);
  if (!current || now - current.startedAt >= windowMs) {
    buckets.set(bucketKey, { startedAt: now, count: 1 });
    return null;
  }
  current.count += 1;
  if (current.count <= limit) return null;
  const retryAfter = Math.max(1, Math.ceil((windowMs - (now - current.startedAt)) / 1000));
  return Response.json({ error: "rate_limit_exceeded", retryAfterSeconds: retryAfter }, { status: 429, headers: { "retry-after": String(retryAfter) } });
}
