import { envString } from "@/lib/runtime-env";
export { normalizePersonalIdentity } from "./personal-identity";

const encoder = new TextEncoder();
const decoder = new TextDecoder();

function configuredKey() {
  const value = envString("PII_ENCRYPTION_KEY");
  if (typeof value !== "string" || value.length < 16 || value === "replace_with_32_bytes_minimum") {
    throw new Error("PII_ENCRYPTION_KEY must be configured before storing personal identity data");
  }
  return value;
}

async function cryptoKey() {
  const digest = await crypto.subtle.digest("SHA-256", encoder.encode(configuredKey()));
  return crypto.subtle.importKey("raw", digest, { name: "AES-GCM" }, false, ["encrypt", "decrypt"]);
}

export async function encryptPersonalIdentity(value: string) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encrypted = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, await cryptoKey(), encoder.encode(value));
  return `${toBase64(iv)}.${toBase64(new Uint8Array(encrypted))}`;
}

export async function decryptPersonalIdentity(value: string | null | undefined) {
  if (!value) return null;
  const [iv, ciphertext] = value.split(".");
  if (!iv || !ciphertext) throw new Error("Invalid encrypted personal identity");
  const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv: fromBase64(iv) }, await cryptoKey(), fromBase64(ciphertext));
  return decoder.decode(plain);
}

function toBase64(bytes: Uint8Array) {
  return btoa(String.fromCharCode(...bytes));
}

function fromBase64(value: string) {
  return Uint8Array.from(atob(value), (char) => char.charCodeAt(0));
}
