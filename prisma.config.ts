import { existsSync } from "node:fs";
import path from "node:path";
import { defineConfig } from "prisma/config";

// The Prisma CLI loads `.env` only, but the Neon credentials live in
// `.env.local` (written by `vercel env pull`, gitignored) while `.env` still
// carries the retired SQLite URL. Load `.env.local` first so migrations and
// the seed hit Neon. Values already present in the real environment win, so
// CI and Vercel builds — which have no `.env.local` — are unaffected.
const localEnv = path.join(process.cwd(), ".env.local");
if (existsSync(localEnv)) process.loadEnvFile(localEnv);

export default defineConfig({
  schema: path.join("prisma", "schema.prisma"),
  migrations: {
    seed: "node --env-file-if-exists=.env.local prisma/seed.mjs",
  },
});
