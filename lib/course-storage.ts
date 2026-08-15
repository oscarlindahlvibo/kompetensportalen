import { createClient } from "@supabase/supabase-js";
import { envString } from "@/lib/runtime-env";

const bucketName = () => envString("SUPABASE_STORAGE_BUCKET") ?? "course-assets";

export function courseStorageConfigured() {
  return Boolean(envString("SUPABASE_URL") && envString("SUPABASE_SERVICE_ROLE_KEY"));
}

function client() {
  const url = envString("SUPABASE_URL");
  const key = envString("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !key) return null;
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

export async function uploadCourseAsset(key: string, file: File) {
  const supabase = client();
  if (!supabase) return false;
  const { error } = await supabase.storage.from(bucketName()).upload(key, file, {
    contentType: file.type,
    cacheControl: "300",
    upsert: true,
  });
  if (error) throw error;
  return true;
}

export async function downloadCourseAsset(key: string) {
  const supabase = client();
  if (!supabase) return null;
  const result = await supabase.storage.from(bucketName()).download(key);
  if (result.error || !result.data) return null;
  return { body: result.data.stream(), contentType: result.data.type || "application/octet-stream" };
}
