import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { envString } from "@/lib/runtime-env";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const target = (url.searchParams.get("return_to") ?? "/").startsWith("/") ? url.searchParams.get("return_to")! : "/";
  const response = NextResponse.redirect(new URL(target, url.origin));
  const supabaseUrl = envString("SUPABASE_URL");
  const supabaseKey = envString("SUPABASE_ANON_KEY");
  if (supabaseUrl && supabaseKey) {
    const cookieStore = await cookies();
    const client = createServerClient(supabaseUrl, supabaseKey, { cookieOptions: { name: "kompetensportalen-auth" }, cookies: { getAll: () => cookieStore.getAll(), setAll: (items) => items.forEach(({ name, value, options }) => response.cookies.set(name, value, options)) } });
    await client.auth.signOut();
  }
  return response;
}
