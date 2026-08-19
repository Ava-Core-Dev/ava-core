import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Root Record — Live Status",
  description: "Real-time dashboard: solar, Kīlauea, NOAA weather, RootMC server, and Ava Ivy ops.",
  openGraph: {
    title: "Root Record",
    description: "Solar · Kīlauea · Weather · Minecraft — Root Record live dashboard",
    url: "https://rootrecord.online",
    siteName: "Root Record",
    locale: "en_US",
    type: "website",
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        <link
          href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&family=JetBrains+Mono:wght@400;500;600&display=swap"
          rel="stylesheet"
        />
        <meta name="theme-color" content="#0a0e14" />
      </head>
      <body>{children}</body>
    </html>
  );
}
