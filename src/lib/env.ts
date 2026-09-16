import { z } from "zod";

// Fail-closed environment validation.
//
// The staff JWT secret previously fell back to a hardcoded "dev-secret" when
// AUTH_SECRET was unset, which meant a deploy that forgot the variable came up
// looking healthy while every admin/desk token was forgeable. Nothing here has
// a default that matters: a misconfigured install must fail loudly at boot.
//
// The app runs as a single long-lived server on the venue's own machine. There
// is no managed cache, object store or platform scheduler to configure — the
// bus is in-process, photos go to a directory, and the server runs its own
// sweep. See ONPREM_SETUP.md.

const schema = z.object({
  // 32+ chars keeps the HS256 key at least as long as its digest.
  AUTH_SECRET: z
    .string()
    .min(32, "must be at least 32 characters — generate one with: openssl rand -base64 32"),
  DATABASE_URL: z.string().startsWith("postgres", "must be a Postgres connection string"),
  // Authenticates the manual sweep endpoint, which is reachable from the LAN.
  CRON_SECRET: z
    .string()
    .min(16, "must be at least 16 characters — generate one with: openssl rand -base64 24"),
  // Every printed QR is signed and encoded against this origin. Changing it
  // after QRs are printed invalidates the physical codes on the tables.
  NEXT_PUBLIC_BASE_URL: z.string().regex(/^https?:\/\//, "must be an absolute http(s) origin"),
  // Absolute path menu photos are written to. Keep it OUTSIDE the application
  // directory so an app update cannot delete the venue's uploaded images.
  UPLOAD_DIR: z.string().min(1).default("/var/lib/masadan/uploads"),
  // "1" when a reverse proxy (Caddy/nginx) fronts the app and APPENDS the real
  // client address to X-Forwarded-For. The rate limiter then reads the last hop
  // of that header, which the proxy wrote, rather than the first, which the
  // client can write. Leave at "0" when the Node server is exposed directly.
  TRUST_PROXY: z.enum(["0", "1"]).default("0"),
});

export type Env = z.infer<typeof schema>;

let cached: Env | undefined;

/**
 * Validates and returns the server environment. Throws on the first call if
 * anything is missing or malformed, listing every problem at once.
 */
export function getEnv(): Env {
  if (cached) return cached;
  const parsed = schema.safeParse(process.env);
  if (!parsed.success) {
    const problems = parsed.error.issues
      .map((i) => `  ${i.path.join(".") || "(root)"}: ${i.message}`)
      .join("\n");
    throw new Error(`Invalid environment configuration:\n${problems}`);
  }
  cached = parsed.data;
  return cached;
}

/** Test seam: forget the memoised environment. */
export function resetEnvCache(): void {
  cached = undefined;
}

/**
 * The origin every table QR is signed against.
 *
 * MUST be read through here rather than as `process.env.NEXT_PUBLIC_BASE_URL`.
 * Next.js substitutes `NEXT_PUBLIC_*` references with string literals at build
 * time, so a direct read is frozen to whatever the *build machine* had — which
 * meant QR codes printed at a venue encoded the developer's address. getEnv()
 * passes the whole `process.env` object to zod, which Next cannot inline, so
 * the value is whatever the server was actually started with.
 */
export function baseUrl(): string {
  return getEnv().NEXT_PUBLIC_BASE_URL;
}

/**
 * True when the venue is served over TLS, derived from the origin the QRs are
 * signed against rather than NODE_ENV — a venue may run NODE_ENV=production
 * over a plain-http LAN address, and marking cookies `secure` there would stop
 * the browser ever sending them back.
 */
export function isSecureOrigin(): boolean {
  return getEnv().NEXT_PUBLIC_BASE_URL.startsWith("https://");
}

/** True when X-Forwarded-For's last hop was written by a proxy we run. */
export function trustProxy(): boolean {
  return getEnv().TRUST_PROXY === "1";
}
