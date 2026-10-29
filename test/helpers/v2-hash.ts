// SPDX-License-Identifier: Apache-2.0
// Prints the sha256 (hex) of the predictAllV2 output on the committed data/ files, as one line. Run in two separate
// tsx processes by test/model-v2.determinism.test.ts (docs/MODEL-V2.md sections 2.16 and 6).
import { predictAllV2 } from "../../lib/model-v2";
import { loadV2Inputs, sha256Json } from "../../scripts/model-v2-data";

process.stdout.write(`${sha256Json(predictAllV2(loadV2Inputs()))}\n`);
