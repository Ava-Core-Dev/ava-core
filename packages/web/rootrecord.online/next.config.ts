import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  async redirects() {
    return [
      // Consolidate: Root Record marketing + goals live on rootrecord.info
      { source: "/:path*", destination: "https://rootrecord.info/:path*", permanent: true },
    ];
  },
};

export default nextConfig;
