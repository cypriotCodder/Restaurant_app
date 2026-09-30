# Masadan Sipariş — Restaurant QR Ordering

## Overview

A self-hosted restaurant ordering application built with TypeScript, Next.js, and PostgreSQL. Customers scan a signed table QR code, browse a bilingual menu, place orders, and follow their status without creating an account. Staff manage orders and table bills from a live desk, while administrators maintain the menu, tables, staff accounts, and printer integration.

The system is designed for a single long-running server on the restaurant's local network. Payments are taken at the till; the application records settlement rather than processing online payments.

## Engineering highlights

- **End-to-end workflows:** menu modifiers and notes, order status transitions, item edits and voids, shared table bills, and table settlement.
- **Live updates:** Server-Sent Events (SSE) connect customer and staff views to an in-process event bus.
- **Explicit data modelling:** venue-scoped records, integer kuruş amounts, and snapshots of item names and prices preserve order history as the menu changes.
- **Security controls:** signed QR payloads, expiring table sessions, staff roles, request limits, and an order-attempt audit ledger.
- **Printer delivery lifecycle:** a PostgreSQL outbox tracks claims, acknowledgements, retries, and failed deliveries independently of the desk workflow.
- **Performance-conscious implementation:** server-rendered menu data, a per-venue memory cache invalidated on menu changes, throttled session timestamp writes, and uploaded photos resized to WebP with a maximum edge of 1200px.

## Architecture

```text
Customer browser          Staff / admin browser
       | HTTPS + SSE              | HTTPS + SSE
       +-------------+------------+
                     |
          Next.js application (one Node.js process)
          |          |               |
      PostgreSQL  Local photos   In-process event bus
          |                      and maintenance scheduler
     POS outbox
          ^
          | HTTP polling + acknowledgements
     Bridge agent ---- TCP 9100 ---- ESC/POS printer
                      or Windows USB print shim
```

Prisma manages PostgreSQL access and migrations. Photos live in `UPLOAD_DIR` and are served through `/api/media`. An in-process scheduler reconciles POS deliveries and prunes retained data. The application does not require Redis, hosted object storage, or an external scheduler.

**Run one application process.** Live events, caches, and some rate limits are held in memory. Multiple replicas would require shared coordination before live updates and limits could work consistently across them.

## Application surfaces

| Route | Audience | Capabilities |
| --- | --- | --- |
| `/scan/{code}?k={sig}` | Customer | Validate a signed QR, create a table session, and redirect to the menu. |
| `/t/{code}` | Customer | Turkish/English menu, cart, modifiers, notes, live order status, and table bill. |
| `/login` | Staff | Staff sign-in. |
| `/desk` | Kitchen / front of house | Live tickets, order status changes, item edits, table bills, settlement, and printer-failure indicators. |
| `/admin` | Administrator | Menu, categories, modifiers, photos, availability, tables and QR codes, sessions, staff, reporting, CSV export, and printer health. |
| `/api/health` | Operator | Database and scheduler health; authenticated requests can receive diagnostic detail. |

## Security model

QR codes contain an HMAC signature over `tableCode:qrVersion`, using the venue's QR secret. Regenerating a table's QR advances its version and revokes its live sessions. Rotating the venue QR secret invalidates all of that venue's printed codes.

Customer sessions use an HttpOnly cookie and are bound to a table. They have a two-hour hard expiry, a 30-minute idle timeout, and a six-session per-table cap, with staff revocation available. Orders are limited to five per session in ten minutes and ten open orders per table. An `OrderAttempt` ledger records attempts for abuse investigation.

Staff authentication uses hashed passwords and signed session tokens, with admin/desk role checks and account/token-version validation. Bridge keys are stored hashed and their plaintext is shown when issued. Required environment values are validated at startup.

A signed URL cannot prove physical presence: a copied, still-valid QR can be reused remotely. Staff acceptance, visible table attribution, new-session indicators, and pay-at-till are operational backstops. Geolocation and venue-IP presence checks are not implemented.

## POS / printer bridge

Accepted orders are queued in the `PosDelivery` outbox. The configured `Venue.posAdapter` selects:

- `console`: development output to server stdout.
- `escpos_bridge`: ESC/POS tickets pulled by the on-premises agent.

```bash
BASE_URL=https://your-app BRIDGE_KEY=<issued-key> PRINTER_HOST=192.168.1.50 node bridge/agent.mjs
```

The agent makes outbound HTTP requests to the application and sends tickets to a LAN printer, normally on TCP port 9100. Use `DRY_RUN=1` to inspect output without printing. Use `PRINTER_ACK=1` only when connecting to `bridge/win-usb-print.mjs`, which acknowledges Windows USB print jobs; an ordinary network printer does not provide that acknowledgement.

