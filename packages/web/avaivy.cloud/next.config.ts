import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Low-RAM OmniBook: one static page at a time avoids worker OOM during prerender.
  experimental: {
    staticGenerationMaxConcurrency: 1,
    staticGenerationMinPagesPerWorker: 200,
  },
  async redirects() {
    return [
      { source: "/index", destination: "/media", permanent: false },
      { source: "/chat", destination: "/#talk", permanent: false },
      { source: "/chat/", destination: "/#talk", permanent: false },
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
    const origin = process.env.AVA_ORIGIN_URL || "https://origin.avaivy.cloud";
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
