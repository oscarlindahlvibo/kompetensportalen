import { readdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { normalizeOdooCsvBundle } from "../lib/odoo-csv.ts";

const directory = process.argv[2];
const output = process.argv[3] ?? "odoo-normalized.json";
if (!directory) {
  console.error("Usage: node --import tsx scripts/normalize-odoo-csv.mjs <csv-directory> [output.json]");
  process.exit(1);
}
const files = {};
for (const name of await readdir(resolve(directory)))
  if (name.toLowerCase().endsWith(".csv")) files[name.toLowerCase()] = await readFile(join(resolve(directory), name), "utf8");
try {
  const payload = normalizeOdooCsvBundle(files);
  await writeFile(resolve(output), `${JSON.stringify(payload, null, 2)}\n`);
  console.log(`Skrev normaliserad Odoo-export till ${resolve(output)}`);
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}
