import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  transpilePackages: ["@offeros/core", "@offeros/pdf"],
  serverExternalPackages: ["better-sqlite3", "playwright"],
};

export default nextConfig;
