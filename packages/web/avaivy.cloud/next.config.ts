import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  async redirects() {
    return [
      { source: "/index", destination: "/media", permanent: false },
      // Status alias → home (solar desk). Keep /solar for Worker→origin iframe target.
      { source: "/status", destination: "/", permanent: false },
      { source: "/status/", destination: "/", permanent: false },
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
  async rewrites() {
    const origin = process.env.AVA_ORIGIN_URL || "https://ava-origin.rootmc.net";
    return [
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
