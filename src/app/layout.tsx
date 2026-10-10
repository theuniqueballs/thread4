import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
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

export const metadata: Metadata = {
  title: "THREAD 4 — мастерская промпт-батчей",
  description:
    "Конвейер промпт-батчей: законы, летопись, компилятор, писец, гейты, приёмник. Стеклянная пушка: бьёт планетарно, хрупкость объявлена честно.",
  keywords: ["THREAD 4", "промпт-батчи", "Tsubaki", "Yodayo"],
  authors: [{ name: "Андрюха + Чарли" }],
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ru" suppressHydrationWarning>
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased bg-background text-foreground`}
      >
        {children}
        <Toaster />
      </body>
    </html>
  );
}
