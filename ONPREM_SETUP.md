# Running on the restaurant PC

The app runs as a single long-lived Node server on the venue's own machine. It
has no managed cloud services behind it:

| | |
|---|---|
| Event bus | in-process `EventEmitter` (`src/lib/bus.ts`) |
| Menu photos | `UPLOAD_DIR` on disk, served via `/api/media` |
| POS sweep + retention | in-process scheduler (`src/lib/scheduler.ts`) |
| Rate limiting | in-process fixed windows |
| Postgres | one local connection |

The whole configuration is five environment variables, validated at boot — a
missing or malformed one stops the server starting rather than surfacing later
as a customer unable to order. See `src/lib/env.ts`.

> **One process is assumed.** The bus and the rate limiter are in-memory, so
> running two app processes behind a load balancer would silently break live
> updates between them. One venue, one server.

## Why on-prem

The kitchen keeps taking orders when the restaurant's internet drops. The bridge
agent and the printer are on the same LAN as the server, and SSE streams are no
longer torn down every 300 seconds.

The trade: backups, updates and uptime are yours, and the PC becomes a single
point of failure during service. Plan for that before you commit.

## 1. Prerequisites

- Node.js 24 LTS
- PostgreSQL 16+ on the same machine
- A **static LAN IP** for the PC (DHCP reservation on the router is fine)

```bash
sudo -u postgres createuser --pwprompt masadan
sudo -u postgres createdb --owner=masadan masadan
```

## 2. HTTPS

Customer phones must trust the certificate, or the browser shows a full-page
warning before the menu loads. Self-signed will not do for a QR flow customers
use once.

Point a subdomain you own at the PC's LAN IP and issue a certificate over DNS-01,
which needs no inbound internet:

```
pos.theheaven.app.  A  192.168.1.50
```

```bash
sudo certbot certonly --preferred-challenges dns \
  --manual -d pos.theheaven.app
```

Renewal needs outbound internet roughly every 60 days; ordering keeps working
offline in between. Terminate TLS in nginx or Caddy in front of the app:

```
pos.theheaven.app {
    encode zstd gzip
    reverse_proxy 127.0.0.1:3000
}
```

`encode` lets Caddy compress responses Node has not already compressed and
offers zstd, which phones' browsers accept and Node's built-in gzip does not.

Caddy handles renewal itself if the PC can reach the internet at renewal time.

> `NEXT_PUBLIC_BASE_URL` must match this origin exactly. It is the address baked
> into every printed QR, and it decides the `secure` cookie flag and whether HSTS
> and `upgrade-insecure-requests` are sent.
>
> **Changing it after cards are printed does not invalidate them
> cryptographically** — the signature covers `tableCode:qrVersion` only, so the
> same `?k=` verifies on any host. What breaks is the *address*: the cards point
> somewhere that no longer answers, and must be reprinted.
>
> The practical consequence is that a **stable hostname is what saves you
> reprinting**. An address that follows the machine (a real DNS name, or the
> Bonjour `<computer-name>.local` name during development) keeps every printed
> card working when the network hands out a different IP. Hard-coding an IP does
> not.
>
> Application code must read it through `baseUrl()` in `src/lib/env.ts`, never as
> `process.env.NEXT_PUBLIC_BASE_URL`. Next.js replaces `NEXT_PUBLIC_*` references
> with string literals **at build time**, so a direct read is frozen to whatever
> the build machine had — which once meant QR codes printed at a venue encoded a
> developer's laptop address.

## 3. Environment

`/etc/masadan/masadan.env`, readable only by the service user:

```bash
NODE_ENV=production
PORT=3000

DATABASE_URL="postgresql://masadan:PASSWORD@localhost:5432/masadan"

# openssl rand -base64 32
AUTH_SECRET="..."
# openssl rand -base64 24
CRON_SECRET="..."

NEXT_PUBLIC_BASE_URL="https://pos.theheaven.app"

# Outside the app directory, so an update cannot delete the venue's photos.
UPLOAD_DIR=/var/lib/masadan/uploads

# Caddy (§2) is in front, so the client address it appends to
# X-Forwarded-For is the one the login and scan rate limits key on.
TRUST_PROXY=1
```

> `TRUST_PROXY=1` is only correct when **every** request reaches Node through
> the proxy. Bind the app to `127.0.0.1` (`HOST=127.0.0.1` in the env file)
> so a phone on the LAN cannot reach port 3000 directly and hand the limiter a
> forged address. Caddy replaces any `X-Forwarded-For` a client sends unless
> that client is listed in `trusted_proxies`, which is the behaviour relied on
> here.

```bash
sudo mkdir -p /var/lib/masadan/uploads
sudo chown -R masadan:masadan /var/lib/masadan
sudo chmod 600 /etc/masadan/masadan.env
```

That is the complete list. There is no Redis, object-store or scheduler
configuration, because there are no such services to configure.

## 4. Build and install

Build on a development machine, not the restaurant PC:

```bash
npm ci
npx prisma generate
npm run package
```

`output: "standalone"` produces `.next/standalone` — a self-contained server with
only the packages actually imported, so the PC needs no `npm install`. `npm run
package` also copies the directories Next leaves out — the two it excludes by
design, plus `bridge/`, which is not imported by the app and so is invisible to
the tracer — and deletes the development `.env` that `next build` otherwise
copies in:

```
next build
  && cp -r .next/static .next/standalone/.next/static
  && cp -r public       .next/standalone/public
  && cp -r bridge       .next/standalone/bridge
  && rm -f .next/standalone/.env
```

