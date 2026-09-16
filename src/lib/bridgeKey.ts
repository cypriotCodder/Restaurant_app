import { createHash, randomBytes } from "crypto";
import { db } from "./db";

// Bridge-agent credentials.
//
// The database holds only a SHA-256 of each key. A key is 128 random bits
// behind a fixed prefix, so an unsalted fast hash is the right tool: there is
// nothing to dictionary-attack, and the agent presents the key on every poll,
// which rules out a deliberately slow hash.

export const BRIDGE_KEY_PREFIX = "bridge-";

export function hashBridgeKey(key: string): string {
  return createHash("sha256").update(key, "utf8").digest("hex");
}

export function newBridgeKey(): string {
  return BRIDGE_KEY_PREFIX + randomBytes(16).toString("hex");
}

/** Last six characters — enough to tell two keys apart, not to use one. */
export function bridgeKeyHint(key: string): string {
  return key.slice(-6);
}

/**
 * The venue a presented key belongs to, or null. Looked up by hash, so the
 * comparison is an index probe rather than a string compare against secrets.
 */
export async function venueForBridgeKey(key: string | null): Promise<string | null> {
  if (!key || !key.startsWith(BRIDGE_KEY_PREFIX)) return null;
  const row = await db.bridgeKey.findUnique({
    where: { keyHash: hashBridgeKey(key) },
    select: { venueId: true },
  });
  return row?.venueId ?? null;
}
