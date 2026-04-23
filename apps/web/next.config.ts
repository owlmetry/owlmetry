import type { NextConfig } from "next";
import { createMDX } from "fumadocs-mdx/next";

const withMDX = createMDX();

const nextConfig: NextConfig = {
  output: "standalone",
  poweredByHeader: false,
  transpilePackages: ["@owlmetry/shared"],
  distDir: process.env.NODE_ENV === "development" ? ".next-dev" : ".next",
};

export default withMDX(nextConfig);
