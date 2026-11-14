import type { NextConfig } from "next";

const apiOrigin = process.env.ASTER_API_ORIGIN || "http://127.0.0.1:8000";

const nextConfig: NextConfig = {
  distDir: process.env.ASTER_DIST_DIR || ".next",
  async rewrites() {
    return [{ source: "/api/:path*", destination: `${apiOrigin}/api/:path*` }];
  },
};

export default nextConfig;
