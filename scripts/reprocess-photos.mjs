#!/usr/bin/env node
// Re-encodes menu photos uploaded before uploads were resized.
//
// Walks UPLOAD_DIR/menu, converts anything that is not already a ≤1200px WebP,
// points the MenuItem at the new file, and removes the old one. Safe to run
// more than once: files already in the target shape are skipped.
//
//   node --env-file-if-exists=.env.local scripts/reprocess-photos.mjs [--dry-run]
//
// Run it once after the venue's first update that carries this change; the
// upload route handles everything from then on.

import { readdir, readFile, writeFile, unlink, stat } from "node:fs/promises";
import path from "node:path";
import { randomBytes } from "node:crypto";
import sharp from "sharp";
import { PrismaClient } from "@prisma/client";

const MAX_EDGE = 1200;
const QUALITY = 82;
const dryRun = process.argv.includes("--dry-run");
const root = path.resolve(process.env.UPLOAD_DIR ?? "/var/lib/masadan/uploads");
const menuDir = path.join(root, "menu");

const db = new PrismaClient();

async function walk(dir, out = []) {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) await walk(full, out);
    else if (/\.(jpe?g|png|webp)$/i.test(e.name)) out.push(full);
  }
  return out;
}

async function main() {
  const files = await walk(menuDir);
  let converted = 0, skipped = 0, freed = 0;
  for (const file of files) {
    const meta = await sharp(file).metadata().catch(() => null);
    if (!meta?.width || !meta?.height) {
      console.warn(`skip (unreadable): ${file}`);
      skipped++;
      continue;
    }
    const alreadyRight = meta.format === "webp" && meta.width <= MAX_EDGE && meta.height <= MAX_EDGE;
    if (alreadyRight) {
      skipped++;
      continue;
    }

    const key = path.relative(root, file).split(path.sep).join("/");
    const oldUrl = `/api/media/${key}`;
    const newName = `${randomBytes(8).toString("hex")}.webp`;
    const newFile = path.join(path.dirname(file), newName);
    const newKey = path.relative(root, newFile).split(path.sep).join("/");
    const newUrl = `/api/media/${newKey}`;

    const before = (await stat(file)).size;
    const bytes = await sharp(await readFile(file))
      .rotate()
      .resize({ width: MAX_EDGE, height: MAX_EDGE, fit: "inside", withoutEnlargement: true })
      .webp({ quality: QUALITY })
      .toBuffer();

    const refs = await db.menuItem.count({ where: { photoUrl: oldUrl } });
    console.log(
      `${dryRun ? "would convert" : "convert"} ${key} (${(before / 1024).toFixed(0)} KB → ${(bytes.length / 1024).toFixed(0)} KB, ${refs} item${refs === 1 ? "" : "s"})`
    );
    if (dryRun) continue;

    await writeFile(newFile, bytes);
    await db.menuItem.updateMany({ where: { photoUrl: oldUrl }, data: { photoUrl: newUrl } });
    await unlink(file);
    converted++;
    freed += before - bytes.length;
  }
  console.log(
    `${dryRun ? "dry run: " : ""}${converted} converted, ${skipped} skipped, ${(freed / 1048576).toFixed(1)} MB freed`
  );
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
