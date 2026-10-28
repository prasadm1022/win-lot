// Python <-> TypeScript model parity check over the FULL local history (data/lottery.sqlite).
// 1. scraper/export_parity.py writes Python predictions for every lottery to a temp JSON file.
// 2. vitest runs worker/test/model.parity.test.ts against that file (PARITY_FILE).
import { execSync } from "node:child_process";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const py = ["scraper/.venv/Scripts/python.exe", "scraper/.venv/bin/python"].find((p) => existsSync(p)) ?? "python3";
const out = join(tmpdir(), "win-lot-model-parity.json");
execSync(`"${py}" scraper/export_parity.py --full --out "${out}"`, { stdio: "inherit" });
execSync("npx vitest run worker/test/model.parity.test.ts", { stdio: "inherit", env: { ...process.env, PARITY_FILE: out } });
