import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Ava Ivy",
  description: "HI Pacific Solar Root Server — AI runtime for RootMC and Root Record",
  openGraph: {
    title: "Ava Ivy",
    description: "Solar-powered AI infrastructure on the Big Island of Hawaiʻi",
    url: "https://avaivy.cloud",
    siteName: "Ava Ivy",
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
