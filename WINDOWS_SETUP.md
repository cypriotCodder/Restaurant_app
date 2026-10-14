# Production install on the venue's Windows PC

`WALKTHROUGH.md` proves an order reaches the printer. This is what comes after:
the install that survives a reboot, a power cut and an update, and that customers
reach over HTTPS. `ONPREM_SETUP.md` covers the same ground for Linux; its
reasoning applies here, its systemd units do not.

Do the walkthrough first. If the printer has never produced a ticket from this
machine, nothing below will change that.

> **Not yet run end to end on a venue machine.** The layout and commands follow
> `scripts/update.ps1` and the Windows steps already proven in the walkthrough,
> but this document was written before its first real install. Treat every
> "confirm" step as a real gate, and correct the document where the machine
> disagrees with it.

## What you end up with

```
C:\masadan\
  releases\0.1.0+a1b2c3-20261020T1030\   one directory per deployed build
  current  ->  junction to the live release
  env\masadan.env                        app configuration, survives updates
  env\agent.env                          bridge agent + shim configuration
  scripts\update.ps1  backup.ps1  watchdog.ps1
  docker-compose.yml
C:\masadan-data\
  uploads\      menu photos
  backups\      database dumps + photo copies
  logs\
```

| Service | Runs | Restarted by `update.ps1` |
|---|---|---|
| `MasadanServer` | the app, bound to loopback :3000 | yes |
| `MasadanShim` | `bridge\win-usb-print.mjs`, loopback :9100 → USB printer | yes |
| `MasadanAgent` | `bridge\agent.mjs`, outbox → shim | yes |
| `MasadanCaddy` | HTTPS on :443 → the app | no |

Postgres runs in Docker, as in the walkthrough.

Everything below is PowerShell **as Administrator**.

---

## 1. The machine

- **Static LAN address**: a DHCP reservation on the router is enough.
- **Never sleep.** A sleeping PC is a closed restaurant:

  ```powershell
  powercfg /change standby-timeout-ac 0
  powercfg /change hibernate-timeout-ac 0
  ```

- **Windows Update active hours** set to cover service, so it does not reboot
  mid-shift.
- **Node.js 24 LTS**, installed for all users.
- **NSSM** (nssm.cc): unzip and put `nssm.exe` in `C:\Windows\System32`, or
  anywhere on the system `PATH`. It is what turns `node` into a Windows service.

```powershell
mkdir C:\masadan\env, C:\masadan\scripts, C:\masadan\releases -Force
mkdir C:\masadan-data\uploads, C:\masadan-data\backups, C:\masadan-data\logs -Force
```

Copy `scripts\update.ps1`, `scripts\backup.ps1` and `scripts\watchdog.ps1` from
the repository into `C:\masadan\scripts`. They are not part of the bundle.

## 2. Database

`C:\masadan\docker-compose.yml`. Two differences from the walkthrough's file,
both deliberate: a real password, and the port published on loopback only, so
the database is not reachable from the customer wifi.

```yaml
services:
  db:
    image: postgres:16
    restart: always
    environment:
      POSTGRES_USER: masadan
      POSTGRES_PASSWORD: REPLACE-WITH-A-GENERATED-PASSWORD
      POSTGRES_DB: masadan
    ports:
      - '127.0.0.1:5432:5432'
    volumes:
      - pgdata:/var/lib/postgresql/data

volumes:
  pgdata:
```

Keep the password to letters and digits. It goes into a URL in the next section,
and anything else has to be percent-encoded there.

```powershell
node -e "console.log(require('crypto').randomBytes(24).toString('hex'))"
cd C:\masadan
docker compose up -d
```

If the walkthrough's database already exists with the old password, changing
`POSTGRES_PASSWORD` does nothing: Postgres reads it only when the volume is
first created. Either change it inside the database
(`docker compose exec db psql -U masadan -c "ALTER USER masadan PASSWORD '...'"`)
or, if it holds only test data, `docker compose down -v` and start clean.

### Docker has to come back after a power cut

`restart: always` restarts the container when Docker starts. Docker Desktop
itself starts when a user **signs in**, not when Windows boots. Until someone
signs in there is no database and the app answers 503.

