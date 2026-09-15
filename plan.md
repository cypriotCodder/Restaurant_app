# Plan — Masadan Sipariş, on-prem

**Status: pre-first-venue.** The app is feature-complete for a single venue and
has never served a real customer.

This file is the current roadmap. It replaces a Vercel deployment-readiness plan
that was executed and then superseded — see [History](#history) at the bottom
for what happened and why, so the change of direction is not mistaken for drift.

---

## Where the app actually is

**Architecture** (`ONPREM_SETUP.md` is the authority):

| | |
|---|---|
| Host | one Node process on the venue's own machine |
| Database | local Postgres, one direct connection |
| Event bus | in-process `EventEmitter` (`src/lib/bus.ts`) |
| Menu photos | `UPLOAD_DIR` on disk, served via `/api/media` |
| POS sweep + retention | in-process scheduler (`src/lib/scheduler.ts`) |
| Rate limiting | in-process fixed windows |
| Printing | ESC/POS over TCP via `bridge/agent.mjs` |

There are no managed services. There is nothing to provision.

**Done and holding:** the full order loop (scan → order → desk → accept →
ticket), bill and close-table, staff account management, venue settings, QR
print sheet, order log with cursor pagination, admin reporting, POS outbox with
retry and a boot sweep, `/api/health` covering database *and* scheduler
liveness, zod-validated env that fails the boot rather than starting broken,
constant-time comparison on QR and bridge-key verification, security headers,
222 Vitest tests, and green CI.

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

## Phase 1 — The venue trip

**Goal: one real order, from a real phone, printed on real paper.**

Follow `WALKTHROUGH.md` for the setup. The venue machine is Windows with a USB
printer, so it needs `bridge/win-usb-print.mjs` alongside the agent, and the
Prisma bundle must carry the Windows engine.

These are one trip, not two: both the phone test and the printer test require
the venue's own network and hardware.

### Gate 1a — the phone reaches the server

Before anything else, on the venue wifi:

- [ ] Read the **phone's IP address** and confirm it is on the machine's subnet.
      This single fact settles the open question in the worklog.
- [ ] Phone loads `http://<machine>:3000/api/health` → `{"status":"ok"}`.
- [ ] Confirm wireless-to-wireless traffic is permitted. Guest networks commonly
      isolate clients, which would stop **every customer phone** while the
      machine itself looks perfectly healthy.

**If this fails, stop.** Nothing downstream can work and the cause is almost
certainly router configuration, not application code. Do not print table cards.

### Gate 1b — the printer

- [ ] `copy /b` to the shared queue moves paper (Windows configuration proven
      before the app is involved).
- [ ] Ticket prints end to end: order → desk accepts → paper.
- [ ] **`ç ğ ı İ ö ş ü` are correct on the paper.** PC857 encoding is the thing
      most likely to be subtly wrong.
- [ ] Ayarlar → POS health shows nothing queued and a recent successful send.

### Gate 1c — the whole loop, for real

- [ ] A **real phone** scans a printed or on-screen QR, orders, and the kitchen
      prints it. Not a dev scan link on the terminal.
- [ ] **Pull the WAN cable and repeat.** Ordering and printing must still work.
      This is the entire justification for running on-prem; if it fails, the
      architecture is not earning its cost.

**Exit criteria:** all three gates pass on the venue's own network and hardware.

---

## Phase 2 — Before a paying customer uses it

Phase 1 proves it works. This phase makes it survivable.

### 2a. Hostname and HTTPS — a hard gate, and the order matters

`NEXT_PUBLIC_BASE_URL` is baked into every printed QR. Getting it wrong costs a
reprint of every table card, because the signature covers `tableCode:qrVersion`
only — the cards stay cryptographically valid while pointing at an address that
no longer answers.

Strictly in this order:

1. [ ] Decide the final hostname. A **stable DNS name**, never a bare IP — an
       address that follows the machine is what saves you reprinting when the
       network hands out a different lease.
2. [ ] Static LAN IP for the machine (DHCP reservation is fine).
3. [ ] Certificate via DNS-01, terminated in Caddy or nginx (`ONPREM_SETUP.md`
       §2). Self-signed will not do — customers meet this once, through a
       browser warning, and leave.
4. [ ] `NEXT_PUBLIC_BASE_URL` set to that origin, app restarted.
5. [ ] **Only now**, print table cards. `QrSheet.tsx` refuses to print on a
       localhost address, which protects against the worst version of this
       mistake but not against a wrong-but-plausible one.

### 2b. Survive a reboot

The walkthrough leaves three processes in three terminal windows. That is fine
for a test and unacceptable for service.

- [ ] App, shim, and agent all run as Windows services (NSSM or WinSW), set to
      start automatically.
- [ ] **Verify printing still works once they are services.** A service running
      as LocalSystem lives in session 0 and generally cannot resolve a per-user
      printer connection like `\\localhost\KITCHEN`. Either run the shim service
      as the logged-in user, or change the shim to call the Win32 `WritePrinter`
      API against the local printer name — which works in a service context and
      removes the sharing step entirely.
- [ ] Reboot the machine and confirm the full loop still works untouched.

### 2c. Backups

Nothing does this for you (`ONPREM_SETUP.md` §7).

- [ ] Daily `pg_dump`, 30-day retention.
- [ ] `UPLOAD_DIR` copied alongside it — the database alone does not contain the
      menu photos.
- [ ] Backup target on a **different physical disk**, copied off-site.
- [ ] **Restore-test once**, before it is needed. An untested backup is a guess.

### 2d. Operational readiness

- [ ] Admin password rotated off the seeded one and recorded somewhere the owner
      can actually find it.
- [ ] `/api/health` polled by something that restarts the app on failure.
      `Restart=always` equivalents catch a crash; they cannot see a process that
      is up but broken, which is the failure that ends with the kitchen not
      printing and nobody knowing.
- [ ] Staff shown the desk board, the accept/reject flow, and what to do when
      the printer jams.
- [ ] A rehearsal shift: real orders, staff operating it, you present.

---

## Phase 3 — Deferred on purpose

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
category anchors (`#cat-<id>`) would break. See `work_order.md`.

---

## Definition of done — "live with real customers"

- [ ] A phone on the venue wifi completes a full order, verified on the venue's
      own network (closes the open worklog risk).
- [ ] The kitchen prints it, with Turkish characters intact.
- [ ] Both still work with the internet disconnected.
- [ ] The venue is reachable over HTTPS at a stable hostname, and table cards
      were printed only after that hostname was final.
- [ ] All three processes survive a reboot, and printing still works as
      services.
- [ ] A backup has been taken *and* restored.
- [ ] Staff have run a rehearsal shift.

Nothing here is checked by writing code. Every item is a thing that has to be
observed working on the venue's hardware.

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
