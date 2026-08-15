type RuntimeEnv = Record<string, unknown>;

declare global {
  // Reserved for serverless adapters; the Supabase deployment uses process.env.
  var __KOMPETENSPORTALEN_RUNTIME_ENV__: RuntimeEnv | undefined;
}
export function runtimeEnv(): RuntimeEnv {
  const workerEnv = globalThis.__KOMPETENSPORTALEN_RUNTIME_ENV__ ?? {};
  return { ...workerEnv, ...process.env };
}

export function envString(key: string): string | undefined {
  const value = runtimeEnv()[key];
  return typeof value === "string" ? value : undefined;
}
