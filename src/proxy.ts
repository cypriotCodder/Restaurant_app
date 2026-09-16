import { NextResponse, type NextRequest } from "next/server";
import { isSecureOrigin } from "@/lib/env";

// Per-request Content-Security-Policy for rendered pages.
//
// next.config.ts used to send one static policy with `script-src
// 'unsafe-inline'`, because Next's hydration bootstrap is an inline script.
// A nonce minted here lets that bootstrap run while refusing every other
// inline script, which is the difference between "an injected <script> runs"
// and "it does not" should an XSS ever slip past React's escaping. Next reads
// the nonce out of this header and stamps it on its own script tags.
//
// Every page in this app is dynamically rendered (they all read cookies or
// the database), which nonces require. API routes and static assets keep the
// static policy from next.config.ts; they render no HTML.

export function buildCsp(nonce: string, opts: { dev: boolean; https: boolean }): string {
  return [
    "default-src 'self'",
    // 'strict-dynamic' lets the nonce'd bootstrap load the chunks it needs
    // without listing them; 'unsafe-eval' in DEVELOPMENT ONLY, for React's
    // debugging call-stack reconstruction (see the note that used to live in
    // next.config.ts).
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${opts.dev ? " 'unsafe-eval'" : ""}`,
    // Tailwind and the design tokens are applied as inline style ATTRIBUTES,
    // which a nonce cannot cover; only <style> elements can carry one.
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
    "frame-ancestors 'none'",
    ...(opts.https ? ["upgrade-insecure-requests"] : []),
  ].join("; ");
}

export function proxy(request: NextRequest) {
  const nonce = Buffer.from(crypto.randomUUID()).toString("base64");
  const csp = buildCsp(nonce, {
    dev: process.env.NODE_ENV !== "production",
    https: isSecureOrigin(),
  });

  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-nonce", nonce);
  requestHeaders.set("Content-Security-Policy", csp);

  const response = NextResponse.next({ request: { headers: requestHeaders } });
  response.headers.set("Content-Security-Policy", csp);
  return response;
}

export const config = {
  matcher: [
    {
      // Pages only. API routes, static chunks and the image optimiser get the
      // static policy from next.config.ts; a prefetch needs no nonce.
      source: "/((?!api|_next/static|_next/image|favicon.ico).*)",
      missing: [
        { type: "header", key: "next-router-prefetch" },
        { type: "header", key: "purpose", value: "prefetch" },
      ],
    },
  ],
};
