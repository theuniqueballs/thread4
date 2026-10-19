import type { Metadata } from "next";
import { Geist, Geist_Mono, JetBrains_Mono } from "next/font/google";
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

/* Console layer (2026-10-18 redesign): JetBrains Mono drives the
 * chain.jsonl chronicle terminal and all hash/seq readouts. */
const jetbrainsMono = JetBrains_Mono({
  variable: "--font-jbmono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "THREAD 4 — Конвейер",
  description:
    "Единый конвейер THREAD 4: пять этапов жизни батча на одном экране — приказ и раскрытие темы, компиляция, сборка движка, писец, сдача в хеш-цепь. Одна кнопка «Запустить конвейер», ручной override любого этапа, живая консоль Rust-ядра.",
  keywords: ["THREAD 4", "конвейер", "pipeline", "hash chain", "Rust engine", "scribes", "prompt pipeline"],
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ru" suppressHydrationWarning className="dark">
      <body
        className={`${geistSans.variable} ${geistMono.variable} ${jetbrainsMono.variable} antialiased bg-background text-foreground`}
      >
        {children}
        <Toaster />
      </body>
    </html>
  );
}
