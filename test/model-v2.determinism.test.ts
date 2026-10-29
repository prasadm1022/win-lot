// SPDX-License-Identifier: Apache-2.0
// Determinism contract of win-lot-jackpot-v2 (docs/MODEL-V2.md sections 2.16 and 6): two separate tsx processes
// (test/helpers/v2-hash.ts) print the same sha256 of the predictAllV2 output, and two calls in one process are
// deep-equal (and leave their inputs untouched).
import { execFile } from "node:child_process";
import { join } from "node:path";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";
import { predictAllV2 } from "../lib/model-v2";
import { ROOT, loadV2Inputs, sha256Json } from "../scripts/model-v2-data";

const run = promisify(execFile);
const TSX_CLI = join(ROOT, "node_modules", "tsx", "dist", "cli.mjs");
const HELPER = join(ROOT, "test", "helpers", "v2-hash.ts");

async function hashInSeparateProcess(): Promise<string> {
  const { stdout } = await run(process.execPath, [TSX_CLI, HELPER], { cwd: ROOT, encoding: "utf8", timeout: 120_000 });
  return stdout.trim();
}

describe("determinism", () => {
  it("two separate tsx processes print the same sha256 of the predictAllV2 output (equal to this process)", async () => {
    const [a, b] = await Promise.all([hashInSeparateProcess(), hashInSeparateProcess()]);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
    expect(b).toBe(a);
    expect(sha256Json(predictAllV2(loadV2Inputs()))).toBe(a);
  }, 180_000);

  it("two calls in one process are deep-equal and do not modify their inputs", () => {
    const inputs = loadV2Inputs();
    const before = JSON.stringify(inputs);
    const first = predictAllV2(inputs);
    const second = predictAllV2(inputs);
    expect(JSON.stringify(inputs)).toBe(before);
    expect(second).toEqual(first);
    expect(JSON.stringify(second)).toBe(JSON.stringify(first));
    // No shared references between the two results (mutating one cannot change the other).
    second["dhana-nidhanaya"].sets[0].numbers.push(99);
    expect(first["dhana-nidhanaya"].sets[0].numbers).toHaveLength(4);
  }, 120_000);
});
