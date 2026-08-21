import type { NextConfig } from "next";

const origin = process.env.AVA_ORIGIN_URL || "https://ava-origin.rootmc.net";

const nextConfig: NextConfig = {
  async rewrites() {
    return [
      { source: "/api/:path*", destination: `${origin}/api/:path*` },
    ];
  },
};

export default nextConfig;