- Docker Desktop → Settings → General → **Start Docker Desktop when you sign in**.
- Make the till account sign in automatically (Sysinternals **Autologon**, or
  `netplwiz`), so a reboot at 3am needs nobody.

**Confirm by rebooting**, section 10. If automatic sign-in is not acceptable on
this machine, the alternative is PostgreSQL's native Windows installer, which
runs as a real service; the walkthrough moved away from it, so that needs
solving first.

### Client tools on the host

`update.ps1` and `backup.ps1` call `pg_dump` on the host, and the container does
not provide it. Run the PostgreSQL **16** Windows installer, untick everything
except **Command Line Tools**, and add its `bin` directory to the *system* PATH
(system, not user: the backup task runs as SYSTEM):

```powershell
[Environment]::SetEnvironmentVariable("Path",
  $env:Path + ";C:\Program Files\PostgreSQL\16\bin", "Machine")
```

Open a new window and check `pg_dump --version` prints 16.x. An older `pg_dump`
refuses to dump a newer server.

## 3. Hostname and HTTPS

The order in `plan.md` §2a applies and matters: **hostname final → certificate →
`NEXT_PUBLIC_BASE_URL` → only then print cards.**

1. Pick a name on a domain you control, and point it at the PC's LAN address:

   ```
   pos.example.com.  A  192.168.1.50
   ```

2. Get a Caddy build that includes the DNS plugin for your DNS provider from
   caddyserver.com/download. The stock binary cannot do this: the certificate
   has to be issued over DNS-01, because Let's Encrypt cannot reach a private
   address to check it any other way.

3. `C:\masadan\Caddyfile`. The `tls` block below is Cloudflare's, as an example;
   use the one your provider's plugin documents.

   ```
   pos.example.com {
       tls {
           dns cloudflare {env.DNS_API_TOKEN}
       }
       encode zstd gzip
       reverse_proxy 127.0.0.1:3000
   }
   ```

4. Run it as a service and open the firewall for it — and only for it:

   ```powershell
   nssm install MasadanCaddy C:\masadan\caddy.exe "run --config C:\masadan\Caddyfile"
   nssm set MasadanCaddy AppDirectory C:\masadan
   nssm set MasadanCaddy AppEnvironmentExtra "DNS_API_TOKEN=..."
   nssm set MasadanCaddy AppStdout C:\masadan-data\logs\caddy.log
   nssm set MasadanCaddy AppStderr C:\masadan-data\logs\caddy.log
   nssm start MasadanCaddy

   New-NetFirewallRule -DisplayName "Masadan HTTPS" -Direction Inbound `
     -Protocol TCP -LocalPort 80,443 -Action Allow
   ```

   There is no rule for 3000, 5432 or 9100, and there must not be one.

Renewal needs outbound internet about every 60 days. Ordering keeps working
offline in between.

> **Test the name from a phone on the venue wifi before going further.** Some
> routers refuse to resolve a public name to a private address ("DNS rebind
> protection"). The name then works from everywhere except inside the
> restaurant. If the phone cannot resolve it, add an exception for the name on
> the router, or serve the record from the router's own DNS.

## 4. Configuration

`C:\masadan\env\masadan.env`: one `KEY=value` per line, no `export`, no spaces
around `=`. The app, `update.ps1` and `backup.ps1` all read this one file.

```
PORT=3000
HOSTNAME=127.0.0.1

DATABASE_URL=postgresql://masadan:THE-PASSWORD@127.0.0.1:5432/masadan

AUTH_SECRET=
CRON_SECRET=

NEXT_PUBLIC_BASE_URL=https://pos.example.com

UPLOAD_DIR=C:\masadan-data\uploads