Stale claims are reclaimed and retries are bounded; failed deliveries are surfaced to staff and can be retried from the admin interface. Delivery acknowledgement is not a guarantee that paper physically printed. Check the printer during installation and monitor failed deliveries during service.

This supports sharing a kitchen printer with an existing AKINSOFT setup. It does **not** implement direct AKINSOFT/Wolvox data synchronisation; that would require an additional adapter matched to the venue's module and licence.

## Local setup

Prerequisites: **Node.js 24**, npm, and **PostgreSQL 16+**. The optional [Docker Compose file](docker-compose.yml) runs PostgreSQL only; configure its database credentials to match your local environment.

```bash
git clone https://github.com/cypriotCodder/Restaurant_app.git
cd Restaurant_app
npm ci
cp .env.example .env.local
# Fill in the environment values below before continuing.
npm run migrate:deploy
npm run seed
npm run dev
```

Set these values in the gitignored `.env.local`:

| Variable | Purpose |
| --- | --- |
| `DATABASE_URL` | PostgreSQL connection string for the database you created. |
| `AUTH_SECRET` | Staff-token secret, at least 32 characters; generate with `openssl rand -base64 32`. |
| `CRON_SECRET` | Manual POS-sweep/diagnostic secret, at least 16 characters; generate with `openssl rand -base64 24`. |
| `NEXT_PUBLIC_BASE_URL` | Browser-reachable origin; `http://localhost:3000` for same-machine development. |
| `UPLOAD_DIR` | Writable photo directory; the example uses `./.uploads`. |
| `TRUST_PROXY` | Keep `0` for direct access; use `1` only behind a correctly configured trusted proxy. |

The Prisma configuration loads `.env.local`, so migrations use the same local database as the app. `npm ci` generates the Prisma client through the postinstall script.

The seed creates a sample menu, eight tables, staff accounts, and a bridge key. Default staff emails are `admin@theheaven.local` and `desk@theheaven.local`, overridable with `SEED_ADMIN_EMAIL` and `SEED_DESK_EMAIL`. Set `SEED_ADMIN_PASSWORD` / `SEED_DESK_PASSWORD`, or capture the generated passwords printed once by the seed. Keep these credentials and the bridge key private.

For phone testing, run `npm run dev:origin`, then restart `npm run dev`; the helper updates the development origin and prints scan URLs. First check that the phone can reach `http://<server-ip>:3000/api/health`. Guest Wi-Fi client isolation can block access even when the app works on the server itself.

## Testing / CI

```bash
npx prisma validate
npm run lint
npm run typecheck
npm test
```

[GitHub Actions CI](.github/workflows/ci.yml) runs on pull requests and pushes to `main`, using Node.js 24. It installs dependencies, validates the Prisma schema, runs ESLint and TypeScript checks, and executes the Vitest suite.

The tests cover areas including QR/session validation, authentication and rate limits, order idempotency and edits, billing, POS delivery and bridge protocol handling, photo storage, caching, and reporting. The workflow does not build the production bundle or exercise a physical printer; verify those separately for a deployment.

## Deployment

See [ONPREM_SETUP.md](ONPREM_SETUP.md) for installation, HTTPS, service configuration, bridge setup, backups, and health checks; [WALKTHROUGH.md](WALKTHROUGH.md) includes the Windows venue workflow.

```bash
npm run package        # Standalone server plus static assets and runtime files
# Or, for the Windows venue target:
npm run package:venue
```

The Windows packaging command selects the target Prisma engines and bundles the Windows `sharp` binding. Apply database migrations, configure the production environment, and run the packaged server as a supervised service with the bridge agent. Keep photo storage outside the application directory and back up both PostgreSQL and uploaded files.

**Choose the final `NEXT_PUBLIC_BASE_URL` before printing table QR cards.** Changing the origin does not invalidate the HMAC signature, but existing cards still point to the old address and may need reprinting. Use a stable, reachable hostname and validate the complete scan → order → staff acceptance → print flow from a customer phone.

The venue machine is a single point of failure. Offline ordering depends on the local server, network, and printer remaining available. See the installation guide for operational checks, and [WORKLOG.md](WORKLOG.md) for the existing engineering history.

## Tech stack

| Layer | Technology |
| --- | --- |
| Language | TypeScript; JavaScript for bridge and utility scripts |
| Application | Next.js 16 App Router, React 19, Tailwind CSS 4, SWR |
| Data | PostgreSQL, Prisma 6 |
| Validation / authentication | Zod, jose, bcryptjs |
| Live updates / hardware | SSE, Node.js events, ESC/POS over TCP, Windows USB print shim |
| Images / QR | sharp, qrcode |
| Quality / operations | Vitest, ESLint, TypeScript checks, GitHub Actions, standalone Node.js packaging |
