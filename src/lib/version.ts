import { readFileSync } from "node:fs";
import path from "node:path";

// Build identity of the running bundle, written by scripts/stamp-version.mjs
// during `npm run package`. See that file for why it is a file and not a
// compiled-in constant.

export type BuildVersion = {
  version: string;
  commit: string | null;
  dirty: boolean;
  builtAt: string;
};

/** What a development server reports: there is no stamped bundle. */
const DEV: BuildVersion = {
  version: "dev",
  commit: null,
  dirty: false,
  builtAt: new Date(0).toISOString(),
};

let cached: BuildVersion | null = null;

/**
 * Reads the stamp once per process. The file cannot change under a running
 * server — an update swaps the whole release directory and restarts — so
 * re-reading it would only add syscalls to a health check that monitoring
 * hits every minute.
 */
export function buildVersion(): BuildVersion {
  if (cached) return cached;
  try {
    // turbopackIgnore: resolved against the bundle at runtime, not traced.
    const raw = readFileSync(
      /* turbopackIgnore: true */ path.join(process.cwd(), "version.json"),
      "utf8"
    );
    const parsed = JSON.parse(raw) as Partial<BuildVersion>;
    // A malformed stamp is reported as unknown rather than crashing the health
    // endpoint — the one endpoint that must answer when things are wrong.
    cached =
      typeof parsed.version === "string"
        ? {
            version: parsed.version,
            commit: typeof parsed.commit === "string" ? parsed.commit : null,
            dirty: parsed.dirty === true,
            builtAt: typeof parsed.builtAt === "string" ? parsed.builtAt : DEV.builtAt,
          }
        : { ...DEV, version: "unknown" };
  } catch {
    cached = DEV;
  }
  return cached;
}

/** Single-line form for logs and the health payload: "0.1.0+a1b2c3". */
export function versionLabel(): string {
  const v = buildVersion();
  return `${v.version}${v.commit ? `+${v.commit}` : ""}${v.dirty ? "-dirty" : ""}`;
}
