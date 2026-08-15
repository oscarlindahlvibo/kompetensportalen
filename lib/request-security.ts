/** Reject browser mutations initiated by a different origin. */
export function sameOriginGuard(request: Request) {
  const origin = request.headers.get("origin");
  const referer = request.headers.get("referer");
  const candidate = origin ?? (referer ? originFromReferer(referer) : null);
  if (!candidate) return null;
  let actual: URL;
  let supplied: URL;
  try {
    actual = new URL(request.url);
    supplied = new URL(candidate);
  } catch {
    return Response.json({ error: "invalid_request_origin" }, { status: 403 });
  }
  if (supplied.origin !== actual.origin)
    return Response.json({ error: "cross_origin_request" }, { status: 403 });
  return null;
}

function originFromReferer(referer: string) {
  try { return new URL(referer).origin; } catch { return null; }
}
