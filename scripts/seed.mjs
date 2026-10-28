// SPDX-License-Identifier: Apache-2.0
// Applies seed/*.sql to D1 in order: node scripts/seed.mjs --local | --remote
import { readdirSync } from "node:fs";
import { execSync } from "node:child_process";

const target = process.argv.includes("--remote") ? "--remote" : "--local";
const files = readdirSync("seed").filter((f) => f.endsWith(".sql")).sort();
for (const file of files) {
  console.log(`applying seed/${file} (${target})`);
  execSync(`npx wrangler d1 execute win-lot ${target} --yes --file seed/${file}`, { stdio: ["ignore", "ignore", "inherit"] });
}
console.log(`applied ${files.length} seed files`);
