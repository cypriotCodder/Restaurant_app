import Link from "next/link";
import { db } from "@/lib/db";
import { tableQrUrl } from "@/lib/qr";

import { baseUrl } from "@/lib/env";

// Platform landing. In production customers never see this — they arrive via
// table QR.
//
// The "simulate a scan" links below embed a VALID signed QR token for every
// table. Rendering them in production would hand any anonymous visitor a
// working table session and defeat the entire signed-QR design, so they are
// hard-gated to non-production builds.
const SHOW_DEV_SCAN_LINKS = process.env.NODE_ENV !== "production";

export default async function Home() {
  const venue = await db.venue.findFirst({ select: { name: true } });
  // The qrSecret and table codes are only ever read in development, so they
  // are not even fetched in a production render.
  const devVenue = SHOW_DEV_SCAN_LINKS
    ? await db.venue.findFirst({ include: { tables: { where: { active: true } } } })
    : null;
  // Runtime read — see baseUrl() in src/lib/env.ts for why this must not be
  // `process.env.NEXT_PUBLIC_BASE_URL`.
  const origin = baseUrl();

  return (
    <main className="min-h-screen flex items-center justify-center" style={{ background: "var(--color-bg)" }}>
      <div className="w-full max-w-lg p-6">
        {/* Wordmark */}
        <div className="flex flex-col items-center text-center gap-3 mb-10">
          <div className="h-3 w-3 rounded-full" style={{ background: "var(--color-accent)" }} />
          <h1 className="wordmark text-3xl">
            {venue?.name.toUpperCase() ?? "MASADAN SİPARİŞ"}
            <span className="sub">Restaurant &amp; Cafe · QR Table Ordering</span>
          </h1>
        </div>

        {/* Staff card */}
        <div className="bg-white p-5 mb-4" style={{ border: "2px solid var(--color-text)" }}>
          <h2 className="text-xs font-bold uppercase tracking-wide mb-4" style={{ color: "var(--color-neutral-900)" }}>
            STAFF
          </h2>
          <div className="flex gap-3 flex-wrap">
            <Link href="/desk" className="btn btn-primary">
              Order Desk
            </Link>
            <Link href="/admin" className="btn btn-secondary">
              Admin
            </Link>
            <Link href="/login" className="btn btn-ghost">
              Login
            </Link>
          </div>
          <p className="text-xs mt-4 pt-3" style={{ color: "var(--color-neutral-900)", borderTop: "1px solid var(--color-divider)" }}>
            Staff credentials are issued at seed time — see the seed output.
          </p>
        </div>

        {/* Table scan simulation — development only, see SHOW_DEV_SCAN_LINKS */}
        {devVenue && (
          <div className="bg-white p-5" style={{ border: "2px solid var(--color-text)" }}>
            <h2 className="text-xs font-bold uppercase tracking-wide mb-1" style={{ color: "var(--color-neutral-900)" }}>
              SIMULATE A TABLE SCAN
            </h2>
            <p className="text-xs mb-4" style={{ color: "var(--color-neutral-900)" }}>
              Each link is exactly what that table&apos;s printed QR encodes.
            </p>
            <div className="flex flex-wrap gap-2">
              {devVenue.tables.map((t) => (
                <a
                  key={t.id}
                  href={tableQrUrl(origin, devVenue.qrSecret, t.code, t.qrVersion)}
                  className="tag tag-accent"
                >
                  {t.name}
                </a>
              ))}
            </div>
          </div>
        )}

        <p className="text-center text-xs mt-6" style={{ color: "var(--color-neutral-900)" }}>
          theheaven.app
        </p>
      </div>
    </main>
  );
}
