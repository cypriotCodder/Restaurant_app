import { createHmac, timingSafeEqual } from "crypto";

// The QR encodes /scan/{tableCode}?k={sig}. The signature binds the URL to
// the table's current qrVersion under the venue's qrSecret, so regenerating
// a table's QR (bumping qrVersion) retroactively invalidates every photo or
// screenshot of the old code.

export function signTableQr(qrSecret: string, tableCode: string, qrVersion: number): string {
  return createHmac("sha256", qrSecret)
    .update(`${tableCode}:${qrVersion}`)
    .digest("base64url")
    .slice(0, 24);
}

export function verifyTableQr(
  qrSecret: string,
  tableCode: string,
  qrVersion: number,
  sig: string
): boolean {
  const expected = Buffer.from(signTableQr(qrSecret, tableCode, qrVersion), "utf8");
  // Compare BYTE lengths, not character lengths: `?k=` is attacker-controlled
  // and a multi-byte string can match on `.length` while producing a longer
  // buffer, which makes timingSafeEqual throw and 500 the scan route.
  const actual = Buffer.from(sig, "utf8");
  if (actual.length !== expected.length) return false;
  return timingSafeEqual(actual, expected);
}

export function tableQrUrl(baseUrl: string, qrSecret: string, tableCode: string, qrVersion: number): string {
  return `${baseUrl}/scan/${tableCode}?k=${signTableQr(qrSecret, tableCode, qrVersion)}`;
}
