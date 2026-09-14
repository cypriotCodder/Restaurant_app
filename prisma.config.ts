import { existsSync } from "node:fs";
import path from "node:path";
import { defineConfig } from "prisma/config";

// The Prisma CLI loads `.env` only. Local development keeps its credentials in
// `.env.local` (gitignored), so load that first. Values already present in the
// real environment win, so the venue's server — which passes DATABASE_URL in
// its systemd EnvironmentFile and has no `.env.local` — is unaffected.
const localEnv = path.join(process.cwd(), ".env.local");
if (existsSync(localEnv)) process.loadEnvFile(localEnv);

export default defineConfig({
  schema: path.join("prisma", "schema.prisma"),
  migrations: {
    seed: "node --env-file-if-exists=.env.local prisma/seed.mjs",
  },
});
