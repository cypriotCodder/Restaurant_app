# Venue printer test — Windows terminal, USB printer

A first-run setup for the venue machine, aimed at one outcome: **a customer
order placed on a phone comes out of the kitchen printer with Turkish
characters intact.**

This is not the production install. `ONPREM_SETUP.md` is the real thing, and it
assumes Linux — none of its systemd units apply here. This walkthrough
deliberately skips HTTPS, certificates, printed QR cards, service supervision
and backups, because none of them are in the path between an order and a
printed ticket. Get the printer working first; harden afterwards.

Budget about 90 minutes for a first run, most of it installing Postgres.

---

## What you are actually testing

```
phone → order → desk ACCEPTS → POS outbox row (pending)
      → bridge/agent.mjs polls /api/bridge/pending
      → raw ESC/POS over TCP to 127.0.0.1:9100
      → bridge/win-usb-print.mjs (the shim)
      → shared Windows printer queue → USB → paper
```

Two details drive everything below, and both surprise people:

**The ticket is queued when the desk accepts the order, not when the customer
places it.** Placing an order and waiting at the printer will never print
anything. (`src/app/api/desk/orders/[id]/route.ts:43`)

**The printer needs a TCP socket that a USB cable does not provide.** The agent
renders for "network thermal printers, port 9100" and connects with
`net.createConnection`. `bridge/win-usb-print.mjs` exists to fill that gap: it
listens on 9100 and pushes bytes into a shared Windows print queue. The agent
never knows the difference.

So you will be running **three** processes on the venue machine: the app, the
shim, and the agent.

---

## Before you leave for the venue

Doing these at your desk turns a long venue visit into a short one.

### 1. Confirm the printer is reachable at all

If you can, plug the printer into any machine and print a self-test from its own
front panel (usually: hold FEED while powering on). A printer that will not
self-test is not a software problem, and you want to know that now.

### 2. Build the bundle — on your Mac, not the venue machine

```bash
npm ci
npx prisma generate
npm run package
```

> **The Prisma engine is platform-specific, and this has already bitten this
> project once.** `prisma generate` emits an engine only for the machine it runs
> on, so a bundle built on macOS used to ship a `.dylib` that Windows cannot
> load — the server started, then died on its first database query with an
> unhelpful error. `prisma/schema.prisma` now pins
> `binaryTargets = ["native", "windows"]`, which puts
> `query_engine-windows.dll.node` in the bundle alongside the native one.
>
> Verify before you copy anything:
>
> ```bash
> ls .next/standalone/node_modules/.prisma/client/ | grep windows
> # query_engine-windows.dll.node
> ```
>
> If that prints nothing, stop. The venue machine will fail and the reason will
> not be obvious there.

Check the bundle has the bridge scripts too — `npm run package` copies them, but
confirm rather than assume:

```bash
ls .next/standalone/bridge/
# agent.mjs   win-usb-print.mjs
```

### 3. Rehearse the whole flow locally with no printer

You can test everything except the hardware before you leave. Run the app:

```bash
npm run dev
```

Then in a second terminal run the shim in dry-run mode, standing in for the
printer:

```bash
DRY_RUN=1 node bridge/win-usb-print.mjs
```

Log in as admin, then:

- **Ayarlar → POS adapter → `escpos_bridge`.** If this is left on `console`,
  tickets go to the server's stdout and the bridge never sees them. This is the
  single most common reason "nothing prints".
- **Ayarlar → bridge keys → create one.** It is shown once. Copy it now.

Third terminal, the agent:

```bash
BASE_URL=http://localhost:3000 BRIDGE_KEY=<key> PRINTER_HOST=127.0.0.1 node bridge/agent.mjs
```

Now place an order from a dev scan link on the home page, go to `/desk`, and
**accept** it. Within three seconds the shim should report the byte count.

Swap the shim for `DRY_RUN=1` on the *agent* instead
(`DRY_RUN=1 ... node bridge/agent.mjs`, no `PRINTER_HOST`) and it will decode
and print the ticket as text — that is where you check `ç ğ ı İ ö ş ü` look
right. Encoding problems are far easier to diagnose here than at the venue.

