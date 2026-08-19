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
      <body>{children}</body>
    </html>
  );
}
