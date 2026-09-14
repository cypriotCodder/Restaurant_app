import type { NextConfig } from "next";

// Everything this app renders is first-party: no third-party scripts, no
// embeds, no remote styles. The one exception is next/font/google, which is
// self-hosted at build time and so needs no font-src entry of its own.
// An on-prem venue may be served over plain http on the LAN. Deriving this from
// the QR origin rather than NODE_ENV keeps the production build correct on both
// targets: upgrade-insecure-requests over http rewrites every request to a port
// nothing is listening on, and HSTS over http is meaningless at best.
const isHttps = (process.env.NEXT_PUBLIC_BASE_URL ?? "").startsWith("https://");
const isDev = process.env.NODE_ENV !== "production";

/**
 * Hosts allowed to load dev resources: whatever NEXT_PUBLIC_BASE_URL points at,
 * plus private-network ranges so a phone can reach the dev server by IP.
 * Development only — production serves no /_next/* dev endpoints.
 */
function devOrigins(): string[] {
  const origins = ["localhost", "127.0.0.1", "*.local", "192.168.*.*", "10.*.*.*", "172.*.*.*"];
  try {
    const host = new URL(process.env.NEXT_PUBLIC_BASE_URL ?? "").hostname;
    if (host && !origins.includes(host)) origins.push(host);
  } catch {
    // No base URL configured yet; the defaults still cover a LAN.
  }
  return origins;
}

const csp = [
  "default-src 'self'",
  // Next's inline bootstrap and hydration payload require 'unsafe-inline'
  // here; there is no third-party script origin to allow beyond that.
  //
  // 'unsafe-eval' in DEVELOPMENT ONLY. React's development build calls eval()
  // for debugging features (reconstructing callstacks across environments).
  // Without it the browser refuses, React never mounts, and every page renders
  // as the bare server-side shell — which looked like a broken QR code.
  //
  // Confirmed from the browser console, not by inspecting the bundle: grepping
  // the dev chunks for "eval(" finds nothing, because the call is not a literal
  // in the shipped text. React states it never uses eval() in production, so
  // the deployed policy stays strict.
  `script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ""}`,
  // Tailwind and the design tokens are applied as inline style attributes.
  "style-src 'self' 'unsafe-inline'",
  // Menu photos are served from this origin via /api/media; data: and blob:
  // cover the generated QR PNGs and client-side image previews.
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  // XHR/SSE are same-origin only.
  "connect-src 'self'",
  "form-action 'self'",
  "base-uri 'self'",
  "object-src 'none'",
  // Belt-and-braces alongside the X-Frame-Options header below.
  "frame-ancestors 'none'",
  ...(isHttps ? ["upgrade-insecure-requests"] : []),
].join("; ");

const nextConfig: NextConfig = {
  // In development, Next blocks requests to /_next/* dev resources from any
  // origin other than localhost. A phone on the venue wifi — or a laptop using
  // the machine's hostname — is "cross-origin" by that rule, so the client
  // bundle never loads and every page is stuck on its server-rendered shell.
  // The customer page shows only a loading dot in that state, which looks
  // exactly like a broken QR code.
  //
  // Derived from the origin QRs are signed against, so it follows
  // NEXT_PUBLIC_BASE_URL instead of being another value to keep in sync.
  allowedDevOrigins: devOrigins(),

  // Emits .next/standalone with a self-contained server.js and only the
  // node_modules actually imported — installing on the restaurant PC is then a
  // copy of that directory plus `node server.js`, with no npm install there.
  // `npm run package` assembles the full bundle.
  output: "standalone",
  // A stray package-lock.json in a parent directory makes Next infer the wrong
  // workspace root, which nests the standalone build under the whole absolute
  // path. Pin it to this project so .next/standalone/server.js sits at the top.
  outputFileTracingRoot: import.meta.dirname,
  turbopack: { root: import.meta.dirname },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          // Customers reach this over public cafe wifi via a QR code, so
          // downgrade protection matters more than usual. Omitted entirely on a
          // plain-http on-prem deployment, where it cannot apply.
          ...(isHttps
            ? [
                {
                  key: "Strict-Transport-Security",
                  value: "max-age=63072000; includeSubDomains; preload",
                },
              ]
            : []),
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