Copy `.next/standalone` onto a USB stick.

---

## On the venue machine

Everything below is PowerShell **as Administrator** unless stated otherwise.

### 4. Install the runtimes

- **Node.js 24 LTS** — the MSI from nodejs.org. Tick "Add to PATH".
- **PostgreSQL 16+** — the EDB installer. Set a password for `postgres` and
  write it down. Leave the port at 5432.

Confirm:

```powershell
node --version     # v24.x
psql --version     # 16.x or higher
```

If `psql` is not found, add `C:\Program Files\PostgreSQL\16\bin` to PATH and
open a new terminal.

### 5. Create the database

```powershell
psql -U postgres -c "CREATE USER masadan WITH PASSWORD 'choose-a-password';"
psql -U postgres -c "CREATE DATABASE masadan OWNER masadan;"
```

### 6. Copy the bundle

Put `.next/standalone` at `C:\masadan`, so that `C:\masadan\server.js` and
`C:\masadan\bridge\agent.mjs` both exist.

```powershell
dir C:\masadan
dir C:\masadan\bridge
```

### 7. Configure the environment

Create `C:\masadan\start-app.ps1`. For a test, environment variables set in the
launching shell are enough — no service registration yet.

```powershell
$env:NODE_ENV  = "production"
$env:PORT      = "3000"
$env:DATABASE_URL = "postgresql://masadan:choose-a-password@localhost:5432/masadan"

# Generate these two once and keep them stable:
#   node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
$env:AUTH_SECRET = "..."
$env:CRON_SECRET = "..."

# Loopback is correct for a printer test: only this machine's browser uses it.
# It must become the real https:// hostname before any QR card is printed.
$env:NEXT_PUBLIC_BASE_URL = "http://localhost:3000"

$env:UPLOAD_DIR = "C:\masadan-data\uploads"

node C:\masadan\server.js
```

```powershell
mkdir C:\masadan-data\uploads -Force
```

> `NEXT_PUBLIC_BASE_URL` is the address baked into every printed QR code. On
> `localhost` it is correct for this test and useless for customers. The admin
> QR-printing page refuses to print cards while it is a local address, which is
> deliberate — those cards would be dead on a phone.

### 8. Apply migrations and seed

```powershell
cd C:\masadan
$env:DATABASE_URL = "postgresql://masadan:choose-a-password@localhost:5432/masadan"
npx prisma migrate deploy
```

Seeding needs the repo (the bundle has no `prisma/seed.mjs`). Either copy the
repo across and run `npm run seed`, or create the admin user by hand. **Capture
the generated admin password — it is printed once and is not recoverable.**

### 9. Start the app

```powershell
powershell -ExecutionPolicy Bypass -File C:\masadan\start-app.ps1
```

In another window:

```powershell
curl.exe http://localhost:3000/api/health
# {"status":"ok"}
```

Anything other than `{"status":"ok"}` means the database is unreachable or the
scheduler failed — fix that before continuing. A 500 here that mentions a query
engine is the Prisma target problem from step 2.

### 10. Share the printer

This is the step that makes USB printing possible, and the driver choice
matters.

1. **Settings → Bluetooth & devices → Printers & scanners** — confirm the
   printer appears.
2. Open its properties → **Sharing** → tick **Share this printer** → set the
   share name to `KITCHEN`. Use exactly that, no spaces.
3. Properties → **Advanced** → set the driver to **Generic / Text Only**.

> The driver matters more than it looks. A manufacturer driver tries to *render*
> what it is given — it will happily print `ESC @` as literal text and produce a
> page of mojibake instead of obeying the control codes. "Generic / Text Only"
> passes bytes through untouched, which is the only behaviour that works here.

Confirm Windows accepts raw bytes on that share before involving the app:

