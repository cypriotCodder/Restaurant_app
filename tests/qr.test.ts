import { describe, it, expect } from "vitest";
import { signTableQr, verifyTableQr, tableQrUrl } from "@/lib/qr";

// The signed QR is the only thing standing between a printed table code and
// anyone who can guess a URL, so these cover both directions: valid codes must
// keep working, and every way of forging one must fail.

const SECRET = "test-venue-qr-secret-abcdefghijklmnop";
const CODE = "aB3xY9zQ";

describe("signTableQr", () => {
  it("is deterministic for the same inputs", () => {
    expect(signTableQr(SECRET, CODE, 1)).toBe(signTableQr(SECRET, CODE, 1));
  });

  it("produces the fixed 24-char token the QR URL embeds", () => {
    expect(signTableQr(SECRET, CODE, 1)).toHaveLength(24);
  });

  it("differs per table, per version, and per venue secret", () => {
    const base = signTableQr(SECRET, CODE, 1);
    expect(signTableQr(SECRET, "different", 1)).not.toBe(base);
    expect(signTableQr(SECRET, CODE, 2)).not.toBe(base);
    expect(signTableQr("another-venue-secret-0123456789", CODE, 1)).not.toBe(base);
  });
});

describe("verifyTableQr", () => {
  it("accepts a signature it just produced", () => {
    expect(verifyTableQr(SECRET, CODE, 1, signTableQr(SECRET, CODE, 1))).toBe(true);
  });

  it("rejects a signature minted for a different table", () => {
    expect(verifyTableQr(SECRET, CODE, 1, signTableQr(SECRET, "otherTbl", 1))).toBe(false);
  });

  it("rejects a signature minted under a different venue secret", () => {
    const foreign = signTableQr("attacker-secret-0123456789abcdef", CODE, 1);
    expect(verifyTableQr(SECRET, CODE, 1, foreign)).toBe(false);
  });

  it("rejects garbage and empty signatures without throwing", () => {
    expect(verifyTableQr(SECRET, CODE, 1, "")).toBe(false);
    expect(verifyTableQr(SECRET, CODE, 1, "!!!!")).toBe(false);
    expect(verifyTableQr(SECRET, CODE, 1, "A".repeat(24))).toBe(false);
    // Length mismatch must be handled before timingSafeEqual, which throws on
    // unequal buffer lengths.
    expect(verifyTableQr(SECRET, CODE, 1, "A".repeat(100))).toBe(false);
  });

  it("rejects multi-byte signatures that match on character length", () => {
    // 24 characters, but 48 bytes. Comparing `.length` instead of byte length
    // let these through to timingSafeEqual, which threw and 500'd /scan.
    expect(() => verifyTableQr(SECRET, CODE, 1, "ü".repeat(24))).not.toThrow();
    expect(verifyTableQr(SECRET, CODE, 1, "ü".repeat(24))).toBe(false);
    expect(verifyTableQr(SECRET, CODE, 1, "\u{1F600}".repeat(12))).toBe(false);
  });

  it("rejects a truncated but otherwise correct signature", () => {
    const valid = signTableQr(SECRET, CODE, 1);
    expect(verifyTableQr(SECRET, CODE, 1, valid.slice(0, 23))).toBe(false);
  });
});

describe("qrVersion rotation (the 'QR Yenile' revocation path)", () => {
  it("invalidates every previously printed code when the version is bumped", () => {
    const printed = signTableQr(SECRET, CODE, 1);
    // Admin regenerates the table QR: qrVersion 1 -> 2.
    expect(verifyTableQr(SECRET, CODE, 2, printed)).toBe(false);
    expect(verifyTableQr(SECRET, CODE, 2, signTableQr(SECRET, CODE, 2))).toBe(true);
  });

  it("does not let an old signature come back at a later version", () => {
    const v1 = signTableQr(SECRET, CODE, 1);
    for (const version of [2, 3, 4, 5]) {
      expect(verifyTableQr(SECRET, CODE, version, v1)).toBe(false);
    }
  });
});

describe("tableQrUrl", () => {
  it("builds a URL whose signature verifies for that table and version", () => {
    const url = tableQrUrl("https://example.com", SECRET, CODE, 3);
    const sig = new URL(url).searchParams.get("k")!;
    expect(url.startsWith("https://example.com/scan/" + CODE)).toBe(true);
    expect(verifyTableQr(SECRET, CODE, 3, sig)).toBe(true);
    expect(verifyTableQr(SECRET, CODE, 4, sig)).toBe(false);
  });
});
