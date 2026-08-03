import type { NextConfig } from "next";

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
        ],
      },
    ];
  },
};

export default nextConfig;
