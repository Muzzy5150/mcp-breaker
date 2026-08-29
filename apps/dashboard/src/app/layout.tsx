import type { Metadata } from "next";
import type { ReactNode } from "react";

import "./globals.css";

export const metadata: Metadata = {
  metadataBase: new URL("http://127.0.0.1:3000"),
  title: "MCP Breaker — Security Evidence Dashboard",
  description: "Replay-verified evidence for MCP tool safety assessments.",
  openGraph: {
    title: "MCP BREAKER",
    description: "Replay-verified evidence for AI tool safety.",
    images: [{ url: "/og.png", width: 1200, height: 630, alt: "MCP Breaker security evidence dashboard" }],
  },
  twitter: {
    card: "summary_large_image",
    title: "MCP BREAKER",
    description: "Replay-verified evidence for AI tool safety.",
    images: ["/og.png"],
  },
};

export default function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
