import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  transpilePackages: ["@offeros/core", "@offeros/pdf"],
  serverExternalPackages: ["better-sqlite3", "playwright"],
  // A verification build must not write where a running dev server reads.
  //
  // `next build` and `next dev` share `.next`, and the production output wins:
  // build once while the dev server is up and it keeps serving that snapshot,
  // silently, no matter what you edit afterwards. That is not theoretical — the
  // pre-push hook builds on every push, so every push used to freeze the app
  // the owner was looking at. Setting NEXT_DIST_DIR gives those builds their
  // own directory.
  distDir: process.env.NEXT_DIST_DIR || ".next",
};

export default nextConfig;
