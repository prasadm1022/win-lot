// SPDX-License-Identifier: Apache-2.0
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "export",
  trailingSlash: false,
  images: { unoptimized: true },
};

export default nextConfig;
