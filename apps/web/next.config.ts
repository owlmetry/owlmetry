import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  transpilePackages: ["@owlmetry/shared"],
};

export default nextConfig;
