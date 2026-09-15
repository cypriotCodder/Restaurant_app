#!/usr/bin/env node
// Stamps build identity into the standalone bundle as version.json.
//
// A venue runs whatever bundle was last copied onto it, and until now there was
// no way to ask it what that was — not remotely, not standing in front of it.
// That makes a remote update unverifiable: you restart the service and have no
// evidence the new code is the code now running.
//
// This is deliberately a file rather than a baked-in constant. scripts/update.ps1
// reads it straight off disk to decide whether a rollback is needed, at a point
// where the app may not be answering HTTP at all.

import { execFileSync } from "child_process";
import { readFileSync, writeFileSync, existsSync } from "fs";
import path from "path";

const root = process.cwd();
const target = path.join(root, ".next", "standalone", "version.json");

if (!existsSync(path.dirname(target))) {
  console.error(
    "no .next/standalone — run this after `next build`, via `npm run package`."
  );
  process.exit(1);
}

/** Short commit, or null outside a git checkout (a release tarball, some CI). */
function gitCommit() {
  try {
    return execFileSync("git", ["rev-parse", "--short", "HEAD"], {
      cwd: root,
      stdio: ["ignore", "pipe", "ignore"],
    })
      .toString()
      .trim();
  } catch {
    return null;
  }
}

/** Marks a build made from uncommitted work, which should never reach a venue. */
function gitDirty() {
  try {
    const out = execFileSync("git", ["status", "--porcelain"], {
      cwd: root,
      stdio: ["ignore", "pipe", "ignore"],
    })
      .toString()
      .trim();
    return out.length > 0;
  } catch {
    return false;
  }
}

const pkg = JSON.parse(readFileSync(path.join(root, "package.json"), "utf8"));
const commit = gitCommit();
const dirty = commit ? gitDirty() : false;

const stamp = {
  version: pkg.version,
  commit,
  dirty,
  builtAt: new Date().toISOString(),
};

writeFileSync(target, JSON.stringify(stamp, null, 2) + "\n");

const label = `${stamp.version}${commit ? `+${commit}` : ""}${dirty ? " (dirty)" : ""}`;
console.log(`stamped ${label} → .next/standalone/version.json`);

if (dirty) {
  console.warn(
    "WARNING: built from a dirty working tree. A venue running this cannot be\n" +
      "         traced back to a commit — commit first for anything you deploy."
  );
}