TRUST_PROXY=1
```

Generate the two secrets on this machine; never copy them from a document or
from the walkthrough's test install:

```powershell
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"   # AUTH_SECRET
node -e "console.log(require('crypto').randomBytes(24).toString('base64'))"   # CRON_SECRET
```

`HOSTNAME=127.0.0.1` and `TRUST_PROXY=1` go together. The first binds the app to
loopback so Caddy is the only way in; the second tells the rate limiter to
believe the client address Caddy reports. `TRUST_PROXY=1` without the loopback
bind lets anyone on the wifi forge that address — the server logs a warning at
boot if it sees that combination. The name is `HOSTNAME`; `HOST` is ignored.

Lock the directory down. It holds the database password and the signing key:

```powershell
icacls C:\masadan\env /inheritance:r /grant "SYSTEM:(OI)(CI)F" "Administrators:(OI)(CI)F"
```

## 5. The app

Build on the development machine, from a **committed** tree (`update.ps1` warns
about a bundle it cannot trace to a commit):

```bash
npm ci
npm run package:venue
```

Copy `.next/standalone` to the PC as `C:\incoming\standalone`.

Register the service before the first deploy. It points at `current`, which does
not exist yet; `update.ps1` creates it.

```powershell
nssm install MasadanServer "C:\Program Files\nodejs\node.exe" "--env-file=C:\masadan\env\masadan.env server.js"
nssm set MasadanServer AppDirectory C:\masadan\current
nssm set MasadanServer AppStdout C:\masadan-data\logs\server.log
nssm set MasadanServer AppStderr C:\masadan-data\logs\server.log
nssm set MasadanServer AppRotateFiles 1
nssm set MasadanServer AppRotateBytes 10485760
```

Then the first deploy is the same command as every later one:

```powershell
cd C:\masadan\scripts
.\update.ps1 -BundlePath C:\incoming\standalone -WhatIf    # checks only
.\update.ps1 -BundlePath C:\incoming\standalone
```

It dumps the database, stages the release, points `current` at it, applies
migrations, starts the service and waits for `/api/health` to report the new
version. It will warn that `MasadanShim` and `MasadanAgent` are not installed;
that is expected at this point. The migration step downloads the Prisma CLI, so
the first run needs internet.

Seed once. The bundle carries everything the seed needs:

```powershell
cd C:\masadan\current
node --env-file=C:\masadan\env\masadan.env prisma\seed.mjs
```

**Write down the three things it prints: the admin password, the desk password
and the bridge key.** They are shown once and stored only as hashes. Set
`SEED_VENUE_NAME`, `SEED_ADMIN_EMAIL` and `SEED_DESK_EMAIL` in the shell first if
the defaults are not this venue's. The seed also creates a sample menu and eight
tables, to be replaced with the real ones in Admin.

## 6. The printer chain

`C:\masadan\env\agent.env`:

```
BASE_URL=http://127.0.0.1:3000
BRIDGE_KEY=bridge-...
PRINTER_HOST=127.0.0.1
PRINTER_ACK=1
PRINTER_SHARE=\\localhost\KITCHEN
```

```powershell
nssm install MasadanShim "C:\Program Files\nodejs\node.exe" "--env-file=C:\masadan\env\agent.env bridge\win-usb-print.mjs"
nssm set MasadanShim AppDirectory C:\masadan\current
nssm set MasadanShim AppStdout C:\masadan-data\logs\shim.log
nssm set MasadanShim AppStderr C:\masadan-data\logs\shim.log

nssm install MasadanAgent "C:\Program Files\nodejs\node.exe" "--env-file=C:\masadan\env\agent.env bridge\agent.mjs"
nssm set MasadanAgent AppDirectory C:\masadan\current
nssm set MasadanAgent DependOnService MasadanShim
nssm set MasadanAgent AppStdout C:\masadan-data\logs\agent.log
nssm set MasadanAgent AppStderr C:\masadan-data\logs\agent.log

