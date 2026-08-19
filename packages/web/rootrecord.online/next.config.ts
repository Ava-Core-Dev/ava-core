import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  async rewrites() {
    const origin = process.env.AVA_ORIGIN_URL || "https://ava-origin.rootmc.net";
    return [
      { source: "/api/:path*", destination: `${origin}/api/:path*` },
    ];
  },
};

export default nextConfig;
