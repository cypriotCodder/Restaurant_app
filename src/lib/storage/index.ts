import { mkdir, writeFile, readFile } from "node:fs/promises";
import path from "node:path";
import { getEnv } from "../env";

// Menu photo storage.
//
// Photos are written to a real directory on the venue's machine, deliberately
// OUTSIDE the application directory (UPLOAD_DIR) so updating the app cannot
// delete them, and served back through /api/media/[...path] rather than from
// public/ — which is part of the deployed build and would be replaced on every
// update.

export type StoredFile = { url: string };

export interface StorageAdapter {
  readonly name: "disk";
  /** `key` is a relative path like "menu/<venueId>/<random>.webp". */
  put(key: string, bytes: Buffer): Promise<StoredFile>;
}

const diskAdapter: StorageAdapter = {
  name: "disk",
  async put(key, bytes) {
    const target = resolveUploadPath(key);
    await mkdir(/* turbopackIgnore: true */ path.dirname(target), { recursive: true });
    await writeFile(/* turbopackIgnore: true */ target, bytes);
    // A relative URL, so the stored value keeps working if the venue's
    // hostname or port ever changes.
    return { url: `/api/media/${key}` };
  },
};

export function getStorage(): StorageAdapter {
  return diskAdapter;
}

/**
 * Resolves a storage key to an absolute path inside UPLOAD_DIR, refusing
 * anything that escapes it. Keys are generated server-side, but this is also
 * the read path for /api/media/[...path], where the segments come from the URL.
 */
export function resolveUploadPath(key: string): string {
  // turbopackIgnore keeps the tracer from concluding that a runtime-dynamic
  // path means the whole project must be bundled: UPLOAD_DIR is deliberately
  // outside the application directory and is only known at runtime.
  const root = path.resolve(/* turbopackIgnore: true */ getEnv().UPLOAD_DIR ?? "/var/lib/masadan/uploads");
  const target = path.resolve(/* turbopackIgnore: true */ root, key);
  // path.resolve collapses "..", so a traversal attempt lands outside root and
  // is rejected here rather than reading an arbitrary file off the PC.
  if (target !== root && !target.startsWith(root + path.sep)) {
    throw new Error("upload path escapes UPLOAD_DIR");
  }
  return target;
}

const CONTENT_TYPES: Record<string, string> = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
};

/** Reads a stored file back. Returns null when it does not exist. */
export async function readStored(key: string): Promise<{ body: Buffer; contentType: string } | null> {
  const ext = path.extname(key).toLowerCase();
  const contentType = CONTENT_TYPES[ext];
  // Only the types the upload route accepts are ever served back, so a file
  // that somehow landed in the directory cannot be served as active content.
  if (!contentType) return null;
  try {
    return { body: await readFile(/* turbopackIgnore: true */ resolveUploadPath(key)), contentType };
  } catch {
    return null;
  }
}