nssm start MasadanShim
nssm start MasadanAgent
```

In Admin → Ayarlar, confirm the POS adapter is `escpos_bridge`.

> **This is the step most likely to fail, and it fails silently.** In the
> walkthrough the shim ran in a terminal as the signed-in user. A service runs
> as LocalSystem, in a session with no user profile, and may be refused by the
> `\\localhost\KITCHEN` share that worked a minute ago in a console window.
>
> Place an order, accept it, and watch `C:\masadan-data\logs\shim.log`. If it
> shows `PRINT FAILED ... copy exited 1`, run the shim as the account that owns
> the printer share:
>
> ```powershell
> nssm set MasadanShim ObjectName .\TILL-USER "its-password"
> nssm restart MasadanShim
> ```
>
> Because `PRINTER_ACK=1` is set, a refused print shows as a failed ticket on
> the desk rather than a green row and no paper — so this is at least visible.

## 7. Real data

In Admin, before any customer sees it:

- Change the admin and desk passwords from the seeded ones, and put them
  somewhere the owner can find.
- Replace the sample menu, categories and photos.
- Create the real tables.
- **Last**, with `NEXT_PUBLIC_BASE_URL` final: Masalar → "Tüm QR Kartları
  Yazdır".

## 8. Backups

```powershell
schtasks /Create /TN "Masadan Backup" /SC DAILY /ST 04:30 /RU SYSTEM /RL HIGHEST `
  /TR "powershell -NoProfile -ExecutionPolicy Bypass -File C:\masadan\scripts\backup.ps1 -MirrorTo E:\masadan-backups"
```

`backup.ps1` dumps the database, copies the menu photos beside it, deletes
nightly dumps older than 30 days, and copies the lot to `-MirrorTo`. Point that
at a **different physical disk**. Run it once by hand and read its output before
trusting the schedule.

Then restore one, once. An untested backup is a guess:

```powershell
$env:PGPASSWORD = "THE-PASSWORD"
createdb   -h 127.0.0.1 -U masadan restore_test
pg_restore -h 127.0.0.1 -U masadan -d restore_test C:\masadan-data\backups\masadan-<stamp>.dump
psql       -h 127.0.0.1 -U masadan -d restore_test -c 'select count(*) from "MenuItem"'
dropdb     -h 127.0.0.1 -U masadan restore_test
Remove-Item Env:PGPASSWORD
```

The count should match the menu. Copy the mirror off-site from time to time; a
fire takes both disks.

## 9. Watchdog

NSSM restarts a process that exits. It cannot see one that is running and
broken. `watchdog.ps1` probes `/api/health` and restarts `MasadanServer` after
three failures in a row:

```powershell
schtasks /Create /TN "Masadan Watchdog" /SC MINUTE /MO 1 /RU SYSTEM /RL HIGHEST `
  /TR "powershell -NoProfile -ExecutionPolicy Bypass -File C:\masadan\scripts\watchdog.ps1"
```

It leaves a service that is deliberately stopped alone, so it does not fight
`update.ps1`. Restarts are recorded in `C:\masadan-data\logs\watchdog.log`; an
entry there is a prompt to read `server.log`, not a fix.

## 10. Checks before the first customer

Each of these has to be seen working on this machine. None can be established
from a development laptop.

- [ ] From a **phone on the venue wifi**: `https://pos.example.com/api/health`
      shows `{"status":"ok"}` with no certificate warning. Guest networks often
      isolate wireless clients, which stops every customer while the PC itself
      looks healthy.
- [ ] From the same phone, `http://<pc-lan-address>:3000` does **not** load. If
      it does, `HOSTNAME=127.0.0.1` is not taking effect.
- [ ] `C:\masadan-data\logs\server.log` shows `[scheduler] started` and no
      `[env]` warning.
- [ ] Scan a printed QR card, order something with Turkish characters, accept it
      at the desk: a ticket prints with `ç ğ ı İ ö ş ü` intact.
- [ ] The desk board shows the new order without a refresh (live updates are
      passing through Caddy).
- [ ] Admin → Ayarlar → POS health: nothing queued, a recent successful send.
- [ ] **Reboot the PC and touch nothing.** Within a few minutes the health URL
      answers from a phone, and a new order prints. This covers automatic
      sign-in, Docker, all four services and the printer share in one go.
- [ ] **Unplug the internet and repeat the order.** It must still print.
- [ ] A backup has run, been mirrored, and been restored (section 8).

## Updating later

With the venue closed:

```powershell
cd C:\masadan\scripts
.\update.ps1 -BundlePath C:\incoming\standalone
```

It takes its own pre-update dump and rolls `current` back to the previous
release if the new one does not come up healthy. Migrations are not undone by a
rollback; if one was the cause, restore the `pre-update-*.dump` it names.
