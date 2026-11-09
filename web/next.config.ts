import type { NextConfig } from "next";
import path from "node:path";

const config: NextConfig = {
  turbopack: { root: path.resolve(__dirname) },
  // Always inlined, so production builds compile the test wallet out entirely.
  env: { NEXT_PUBLIC_TEST_WALLET: process.env.NEXT_PUBLIC_TEST_WALLET === "1" ? "1" : "0" },
};

export default config;
