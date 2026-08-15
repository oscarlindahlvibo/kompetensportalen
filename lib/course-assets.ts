export const allowedCourseAssetTypes = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "video/mp4",
  "video/webm",
  "application/pdf",
]);

export function isSafeCourseAssetKey(value: string) {
  return value.length <= 200 && !value.startsWith("/") && !value.includes("\\") && !value.includes("..") && /^[A-Za-z0-9][A-Za-z0-9/_ .-]*$/.test(value);
}

export function courseAssetSizeLimit(contentType: string) {
  return contentType.startsWith("video/") ? 500 * 1024 * 1024 : contentType === "application/pdf" ? 50 * 1024 * 1024 : 25 * 1024 * 1024;
}

export function encodeCourseAssetKey(value: string) {
  return value.split("/").map((part) => encodeURIComponent(part)).join("/");
}
