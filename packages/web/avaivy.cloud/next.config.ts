import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  async redirects() {
    return [{ source: "/index", destination: "/media", permanent: false }];
  },
  async headers() {
    return [
      {
        source: "/live/embed",
        headers: [{ key: "Content-Security-Policy", value: "frame-ancestors *" }],
      },
    ];
  },
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
