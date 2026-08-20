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
      // Ported Root Record Ava wiki (static HTML under public/wiki/)
      { source: "/wiki", destination: "/wiki/index.html" },
      { source: "/wiki/", destination: "/wiki/index.html" },
      { source: "/wiki/build", destination: "/wiki/build.html" },
      { source: "/wiki/timeline", destination: "/wiki/timeline.html" },
      { source: "/wiki/events", destination: "/wiki/events.html" },
      {
        source: "/api/:path*",
        destination: `${origin}/api/:path*`,
      },
    ];
  },
};

export default nextConfig;
