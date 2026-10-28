// SPDX-License-Identifier: Apache-2.0
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["worker/test/**/*.test.ts"],
    environment: "node",
  },
});
