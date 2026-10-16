# Plan — Masadan Sipariş, cloud server + venue bridge

**Status: pre-first-venue.** The app is feature-complete for a single venue and
has never served a real customer.

This file is the current roadmap. It replaces a Vercel deployment-readiness plan
that was executed and then superseded — see [History](#history) at the bottom
for what happened and why, so the change of direction is not mistaken for drift.

---

## Where the app actually is

**Architecture** — as built for on-prem; from 2026-10-16 the same process runs
on a VPS and only the bridge stays at the venue (Phase 2). `ONPREM_SETUP.md`
remains the install authority:

| | |
|---|---|
| Host | one Node process on a VPS (was: the venue's own machine) |
| Database | Postgres beside it on the same host, one direct connection |
| Event bus | in-process `EventEmitter` (`src/lib/bus.ts`) |
| Menu photos | `UPLOAD_DIR` on disk, served via `/api/media` |
| POS sweep + retention | in-process scheduler (`src/lib/scheduler.ts`) |
| Rate limiting | in-process fixed windows |
| Printing | ESC/POS over TCP via `bridge/agent.mjs` |

There are no managed services beyond the VPS itself.

**Done and holding:** the full order loop (scan → order → desk → accept →
ticket), bill and close-table, staff account management, venue settings, QR
print sheet, order log with cursor pagination, admin reporting, POS outbox with
retry and a boot sweep, `/api/health` covering database *and* scheduler
liveness, zod-validated env that fails the boot rather than starting broken,
constant-time comparison on QR and bridge-key verification, security headers,
313 Vitest tests, and green CI (lint, typecheck, test, production build).

**Windows server tooling, now mostly unused:** `WINDOWS_SETUP.md`,
`scripts/backup.ps1` and `scripts/watchdog.ps1` were written for running the
server on the venue PC. With the server on a VPS (Phase 2), only the bridge
parts of `WINDOWS_SETUP.md` (§6, NSSM services for agent and shim) still apply;
keep the rest as the fallback if the venue ever has to go offline-first again.

**The one thing that matters more than all of it:**

> ### 🔴 QR ordering has never been verified on a real phone
>
> `WORKLOG.md` (2026-09-14, status OPEN) records this as deferred by decision,
> not solved. Safari could not reach the dev server at a TCP level; the two
> remaining explanations — wrong network, or router client-isolation — were
> never distinguished because the phone's IP was never read.
>
> **No test run from the development machine can close this.** Connecting to the
> machine's own LAN address is short-circuited through loopback by the kernel
> and never crosses the wifi, so the verification cannot, even in principle,
> cover the failing path. It has to happen on the venue's own network.
>
> Scanning a QR code is the product's entire premise. Until this is
> demonstrated, everything else is unproven infrastructure.

---

## Phase 0 — Housekeeping (dev machine, before the trip)

Small, and none of it touches application behaviour. Done 2026-10-14: pending
ops work committed, `bridge/agent.mjs` lint warning fixed, same-major dependency
bumps (Next 16.4.0, React 19.3.0, zod, jose, Tailwind) verified with lint,
typecheck, 313 tests and a production build.

Remaining:

- [x] **Push** the branch so CI runs the new build step against it.
- [x] **Decide the trunk: `main`.** Feature branch merged in (bfd61d6) and
      made the GitHub default; production ships from `main`.
- [x] **Prune dead worktrees.** All ten pointed at `~/Desktop/myRepo/...`, a
      path that no longer exists; `git worktree prune` removed the bookkeeping.
- [ ] **Delete merged branches**, locally and on `origin`. Merged into this
      branch: `main`, `chore/deployment-planning-docs`, `perf-plan`,
      `worktree-audit-fixes`, `-onprem-plan-rewrite`, `-package-bridge-copy`,
      `-perf-work-order`, `-prune-engines`, `-remote-update-tooling`,
      `-table-button-hover`, `-venue-windows-walkthrough`.
      **Not merged — review before deleting:** `worktree-ui-perf-fixes`,
      `worktree-walkthrough-fixes`.
- [ ] **`.env.bak-1785663660`** holds a `DATABASE_URL` that `.env` no longer
      has (the old Neon one). Confirm it is dead, then delete the file. It is
      git-ignored, so this is only about not leaving a credential on disk.
- [ ] **`npm audit`: 5 high**, all `micromatch` via `eslint-config-next` —
      lint-time only, not in the shipped bundle. Re-check when the next
      `eslint-config-next` lands; do not `audit fix --force` (it downgrades).
- [ ] **Run `npm run package:venue`** on the bumped dependencies and keep that
      bundle as the one carried to the venue.

Held on purpose until after the first venue: Prisma 7, TypeScript 7, ESLint 10,
Vitest 5, `@types/node` past 20. Each is a major with migration work; none fixes
anything the venue needs.

---

## Phase 1 — The printer at the venue ✅

Done on the venue PC, 2026-10-14. (Gate 1a — a phone reaching a server on the
venue LAN — is moot now that the server is in the cloud; phones reach it like
any website. Its wifi-isolation question no longer blocks anything.)

### Gate 1b — the printer

- [x] `copy /b` to the shared queue moves paper — implied by the next item:
      the app's tickets go through the same Windows queue.
- [x] Ticket prints end to end: order → desk accepts → paper. **Verified on
      the venue PC, 2026-10-14.**
- [x] **`ç ğ ı İ ö ş ü` are correct on the paper** (verified 2026-10-14). PC857 encoding is the thing
      most likely to be subtly wrong.
- [ ] Ayarlar → POS health shows nothing queued and a recent successful send.

Gate 1c (the full order flow) is now step 3a, run against the cloud server.

---

## Phase 2 — Cloud server

**Decision (2026-10-16): the app moves to a small VPS; only the bridge and the
printer stay at the venue.** See [History](#history). Nothing in the code
changes: the bridge already polls `/api/bridge/pending` and acks over HTTP with
`BASE_URL` + `BRIDGE_KEY`, and the single-process design (in-memory bus,
scheduler, rate limits) fits one VPS exactly as it fitted one PC.

`ONPREM_SETUP.md` (Linux) is the install guide for the server, with the
differences below.

### 2a. Provision — decisions first

- [ ] **Provider and region.** Hetzner CX22 (2 vCPU / 4 GB, ~€4–5/mo) or
      equivalent, in the region with the lowest latency to the venue
      (Falkenstein/Nuremberg/Helsinki from Turkey/Cyprus; measure with `ping`).
- [ ] Enable the provider's **automatic snapshots/backups** (~20% of the price).
      This is the floor, not the backup plan — see 2e.
- [ ] Ubuntu 24.04 LTS. SSH key only, password login off, `ufw` allowing
      22, 80, 443 and nothing else. `unattended-upgrades` on, with automatic
      reboot at **04:00 local** — outside service hours.
- [ ] **Domain** under your control (`masa.<venue>.com`), A record → the VPS's
      public IP. A public IP means plain HTTP-01 certificates: no DNS plugin,
      no API token, no rebind problems.

### 2b. Install the app (`ONPREM_SETUP.md` §1–5)

- [ ] Postgres 16 on the VPS, listening on localhost only.
- [ ] Caddy with the stock binary and a two-line site block
      (`reverse_proxy 127.0.0.1:3000`); certificate issues itself.
- [ ] Env as in §3, with `NEXT_PUBLIC_BASE_URL=https://masa.<venue>.com`,
      `HOSTNAME=127.0.0.1`, `TRUST_PROXY=1`. Secrets generated on the server.
- [ ] Build target is **Linux** now: `npm run package` (not `package:venue`,
      which prunes to the Windows engine and bundles win32 `sharp`).
- [ ] systemd unit with `Restart=always`; `[scheduler] started` in the journal,
      no `[env]` warning.
- [ ] Seed, change the admin password, recreate the menu and tables.

**Check:** `https://masa.<venue>.com/api/health` → `{"status":"ok"}` from a
phone **on 4G**, with no certificate warning. Desk board updates live through
Caddy.

### 2c. Point the venue's bridge at the cloud

The venue PC keeps only `bridge/agent.mjs` and `bridge/win-usb-print.mjs` —
no Node server, no Postgres, no Caddy at the venue.

- [ ] Agent env: `BASE_URL=https://masa.<venue>.com`, a **new** `BRIDGE_KEY`
      (the one on the old local install never leaves that machine), printer
      settings unchanged.
- [ ] `DRY_RUN=1` first; then a real ticket with `ç ğ ı İ ö ş ü`.
- [ ] Agent and shim as Windows services (NSSM, `WINDOWS_SETUP.md` §6), and
      **re-test printing once they are services** (session-0 printer access).
- [ ] Reboot the venue PC, touch nothing, order from a phone: it prints.
- [ ] Retire the local server, Postgres and Caddy from the venue PC once the
      cloud path has printed for real.

### 2d. The outage test — what the trade actually costs

With the app in the cloud, a venue internet outage stops tickets, not orders:
phones on 4G keep ordering, the outbox holds the tickets, the bridge prints them
when the line returns.

- [ ] **Pull the venue's WAN cable** for two minutes. Order from a 4G phone.
      Plug back in: the ticket prints, once, without staff action.
- [ ] Ayarlar → POS health showed it queued during the outage.
- [ ] **4G failover router** (~€30–60 + a data SIM) between the venue PC and
      the internet, so the bridge rides through outages unattended. Repeat the
      cable test with failover in place: the ticket prints *during* the outage.
- [ ] Staff know the fallback: if the desk is unreachable, take orders on paper.

### 2e. Backups and monitoring

- [ ] Nightly `pg_dump` + `UPLOAD_DIR` (`ONPREM_SETUP.md` §7), 30 days, and
      **copied off the VPS** (object storage or your own machine) — a snapshot
      of the same provider is not an independent copy.
- [ ] **Restore-test once** onto a throwaway VPS.
- [ ] External uptime monitor (UptimeRobot or similar, free) on `/api/health`,
      alerting *you*. Something must also restart the service when health fails
      while the process is up (`ONPREM_SETUP.md` §8 Monitoring timer).
- [ ] Alert on the bridge too: POS health showing a queue older than a few
      minutes means the venue side is down.

---

## Phase 3 — Before a paying customer uses it

### 3a. Table cards — only after Phase 2 holds

`NEXT_PUBLIC_BASE_URL` is in every printed QR (`src/lib/qr.ts`), and the
signature covers `tableCode:qrVersion` only, so a card with a wrong address
still verifies and points nowhere. A name, never an IP, is what lets the server
move later (new VPS, new provider) without reprinting: change the A record.

- [ ] Admin → QR sheet shows `https://masa.<venue>.com`.
- [ ] Print **one** card; scan it with an iPhone and an Android, on 4G *and* on
      the venue wifi, order through to paper.
- [ ] Then print the set. No wifi details needed on the card.

### 3b. Operational readiness

- [ ] Admin password recorded where the owner can find it.
- [ ] Staff shown the desk board, accept/reject, the printer-jam routine and the
      paper fallback.
- [ ] A rehearsal shift: real orders, staff operating it, you present.

**Running cost:** VPS ~€5 + snapshots ~€1 + domain ~€1 + data SIM, per month.

---

## Phase 4 — Deferred on purpose

Not "later" in the sense of forgotten. Each of these has a reason to wait and a
condition that would change the answer.

**Multi-venue.** The schema is already multi-tenant (`venueId` throughout), so
the foundation is there. But the bus, the rate limiter, and the scheduler are
all in-process — two app instances would silently break live updates between
them, which is why `ONPREM_SETUP.md` states one venue, one server. Revisit when
a second venue actually asks; the work is externalising the bus, not reshaping
the data model.

**Payments / PSP.** Pay-at-till is what the venue does today and it works. The
PSP fields stay dormant. Adding a payment surface before the basic loop has
served one real customer adds risk to the part that is already proven.

**Self-serve onboarding.** Meaningless at one venue.

**A packaged installer or tray app.** Discussed and deliberately deferred: the
three status lights it would provide already exist as `/api/health` (database +
scheduler) and the POS health panel (queue depth, last send). The real cost is
not packaging, it is bundling and owning PostgreSQL's lifecycle. Worth
revisiting at several venues, not at one.

**Virtualised lists.** With the order log paged at 50 rows nothing renders a
list long enough to justify a windowing library, and the customer menu's
category anchors (`#cat-<id>`) would break. See `docs/archive/work_order.md`.

---

## Definition of done — "live with real customers"

- [x] The kitchen prints, with Turkish characters intact (2026-10-14).
- [ ] The app answers at `https://masa.<venue>.com` from a phone on 4G and on
      the venue wifi.
- [ ] The venue bridge prints tickets from the cloud server, as services, and
      survives a reboot of the venue PC.
- [ ] A WAN outage queues tickets and prints them on reconnect; with the 4G
      failover, prints straight through.
- [ ] Table cards printed only after the hostname was final.
- [ ] A backup copied off the VPS *and* restored.
- [ ] Uptime alerts reach you, not the owner.
- [ ] Staff have run a rehearsal shift.

Nothing here is checked by writing code. Every item is a thing that has to be
observed working.

---

## History

The previous `plan.md` was a deployment-readiness plan targeting **Vercel**:
Neon Postgres, Upstash Redis pub/sub for cross-instance SSE, and Vercel Blob for
photos, driven by the constraint that serverless is multi-instance with an
ephemeral filesystem.

Most of its hardening work shipped and is still in the codebase — the zod env
module that fails the boot, removal of the `"dev-secret"` fallback,
constant-time comparisons, security headers, the Vitest suite, and CI.

The hosting decision then reversed, to on-prem. The reason is in
`ONPREM_SETUP.md`: the kitchen keeps taking orders when the restaurant's
internet drops, the bridge and printer sit on the same LAN as the server, and
SSE streams stop being torn down every 300 seconds. The trade accepted in
exchange is that backups, updates, and uptime became the venue's problem.

With that reversal the managed-services half of the plan became not merely
obsolete but misleading — it described an architecture the repository no longer
has, and none of those dependencies remain in `package.json`. Hence this
rewrite.

**Second reversal, 2026-10-16: on-prem → a VPS plus a venue bridge.** On-prem
bought offline ordering at the cost of running a Windows PC in a restaurant
remotely — power cuts, forced updates, disk failure, certificates, backups, all
fixed on site. A €5 VPS moves the server into a data centre and keeps the parts
that made on-prem right: still one long-lived process (so no 300-second SSE
teardown and no external bus, unlike the Vercel plan), and the printer still
local behind the bridge. The cost moves to the venue's internet: an outage
pauses tickets (the outbox queues them) while 4G phones keep ordering, and a
4G-failover router closes most of that gap. Side benefits: ordinary HTTP-01
certificates, no DNS-rebind workarounds, and cards that work on mobile data.
