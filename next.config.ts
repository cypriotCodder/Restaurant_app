import type { NextConfig } from "next";

// Everything this app renders is first-party: no third-party scripts, no
// embeds, no remote styles. The one exception is next/font/google, which is
// self-hosted at build time and so needs no font-src entry of its own.
const csp = [
  "default-src 'self'",
  // Next's inline bootstrap and hydration payload require 'unsafe-inline'
  // here; there is no third-party script origin to allow beyond that.
  "script-src 'self' 'unsafe-inline'",
  // Tailwind and the design tokens are applied as inline style attributes.
  "style-src 'self' 'unsafe-inline'",
  // Menu photos come from Vercel Blob; data: covers the generated QR PNGs.
  "img-src 'self' data: blob: https://*.public.blob.vercel-storage.com",
  "font-src 'self' data:",
  // XHR/SSE are same-origin only.
  "connect-src 'self'",
  "form-action 'self'",
  "base-uri 'self'",
  "object-src 'none'",
  // Belt-and-braces alongside the X-Frame-Options header below.
  "frame-ancestors 'none'",
  "upgrade-insecure-requests",
].join("; ");

const nextConfig: NextConfig = {
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          // Customers reach this over public cafe wifi via a QR code, so
          // downgrade protection matters more than usual.
          {
            key: "Strict-Transport-Security",
            value: "max-age=63072000; includeSubDomains; preload",
          },
          { key: "X-Content-Type-Options", value: "nosniff" },
          // Nothing here is meant to be framed; blocks clickjacking of the
          // desk and admin surfaces.
          { key: "X-Frame-Options", value: "DENY" },
          // The signed QR token rides in the query string — keep it out of
          // Referer headers sent to third parties.
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          {
            key: "Permissions-Policy",
            value: "camera=(), microphone=(), geolocation=()",
          },
          { key: "Content-Security-Policy", value: csp },
        ],
      },
    ];
  },
};

export default nextConfig;
