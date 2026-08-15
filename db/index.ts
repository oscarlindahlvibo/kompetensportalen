import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as postgresSchema from "./schema-pg";
import { envString } from "@/lib/runtime-env";

// The two Drizzle dialects expose the same query surface but different generic types.
// Keeping the provider boundary here avoids leaking a dialect union through every route.
export function getDb(): ReturnType<typeof drizzle> {
  const connectionString = envString("SUPABASE_DB_URL") ?? envString("DATABASE_URL");
  if (!connectionString || connectionString.startsWith("file:"))
    throw new Error("SUPABASE_DB_URL or a PostgreSQL DATABASE_URL is required.");
  return drizzle(postgres(connectionString, { max: 10, prepare: false }), { schema: postgresSchema }) as unknown as ReturnType<typeof drizzle>;
}
