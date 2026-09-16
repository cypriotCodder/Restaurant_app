import { z } from "zod";
import { randomBytes } from "crypto";
import { db } from "./db";
import { publish } from "./bus";
import { bridgeKeyHint, hashBridgeKey, newBridgeKey } from "./bridgeKey";

// Venue-level configuration that previously existed only as database columns:
// changing the venue name or switching the POS adapter meant a SQL statement.

/** Adapters the app ships with — see src/lib/pos/adapters.ts. */
export const POS_ADAPTERS = ["console", "escpos_bridge"] as const;

/**
 * Currencies the money formatter renders properly. TRY gets the ₺ symbol;
 * anything else is prefixed with its ISO code, which is correct but plainer.
 */
export const CURRENCIES = ["TRY", "EUR", "USD", "GBP"] as const;

export const venueSettingsSchema = z.object({
  name: z.string().min(1, "isim gerekli / name required").max(120).optional(),
  currency: z.enum(CURRENCIES).optional(),
  defaultLocale: z.enum(["tr", "en"]).optional(),
  posAdapter: z.enum(POS_ADAPTERS).optional(),
});

export type VenueSettings = z.infer<typeof venueSettingsSchema>;

export async function updateVenueSettings(
  venueId: string,
  input: VenueSettings
): Promise<{ ok: true } | { ok: false; error: "nothing_to_do" }> {
  const data = Object.fromEntries(Object.entries(input).filter(([, v]) => v !== undefined));
  if (Object.keys(data).length === 0) return { ok: false, error: "nothing_to_do" };

  await db.venue.update({ where: { id: venueId }, data });
  // The venue name and currency are baked into the menu payload every phone
  // holds, so push a refresh rather than leaving stale prices on screen.
  publish({ type: "menu.changed", venueId });
  return { ok: true };
}

/**
 * Rotates the HMAC key every table QR is signed with, invalidating **every
 * printed code in the venue at once** and killing all live sessions.
 *
 * The per-table `qrVersion` bump is the normal revocation path; this exists for
 * the case the per-table mechanism cannot fix — the secret itself leaking.
 * Without it a leaked secret has no remedy short of database access.
 */
export async function rotateQrSecret(venueId: string): Promise<{ tablesAffected: number }> {
  const secret = randomBytes(24).toString("base64url");
  const [, tables] = await db.$transaction([
    db.venue.update({ where: { id: venueId }, data: { qrSecret: secret } }),
    db.table.updateMany({ where: { venueId }, data: { qrVersion: { increment: 1 } } }),
    // Everyone currently ordering was admitted under the old secret.
    db.tableSession.updateMany({
      where: { venueId, revokedAt: null },
      data: { revokedAt: new Date() },
    }),
  ]);
  return { tablesAffected: tables.count };
}

export type BridgeKeyView = {
  id: string;
  label: string;
  /** Last 6 characters only — enough to tell two keys apart, not to use one. */
  hint: string;
  createdAt: Date;
};

export async function listBridgeKeys(venueId: string): Promise<BridgeKeyView[]> {
  const keys = await db.bridgeKey.findMany({
    where: { venueId },
    orderBy: { createdAt: "asc" },
    select: { id: true, label: true, hint: true, createdAt: true },
  });
  return keys.map((k) => ({
    id: k.id,
    label: k.label,
    hint: `…${k.hint}`,
    createdAt: k.createdAt,
  }));
}

/**
 * Issues a bridge key. The plaintext is returned **once**: only its hash is
 * stored, so neither a stolen admin session nor a database dump can recover
 * the credential for a printer it has no other access to.
 */
export async function createBridgeKey(
  venueId: string,
  label: string
): Promise<{ id: string; key: string }> {
  const key = newBridgeKey();
  const row = await db.bridgeKey.create({
    data: {
      venueId,
      keyHash: hashBridgeKey(key),
      hint: bridgeKeyHint(key),
      label: label.trim() || "kitchen-bridge",
    },
    select: { id: true },
  });
  return { id: row.id, key };
}

export async function deleteBridgeKey(venueId: string, id: string): Promise<boolean> {
  const { count } = await db.bridgeKey.deleteMany({ where: { id, venueId } });
  return count > 0;
}
