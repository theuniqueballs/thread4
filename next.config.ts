import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  /* config options here */
  typescript: {
    ignoreBuildErrors: false,
  },
  reactStrictMode: false,
  /* аудит 2026-10-12: базовые security-заголовки. Дашборд достижим
   * снаружи через шлюз :81 (Caddyfile) — заголовки держатся на уровне
   * приложения, а не только прокси. Strict-CSP требует nonce-пайплайна
   * для Next inline-скриптов — отдельная задача, не ломаем дашборд. */
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Referrer-Policy", value: "no-referrer" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
        ],
      },
    ];
  },
};

export default nextConfig;
