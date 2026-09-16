#!/usr/bin/env node
// Puts the venue platform's native sharp binding into the standalone bundle.
//
// sharp only installs the binding for the machine it is installed on. A bundle
// built on macOS therefore ships @img/sharp-darwin-arm64 and, as a fallback,
// @img/sharp-wasm32 — and on the Windows venue PC sharp quietly loads the
// WebAssembly build, which resizes menu photos several times slower than
// native. This fetches the target's prebuilt package with `npm pack` (never
// `npm install`, which would prune the traced node_modules around it),
// unpacks it next to the others, and drops the platforms the target cannot use.
//
//   node scripts/bundle-sharp.mjs --target win32-x64 [--dry-run]

import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readdirSync, rmSync, statSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const targetIndex = args.indexOf("--target");
const target = targetIndex !== -1 ? args[targetIndex + 1] : "win32-x64";
if (!target || target.startsWith("--")) {
  console.error("--target needs a platform, e.g. --target win32-x64");
  process.exit(1);
}

const imgDir = path.join(process.cwd(), ".next", "standalone", "node_modules", "@img");
try {
  statSync(imgDir);
} catch {
  console.error("no .next/standalone/node_modules/@img — run this after `npm run package`.");
  process.exit(1);
}

const sharpPkg = JSON.parse(readFileSync(path.join(process.cwd(), "node_modules", "sharp", "package.json"), "utf8"));
const wanted = `@img/sharp-${target}`;
const version = sharpPkg.optionalDependencies?.[wanted];
if (!version) {
  console.error(`sharp ${sharpPkg.version} has no prebuilt binding "${wanted}".`);
  process.exit(1);
}
// Linux targets keep libvips in a sibling package; Windows and macOS bundle it.
const libvips = `@img/sharp-libvips-${target}`;
const libvipsVersion = sharpPkg.optionalDependencies?.[libvips];
const packages = [[wanted, version], ...(libvipsVersion ? [[libvips, libvipsVersion]] : [])];

const present = readdirSync(imgDir).filter((d) => d.startsWith("sharp-"));
const keep = new Set(packages.map(([name]) => name.slice("@img/".length)));
const drop = present.filter((d) => !keep.has(d));

for (const [name, ver] of packages) {
  const dest = path.join(imgDir, name.slice("@img/".length));
  if (present.includes(path.basename(dest))) {
    console.log(`already present: ${name}@${ver}`);
    continue;
  }
  console.log(`${dryRun ? "would fetch" : "fetching"} ${name}@${ver}`);
  if (dryRun) continue;
  const tmp = mkdtempSync(path.join(tmpdir(), "sharp-bundle-"));
  const tarball = execFileSync("npm", ["pack", `${name}@${ver}`, "--pack-destination", tmp, "--silent"], {
    encoding: "utf8",
  })
    .trim()
    .split("\n")
    .pop();
  mkdirSync(dest, { recursive: true });
  // npm tarballs wrap everything in a top-level "package/" directory.
  execFileSync("tar", ["-xzf", path.join(tmp, tarball), "-C", dest, "--strip-components", "1"]);
  rmSync(tmp, { recursive: true, force: true });
  console.log(`unpacked ${name}@${ver} → ${path.relative(process.cwd(), dest)}`);
}

let freed = 0;
for (const d of drop) {
  const full = path.join(imgDir, d);
  const size = dirSize(full);
  freed += size;
  console.log(`${dryRun ? "would remove" : "removed"} @img/${d} (${(size / 1048576).toFixed(1)} MB)`);
  if (!dryRun) rmSync(full, { recursive: true, force: true });
}
console.log(`${dryRun ? "would free" : "freed"} ${(freed / 1048576).toFixed(1)} MB; bundle now targets ${target}`);

function dirSize(dir) {
  let total = 0;
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, e.name);
    total += e.isDirectory() ? dirSize(full) : statSync(full).size;
  }
  return total;
}
