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
  const expected = signTableQr(qrSecret, tableCode, qrVersion);
  if (sig.length !== expected.length) return false;
  return timingSafeEqual(Buffer.from(sig), Buffer.from(expected));
}

export function tableQrUrl(baseUrl: string, qrSecret: string, tableCode: string, qrVersion: number): string {
  return `${baseUrl}/scan/${tableCode}?k=${signTableQr(qrSecret, tableCode, qrVersion)}`;
}
