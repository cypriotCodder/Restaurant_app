# Masadan Sipariş — QR Table Ordering

Customers scan a QR at their table, browse the menu on their phone (no app, no account), order, and watch live status. Orders hit the kitchen's order-desk dashboard instantly and are bridged to the venue's existing AKINSOFT setup via ESC/POS kitchen printing.

## Run

```bash
npm install
cp .env.example .env.local   # then fill in DATABASE_URL and the two secrets
npm run migrate:deploy       # apply migrations to Postgres
npm run seed                 # venue: menu, 8 tables, staff users, bridge key
npm run dev                  # http://localhost:3000
```

`.env.local` holds local credentials and is gitignored; `prisma.config.ts` loads it so
the Prisma CLI targets the same database the app does.

The app is **self-hosted**: it runs as a single long-lived Node server on the venue's
own machine, with Postgres beside it and no managed cloud services.
To install it in a restaurant, see **[ONPREM_SETUP.md](ONPREM_SETUP.md)**.

### Staff / Admin Credentials

The database seed creates two staff accounts by default:
- **Admin Account (`/admin`):** Email `admin@theheaven.local` (overridden via `SEED_ADMIN_EMAIL`)
- **Desk/Kitchen Account (`/desk`):** Email `desk@theheaven.local` (overridden via `SEED_DESK_EMAIL`)

**Passwords:**
- You can define custom passwords in `.env.local` using `SEED_ADMIN_PASSWORD` and `SEED_DESK_PASSWORD`.
- If unset in `.env.local`, the seed script (`npm run seed`) generates random 12-character passwords and prints them **once** in the terminal logs. Capture them then, as they are hashed in the database and not stored in plain text anywhere.

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

## Testing on a phone

The dev server must be reachable at an address the phone can dial, and that
address changes with every network. One command re-points it and prints the
live scan URLs:

```bash
npm run dev:origin     # detect this machine's LAN IP, rewrite .env, list URLs
npm run dev            # restart for the new origin to take effect
```

Two things commonly stop a phone reaching it, neither of them app bugs:

- **Client isolation** on café, hotel and ISP guest networks blocks
  device-to-device traffic entirely. Test with `http://<ip>:3000/api/health` —
  plain JSON, no JavaScript. If that fails, the network is the problem. A
  personal hotspot is the quickest way around it.
- **`.local` hostnames** rely on mDNS. They resolve to loopback on the machine
  itself, so a laptop test proves nothing about a phone.

## Work log

Each change to this project is recorded in **[WORKLOG.md](WORKLOG.md)** — what
was asked, what changed, why the non-obvious calls were made that way, and the
evidence that it works. Newest entry first.

## Stack & notes

Next.js App Router (TS) · Prisma 6 + **PostgreSQL** on the same machine · SSE for realtime over an **in-process event bus**, which is all a single server needs · menu photos on **local disk** (`UPLOAD_DIR`, served via `/api/media`) · POS sweep and data retention on an **in-process scheduler** · Tailwind. Runtime dependencies are Node, Postgres and nothing else. Multi-tenant: all data is venue-scoped. Money is stored as kuruş integers. Orders snapshot item names/prices. Payment is pay-at-till; `paymentStatus/Provider/Ref` fields are already on `Order` for a later PSP (iyzico/PayTR) integration.

**One process is assumed.** The event bus and the login rate limiter are in-memory, so running two app processes behind a load balancer would silently break live updates between them.

`src/lib/env.ts` validates the environment at boot (via `src/instrumentation.ts`). There are no
fallbacks: an install missing `AUTH_SECRET`, `DATABASE_URL`, `CRON_SECRET` or
`NEXT_PUBLIC_BASE_URL` fails to start rather than coming up misconfigured. `UPLOAD_DIR`
defaults to `/var/lib/masadan/uploads`.

## Release gate: NEXT_PUBLIC_BASE_URL

**Set `NEXT_PUBLIC_BASE_URL` to the final production domain before printing a single QR code.**
Every physical table QR encodes `{NEXT_PUBLIC_BASE_URL}/scan/{code}?k={sig}`. If the domain changes
afterwards, every printed code in the venue stops working and all table cards must be reprinted.
Changing `AUTH_SECRET` is safe by comparison — it only signs out staff.
