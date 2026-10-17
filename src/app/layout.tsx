import type { Metadata } from "next";
import { Geist, Geist_Mono, Orbitron, JetBrains_Mono } from "next/font/google";
import "./globals.css";
import { Toaster } from "@/components/ui/toaster";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

/* NEON DOGMA layer (2026-10-18): Orbitron drives EVA-style display
 * headings; JetBrains Mono drives the chain.jsonl terminal. */
const orbitron = Orbitron({
  variable: "--font-orbitron",
  subsets: ["latin"],
});

const jetbrainsMono = JetBrains_Mono({
  variable: "--font-jbmono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "THREAD-4 // CENTRAL DOGMA — Pipeline Control",
  description:
    "Neon-anime cyberpunk control deck for the THREAD 4 prompt-batch pipeline: hash-chain chronicle stream, 24-gate compiler matrix, rotation window, waifu operators.",
  keywords: ["THREAD 4", "prompt pipeline", "hash chain", "Tsubaki", "Charlie", "CENTRAL DOGMA"],
  authors: [{ name: "Андрюха + Чарли" }],
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    /* Neon-dogma dashboard chrome is EN (2026-10-18 redesign); chain data
     * itself stays multilingual (author's chronicle is RU). */
    <html lang="en" suppressHydrationWarning className="dark">
      <body
        className={`${geistSans.variable} ${geistMono.variable} ${orbitron.variable} ${jetbrainsMono.variable} antialiased bg-background text-foreground`}
      >
        {children}
        <Toaster />
      </body>
    </html>
  );
}
