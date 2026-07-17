# Masadan Sipariş — QR Table Ordering

Customers scan a QR at their table, browse the menu on their phone (no app, no account), order, and watch live status. Orders hit the kitchen's order-desk dashboard instantly and are bridged to the venue's existing AKINSOFT setup via ESC/POS kitchen printing.

## Run

```bash
npm install
npx prisma db push      # creates prisma/dev.db
npm run seed            # Demo Kafe: menu, 8 tables, staff users, bridge key
npm run dev             # http://localhost:3000
```

Demo logins: `admin@demo.local` / `demo1234` (admin) · `desk@demo.local` / `demo1234` (desk).
The landing page lists per-table "scan" links that are byte-identical to what each printed QR encodes.

## Surfaces

| URL | Who | What |
|---|---|---|
| `/scan/{code}?k={sig}` | customer (via QR) | verifies signature, mints table session, → menu |
| `/t/{code}` | customer | menu · cart · modifiers · notes · live order status (TR/EN) |
| `/desk` | kitchen/desk staff | live ticket board (SSE), accept/reject/preparing/ready/served, elapsed timers, new-session + printer-failure badges |
| `/admin` | owner | menu/category/modifier CRUD, photos, live 86 toggle, tables + QR print/regenerate, session kill, order log + CSV |

## Anti-remote-ordering design

A QR is just a URL — no software check can prove a *scan*. The layers:

1. **Signed QR payload**: `k = HMAC(venue.qrSecret, tableCode:qrVersion)`. Admin "QR Yenile" bumps `qrVersion`, killing every photo/screenshot of the old code and all live sessions for the table.
2. **Table-bound sessions** (httpOnly cookie, minted only by a valid scan): 2 h hard cap, 30 min idle timeout, max 6 concurrent per table, staff-revocable. Bare URLs without a session get the re-scan wall; the cart survives in localStorage across re-scan.
3. **Human + economic backstop**: pay-at-till means a remote prankster gains nothing; every order needs staff *accept*, arrives tagged to a visible physical table, first order of a new session is badged "YENİ OTURUM".
4. **Rate limits** (5 orders/session/10 min, 10 open orders/table) and a full `OrderAttempt` ledger (every attempt incl. forged signatures, expired sessions, validation failures — with IP/UA) for abuse analysis.

Deferred by choice: venue-IP/geolocation advisory flags (schema and desk badging make this a small add later).

## POS / AKINSOFT bridge

The customer → backend → desk flow is fully standalone. On **accept**, a ticket is written to the `PosDelivery` outbox and rendered by the venue's configured adapter (`Venue.posAdapter`):

- `console` — dev: prints ticket to server stdout.
- `escpos_bridge` — **primary**: raw ESC/POS bytes, pulled by the on-prem agent:

```bash
BASE_URL=https://your-app BRIDGE_KEY=<see seed output> PRINTER_HOST=192.168.1.50 node bridge/agent.mjs
# DRY_RUN=1 to print to stdout instead of the printer
```

The agent runs on any LAN machine (till PC / Raspberry Pi), makes outbound HTTP only, and prints to the same network kitchen printer (port 9100) AKINSOFT prints to. Failed prints show a "YAZICI HATASI" badge on the desk — nothing is ever silently lost. Deeper AKINSOFT integration (Wolvox local import surface, or Entegra-style middleware) slots in as another adapter once the venue's exact module/license is confirmed.

## Stack & notes

Next.js App Router (TS) · Prisma 6 + SQLite (Postgres-compatible schema — swap `DATABASE_URL`/provider for hosted prod) · SSE for realtime (in-process bus; swap for Redis pub/sub when multi-instance) · Tailwind. Multi-tenant: all data is venue-scoped. Money is stored as kuruş integers. Orders snapshot item names/prices. Payment is pay-at-till; `paymentStatus/Provider/Ref` fields are already on `Order` for a later PSP (iyzico/PayTR) integration.

Set a real `AUTH_SECRET` and `NEXT_PUBLIC_BASE_URL` (the printed QR domain) in production.
