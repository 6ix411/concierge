import type { NextConfig } from "next";

const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(self)" },
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" },
];

const nextConfig: NextConfig = {
  poweredByHeader: false,
  reactStrictMode: true,
  experimental: {
    // Review photos are posted through a server action: up to 4 photos of 5MB each, plus form overhead.
    serverActions: { bodySizeLimit: "21mb" },
    // The proxy buffers request bodies too, so it needs the same headroom.
    proxyClientMaxBodySize: "21mb",
  },
  images: {
    remotePatterns: [
      // Supabase Storage (business portfolios, avatars, chat uploads).
      { protocol: "https", hostname: "*.supabase.co", pathname: "/storage/v1/object/**" },
      { protocol: "http", hostname: "127.0.0.1", port: "54321", pathname: "/storage/v1/object/**" },
    ],
    // Next blocks optimizing images from private IPs; allow it only when Supabase itself runs locally.
    dangerouslyAllowLocalIP: (process.env.NEXT_PUBLIC_SUPABASE_URL ?? "").startsWith("http://127.0.0.1"),
  },
  async headers() {
    return [
      { source: "/:path*", headers: securityHeaders },
      {
        // The service worker must always be fresh so fixes reach installed apps at once.
        source: "/sw.js",
        headers: [
          { key: "Content-Type", value: "application/javascript; charset=utf-8" },
          { key: "Cache-Control", value: "no-cache, no-store, must-revalidate" },
          { key: "Content-Security-Policy", value: "default-src 'self'; script-src 'self'" },
        ],
      },
    ];
  },
};

export default nextConfig;
