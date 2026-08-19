import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // avaivy.cloud API routes proxy to Ava origin when available
  async rewrites() {
    return [
      {
        source: "/api/:path*",
        destination: `${process.env.AVA_ORIGIN_URL || "https://ava-origin.rootmc.net"}/api/:path*`,
      },
    ];
  },
};

export default nextConfig;
