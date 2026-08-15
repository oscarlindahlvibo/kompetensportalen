import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { envString } from "@/lib/runtime-env";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const returnTo = url.searchParams.get("return_to") ?? "/";
  const target = returnTo.startsWith("/") && !returnTo.startsWith("//") ? returnTo : "/";
  const response = NextResponse.redirect(new URL(target, url.origin));
  if (!code) return NextResponse.redirect(new URL(`/login?error=missing_code`, url.origin));
  const supabaseUrl = envString("SUPABASE_URL");
  const supabaseKey = envString("SUPABASE_ANON_KEY");
  if (!supabaseUrl || !supabaseKey) return NextResponse.redirect(new URL(`/login?error=supabase_not_configured`, url.origin));
  const cookieStore = await cookies();
  const client = createServerClient(supabaseUrl, supabaseKey, {
    cookieOptions: { name: "kompetensportalen-auth" },
    cookies: {
      getAll: () => cookieStore.getAll(),
      setAll: (items) => items.forEach(({ name, value, options }) => response.cookies.set(name, value, options)),
    },
  });
  await client.auth.exchangeCodeForSession(code);
  return response;
}
