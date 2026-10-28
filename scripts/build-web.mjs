// SPDX-License-Identifier: Apache-2.0
// Builds the UI (web/) if present. Tolerates a missing web/ so the Worker can be built/tested alone.
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { execSync } from "node:child_process";

if (existsSync("web/package.json")) {
  if (!existsSync("web/node_modules")) execSync("npm install", { cwd: "web", stdio: "inherit" });
  execSync("npm run build", { cwd: "web", stdio: "inherit" });
} else {
  console.warn("web/ not found - writing a placeholder web/dist/index.html");
  mkdirSync("web/dist", { recursive: true });
  if (!existsSync("web/dist/index.html")) {
    writeFileSync("web/dist/index.html", "<!doctype html><title>win-lot</title><p>UI not built yet. API: <a href=/api/lotteries>/api/lotteries</a></p>\n");
  }
}