```powershell
"TEST`n`n`n" | Out-File -Encoding ascii C:\temp\t.txt
cmd /c copy /b C:\temp\t.txt \\localhost\KITCHEN
```

Paper should move. **If it does not, stop here** — nothing downstream can work,
and the problem is Windows printer configuration, not this app.

### 11. Start the shim

```powershell
$env:PRINTER_SHARE = "\\localhost\KITCHEN"
node C:\masadan\bridge\win-usb-print.mjs
```

```
usb print shim → 127.0.0.1:9100 → \\localhost\KITCHEN
```

Leave it running.

### 12. Start the bridge agent

Third window. Log in to `http://localhost:3000` as admin first and, as in step
3, set **Ayarlar → POS adapter → `escpos_bridge`** and create a **bridge key**.

Prove the chain without touching paper first:

```powershell
$env:BASE_URL = "http://127.0.0.1:3000"
$env:BRIDGE_KEY = "<key>"
$env:DRY_RUN = "1"
node C:\masadan\bridge\agent.mjs
```

Place an order, accept it at `/desk`, and confirm the ticket appears as readable
Turkish text. Then restart the agent pointed at the shim:

```powershell
Remove-Item Env:DRY_RUN
$env:PRINTER_HOST = "127.0.0.1"
node C:\masadan\bridge\agent.mjs
```

```
bridge agent → http://127.0.0.1:3000 → 127.0.0.1:9100
```

### 13. The actual test

1. Open `http://localhost:3000` on the terminal, use a dev scan link to reach a
   table, and place an order with a Turkish item name.
2. Go to `/desk` and **accept** it.
3. Within ~3 seconds: the agent logs `printed ticket #N`, the shim logs
   `printed N bytes`, and the printer produces a ticket.
4. Check the paper: **`ç ğ ı İ ö ş ü` must be correct**, the item lines legible,
   and the paper cut.
5. **Ayarlar → POS health** should show nothing queued and a recent successful
   send.

---

## When it does not print

Work along the chain; each stage tells you where it stopped.

| Symptom | Where it stopped | Fix |
|---|---|---|
| Nothing anywhere, desk looks fine | Never queued | POS adapter is still `console`. Set `escpos_bridge`. |
| Nothing, and you only *placed* the order | Never queued | Accept it at the desk. Placing does not print. |
| Agent: `pending fetch: HTTP 401` | Agent → app | Wrong or revoked `BRIDGE_KEY`. Create a new one. |
| Agent: `pending fetch` connection refused | Agent → app | App not running, or wrong `BASE_URL`. Check `/api/health`. |
| Agent: `printer timeout` after 10s | Agent → shim | Shim is not running, or not on 9100. |
| Shim: `port 9100 is already in use` | — | A second shim is running. Close it. |
| Shim: `PRINT FAILED ... copy exited 1` | Shim → Windows | Share name wrong or not shared. Re-test step 10. |
| Shim logs success, no paper | Windows → printer | Printer offline, out of paper, or the driver is not Generic / Text Only. |
| Prints, but Turkish is garbled | Encoding | Driver is not Generic / Text Only — it is rendering rather than passing through. |
| Queue grows in POS health | Agent not acking | Agent stopped. Restart it; the sweep re-delivers. |

A queued ticket is not lost when something fails. The outbox retries, and the
server runs a sweep every 60 seconds including one at boot — so a ticket queued
while the agent was down prints when it comes back.

---

## Before this becomes real service

This walkthrough leaves the system in a state that works but will not survive a
reboot or a customer. Still to do, from `ONPREM_SETUP.md`:

- **HTTPS with a real hostname** (§2). Customer phones will not trust anything
  less, and `NEXT_PUBLIC_BASE_URL` must be that hostname *before* QR cards are
  printed — reprinting is the cost of getting this wrong.
- **A static LAN IP** for the machine (§1).
- **Run all three processes as services** so they survive a reboot. The Linux
  systemd units in §5 and §6 do not apply to Windows; use NSSM or Task
  Scheduler, and remember it is now three processes, not two.
- **Backups** (§7). Nothing does this for you.
- **Confirm a phone on the venue wifi can reach the server.** Many routers
  isolate wireless clients from each other, which silently stops every customer
  phone while the machine itself looks perfectly healthy. A check run on the
  server cannot detect this.
- **Pull the network cable and repeat the test.** Ordering and printing must
  still work; that is the whole point of running on-prem.
