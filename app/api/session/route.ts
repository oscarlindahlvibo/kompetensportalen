import { currentIdentity } from "@/lib/server-auth";

export const dynamic = "force-dynamic";

export async function GET() {
  const user = await currentIdentity();
  return Response.json(user ? { authenticated: true, user: { displayName: user.displayName, email: user.email } } : { authenticated: false });
}
