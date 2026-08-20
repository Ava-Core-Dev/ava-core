import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  async redirects() {
    return [
      { source: "/index", destination: "/media", permanent: false },
      { source: "/solar", destination: "/", permanent: true },
      { source: "/solar/", destination: "/", permanent: true },
      { source: "/status", destination: "/", permanent: true },
      { source: "/status/", destination: "/", permanent: true },
    ];
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
    const origin = process.env.AVA_ORIGIN_URL || "https://ava-origin.rootmc.net";
    return [
      { source: "/desk", destination: `${origin}/solar` },
      { source: "/desk/", destination: `${origin}/solar` },
      {
        source: "/api/:path*",
        destination: `${origin}/api/:path*`,
      },
    ];
  },
};

export default nextConfig;
