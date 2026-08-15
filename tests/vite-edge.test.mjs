import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

const read = (file) => readFileSync(new URL(`../${file}`, import.meta.url), "utf8");

test("the client is a Vite application", () => {
  const packageJson = JSON.parse(read("package.json"));
  assert.equal(packageJson.scripts.build, "vite build");
  assert.equal(packageJson.scripts.dev, "vite");
  assert.equal(existsSync(new URL("../src/main.tsx", import.meta.url)), true);
  assert.equal(existsSync(new URL("../app", import.meta.url)), false);
});

test("the client uses Supabase instead of server routes", () => {
  const source = read("src/main.tsx");
  assert.match(source, /@supabase\/supabase-js/);
  assert.match(source, /functions\.invoke\("api"/);
  assert.doesNotMatch(source, /from ["']next\//);
});

test("the API is a deployable Supabase Edge Function", () => {
  const source = read("supabase/functions/api/index.ts");
  assert.match(source, /Deno\.serve/);
  assert.match(source, /kompetensportalen/);
  assert.match(source, /course-assets/);
});

test("the shared database has an isolated schema", () => {
  const migration = read("supabase/migrations/0000_same_bushwacker.sql");
  assert.match(migration, /CREATE SCHEMA IF NOT EXISTS kompetensportalen/);
  assert.match(migration, /"kompetensportalen"\."courses"/);
});
