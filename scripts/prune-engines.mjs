#!/usr/bin/env node
// Removes Prisma native query engines for platforms the target machine is not.
//
// prisma generate emits one engine per entry in schema.prisma's binaryTargets.
// The venue needs "windows"; "native" is there so the same checkout still works
// on the developer machine. Both end up in the bundle, so a build made on macOS
// carries ~36 MB of .dylib that Windows can never load, on every update pushed
// over a restaurant's internet connection.
//
// Only NATIVE engines are touched. The .wasm runtimes alongside them are
// per-database-provider rather than per-platform, and it is not obvious that
// nothing loads them — a wrong guess there breaks a venue's ordering to save a
// few megabytes, which is not a trade worth taking.
//
// Usage:
//   node scripts/prune-engines.mjs --keep windows [--dry-run]

import { readdirSync, statSync, unlinkSync } from "fs";
import path from "path";

const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const keepIndex = args.indexOf("--keep");
const keep = keepIndex !== -1 ? args[keepIndex + 1] : "windows";

if (!keep || keep.startsWith("--")) {
  console.error("--keep needs a platform, e.g. --keep windows");
  process.exit(1);
}

const bundleModules = path.join(process.cwd(), ".next", "standalone", "node_modules");

try {
  statSync(bundleModules);
} catch {
  console.error(
    "no .next/standalone/node_modules — run this after `npm run package`."
  );
  process.exit(1);
}

/**
 * Native engine filenames, by platform convention:
 *   libquery_engine-darwin-arm64.dylib[.node]   macOS
 *   libquery_engine-debian-openssl-3.0.x.so.node  Linux
 *   query_engine-windows.dll.node                 Windows
 *
 * Matching on these shapes rather than on "anything big" keeps the blast radius
 * to files whose purpose is unambiguous.
 */
const ENGINE_NAME = /^(lib)?query_engine-/;
const NATIVE_EXT = /\.(dylib|so|dll)\b/;

/**
 * Matched in two parts rather than as one anchored pattern, because real
 * bundles contain filenames the anchored form misses — a node_modules that has
 * been copied around on macOS grows Finder duplicates like
 * "libquery_engine-darwin-arm64.dylib 2.node", which is still 18 MB of engine
 * the target cannot load.
 *
 * The hyphen in the prefix is what separates these from the .wasm runtimes
 * (query_engine_bg.*), which are per-provider and deliberately left alone.
 */
function isNativeEngine(name) {
  return ENGINE_NAME.test(name) && NATIVE_EXT.test(name);
}

function walk(dir, found = []) {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return found; // unreadable directory: nothing to prune in it
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, found);
    else if (entry.isFile() && isNativeEngine(entry.name)) found.push(full);
  }
  return found;
}

const engines = walk(bundleModules);
const kept = engines.filter((f) => path.basename(f).includes(keep));
const drop = engines.filter((f) => !path.basename(f).includes(keep));

if (engines.length === 0) {
  console.error("found no Prisma native engines at all — is this a real bundle?");
  process.exit(1);
}

// The guard that matters. Without an engine for the target platform the bundle
// cannot serve a single query, and pruning would be turning a working bundle
// into a broken one.
if (kept.length === 0) {
  console.error(
    `refusing to prune: no engine for "${keep}" in the bundle.\n` +
      `Found: ${engines.map((f) => path.basename(f)).join(", ")}\n` +
      `Check binaryTargets in prisma/schema.prisma includes "${keep}".`
  );
  process.exit(1);
}

let freed = 0;
for (const file of drop) {
  const { size } = statSync(file);
  freed += size;
  const rel = path.relative(process.cwd(), file);
  if (dryRun) {
    console.log(`would remove ${rel} (${(size / 1048576).toFixed(1)} MB)`);
  } else {
    unlinkSync(file);
    console.log(`removed ${rel} (${(size / 1048576).toFixed(1)} MB)`);
  }
}

const mb = (freed / 1048576).toFixed(1);
console.log(
  drop.length === 0
    ? `nothing to prune; only ${keep} engines present`
    : `${dryRun ? "would free" : "freed"} ${mb} MB (kept ${kept.length} ${keep} engine${kept.length === 1 ? "" : "s"})`
);
