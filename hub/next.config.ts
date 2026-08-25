import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  poweredByHeader: false,
  experimental: { optimizePackageImports: ["react-markdown"] }
};

export default nextConfig;