The bridge copy is what makes the `/opt/masadan/bridge/agent.mjs` path in
section 6 exist. The agent talks to the server over HTTP like any other client,
so nothing in the app imports it and nothing else would put it there.

For the Windows venue build use `npm run package:venue` instead: it also
strips the Prisma engines the target cannot load and swaps in the Windows
native `sharp` binding (`scripts/bundle-sharp.mjs`). Without that step sharp
falls back to its WebAssembly build on the venue PC and every menu photo
resize runs several times slower.

Copy `.next/standalone` to `/opt/masadan` on the PC, then apply migrations:

```bash
cd /opt/masadan
DATABASE_URL="postgresql://..." npx prisma migrate deploy
```

Menu photos uploaded before September 2026 were stored at their original size.
Run `npm run photos:reprocess` once (with `UPLOAD_DIR` and `DATABASE_URL` set)
to shrink them to the ≤1200px WebP that uploads now produce; it is safe to
repeat and skips files already in that shape.

## 5. Run it as a service

`/etc/systemd/system/masadan.service`:

```ini
[Unit]
Description=Masadan QR ordering
After=network.target postgresql.service
Requires=postgresql.service

[Service]
Type=simple
User=masadan
WorkingDirectory=/opt/masadan
EnvironmentFile=/etc/masadan/masadan.env
ExecStart=/usr/bin/node server.js
Restart=always
RestartSec=5

# The app only ever writes to UPLOAD_DIR.
NoNewPrivileges=true
ProtectSystem=strict
ProtectHome=true
PrivateTmp=true
ReadWritePaths=/var/lib/masadan

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl enable --now masadan
journalctl -u masadan -f
```

You should see the scheduler announce itself:

```
[scheduler] started (sweep 60s, retention 1h)
```

No cron entry is needed — the server runs the POS sweep and the retention prune
itself, including one sweep at boot, which matters most when the server is
starting *because* it crashed and the previous process left claims stranded.

## 6. The bridge agent

It now runs on the same machine as the server and the printer:

```ini
[Service]
Environment=BASE_URL=http://127.0.0.1:3000
Environment=BRIDGE_KEY=...
Environment=PRINTER_HOST=192.168.1.60
ExecStart=/usr/bin/node /opt/masadan/bridge/agent.mjs
Restart=always
```

`BASE_URL` stays on loopback: the agent has no reason to leave the machine.
Verify with `DRY_RUN=1` before pointing at the printer. Leave `PRINTER_ACK`
unset here: a network printer accepts bytes and says nothing. It is only for
the Windows USB shim (WALKTHROUGH.md), which does answer.

## 7. Backups

Nothing else does this for you.

```bash
# /etc/cron.daily/masadan-backup
pg_dump -Fc masadan > /backup/masadan-$(date +%F).dump
find /backup -name 'masadan-*.dump' -mtime +30 -delete
rsync -a /var/lib/masadan/uploads/ /backup/uploads/
```

Put `/backup` on a **different physical disk**, and copy it off-site
periodically. A dump on the same failing drive as the database is not a backup.
Restore-test it once, before you need it.

## 8. Checks after install

```bash
curl -I https://pos.theheaven.app/login          # 200, valid certificate
curl https://pos.theheaven.app/api/health        # {"status":"ok"}
journalctl -u masadan | grep scheduler           # scheduler started
```

### Monitoring

`/api/health` returns **200** when the database is reachable and the POS sweep
is still running, and **503** when either has failed — so a monitor can alert on
the status code alone. `Restart=always` brings back a process that crashed; it
cannot see one that is up but broken, which is what this covers.

Add the `CRON_SECRET` as a bearer token for detail:

```bash
curl -H "Authorization: Bearer $CRON_SECRET" https://pos.theheaven.app/api/health
# {"status":"ok","checks":{"database":{"ok":true,"detail":"1ms"},
#  "scheduler":{"ok":true,"detail":"last sweep 12s ago"}},"uptimeSeconds":3841}
```

Without the token it returns the verdict and nothing else, so the endpoint can
be polled from the LAN without exposing internals.

A minimal systemd watchdog:

```ini
# /etc/systemd/system/masadan-health.service  (+ a .timer running every minute)
[Service]
Type=oneshot
ExecStart=/usr/bin/curl -fsS -o /dev/null http://127.0.0.1:3000/api/health
ExecStopPost=/bin/sh -c '[ "$EXIT_STATUS" = 0 ] || systemctl restart masadan'
```

- **Before anything else, confirm a phone can reach the server over the venue
  wifi**: open `https://pos.theheaven.app/api/health` on a phone and expect
  `{"status":"ok"}`. Many routers isolate wireless clients from each other —
  standard on guest networks — which silently stops **every customer phone** from
  reaching the server while the machine itself looks perfectly healthy. A check
  run on the server cannot detect this: connections to its own address are
  short-circuited through loopback and never cross the network.
- Print the table cards: **Admin → Masalar → "Tüm QR Kartları Yazdır"**. The page
  refuses to print if `NEXT_PUBLIC_BASE_URL` is a local address, because those
  cards would be dead on a customer's phone.
- Scan a table QR from a phone on the restaurant wifi, place a test order.
- Accept it at the desk and confirm the kitchen printer produces the ticket,
  with Turkish characters intact.
- Admin → Ayarlar shows the kitchen-printer panel as healthy.
- Pull the network cable and repeat: ordering must still work end to end.
