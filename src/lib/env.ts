import { z } from "zod";

// Fail-closed environment validation.
//
// The staff JWT secret previously fell back to a hardcoded "dev-secret" when
// AUTH_SECRET was unset, which meant a deploy that forgot the variable came up
// looking healthy while every admin/desk token was forgeable. Nothing here has
// a default: a misconfigured deployment must fail loudly at boot instead.

const schema = z.object({
  // 32+ chars keeps the HS256 key at least as long as its digest.
  AUTH_SECRET: z
    .string()
    .min(32, "must be at least 32 characters — generate one with: openssl rand -base64 32"),
  DATABASE_URL: z.string().startsWith("postgres", "must be a Postgres connection string"),
  DATABASE_URL_UNPOOLED: z
    .string()
    .startsWith("postgres", "must be the unpooled Postgres string used for migrations"),
  REDIS_URL: z
    .string()
    .regex(/^rediss?:\/\//, "must be a redis:// or rediss:// URL — the REST endpoint cannot SUBSCRIBE"),
  BLOB_READ_WRITE_TOKEN: z.string().min(1, "missing Vercel Blob token"),
  // Authenticates the Vercel Cron call to /api/cron/pos-sweep. Vercel populates
  // this automatically for projects with a cron schedule, but it is required
  // here so a deploy without it fails loudly rather than shipping an outbox
  // whose only retry path is an open endpoint.
  CRON_SECRET: z.string().min(16, "must be at least 16 characters — Vercel generates this for cron projects"),
  // Every printed QR is signed and encoded against this origin. Changing it
  // after QRs are printed invalidates the physical codes on the tables.
  NEXT_PUBLIC_BASE_URL: z.string().regex(/^https?:\/\//, "must be an absolute http(s) origin"),
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
