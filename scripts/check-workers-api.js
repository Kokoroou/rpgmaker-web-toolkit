#!/usr/bin/env node
// Checks the Workers API requests of update-from-link (cli/lib/workers-api.js)
// against Cloudflare's published OpenAPI schema. Run weekly by
// .github/workflows/workers-api.yml, or by hand:
//   node scripts/check-workers-api.js [openapi.json]

import fs from "node:fs";
import { WORKERS_API, checkWorkersApi } from "../cli/lib/workers-api.js";

const file = process.argv[2];
let text;
if (file) {
  text = fs.readFileSync(file, "utf8");
} else {
  const res = await fetch(WORKERS_API.schema);
  if (!res.ok) throw new Error(`Could not download ${WORKERS_API.schema}: HTTP ${res.status}`);
  text = await res.text();
}

const problems = checkWorkersApi(JSON.parse(text));
if (problems.length) {
  console.error(`The Cloudflare Workers API changed since ${WORKERS_API.checked}; update-from-link may no longer work:`);
  for (const p of problems) console.error(`  - ${p}`);
  console.error("Fix cli/lib/workers-api.js, then update WORKERS_API.checked.");
  process.exit(1);
}
console.log(`The Workers API still matches what update-from-link sends (checked on ${WORKERS_API.checked}).`);
