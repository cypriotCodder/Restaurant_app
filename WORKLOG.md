# Work Log

A record of each change made to this project: what was asked, what actually
changed, why the non-obvious decisions were made that way, and what evidence
says it works.

Newest entry first. One entry per step of work.

> **Scope of this log.** It starts at the bill/close-table workflow
> (2026-09-10). Earlier work in this codebase — the deploy-readiness audit and
> its fixes, POS delivery reliability, the on-prem migration, and the Next.js
> 16.3.4 upgrade — predates the log and is not recorded here. Ask if you want
> those entries backfilled.

---

## 2026-09-14 — Desk order editing

**Asked for:** the last large item from the review. Correcting an order meant
rejecting the whole ticket and asking the customer to order again.

### Design decisions put to the user

| Question | Chosen |
|---|---|
| When is an order editable? | Through the kitchen states, with a warning once printed |
| What can change? | Quantities and removing lines |
| What does the kitchen get? | A ticket marked **DÜZELTME / AMENDED** |

### Code

**Schema** (migration `20260914000000_order_edits`): `OrderItem.voidedAt`, and a
new `OrderEdit` model recording who changed what and whether a ticket had
already gone out.

**New — `src/lib/orderEdit.ts`**: `editOrder` applies the change, recomputes the
total, writes the audit row, and publishes `order.updated`.

**New route** — `PATCH /api/desk/orders/[id]/items`.

**Modified** — `Ticket` gained an optional `amendment`; `renderTicketText` prints
the banner and a change list; `outbox.ts` gained
`enqueueAmendmentInBackground`; `visit.ts` and `outbox.ts` exclude voided lines;
the desk list exposes line ids and edit history; `DeskBoard` gained an edit
dialog and an amendment notice.

### Decisions worth knowing

**Lines are voided, never deleted.** The record of what was originally ordered
survives the correction.

**Quantities may only go down.** Increasing is an addition, which belongs in a
new order so the kitchen gets a fresh ticket rather than an amendment.

**An order cannot be emptied.** Voiding every line would leave a zero-item
order; that is a rejection or a cancellation, both of which carry a reason this
path does not.

**The total is recomputed server-side** from the stored line snapshots. Nothing
about price or total is taken from the client.

**Editing is blocked after `served`.** A mistake found after the food was handed
over is a bill adjustment, which is a different conversation.

**The amendment ticket is marked loudly, first.** A cook glancing at the rail
must not mistake a correction for a second order and cook it twice. The desk
also shows a notice telling staff to say so verbally.

### Verification

Unit: **216 tests pass** (21 new in `tests/orderEdit.test.ts`). `tsc` clean,
`eslint` clean, `npm run package` zero warnings.

End-to-end against a real PostgreSQL instance:

| Check | Result |
|---|---|
| Edit before acceptance (3 → 1) | total 43000 → 25000, `amendmentPrinted: false` |
| Edit after the ticket printed (void a line) | total → 9000, `amendmentPrinted: true` |
| Kitchen tickets | 2 — original, then one headed `DUZELTME / AMENDED` listing `IPTAL/VOID Espresso (Yönetici)` |
| Increase a quantity | refused |
| Revive a voided line | refused |
| Empty the order | `empties_order` |
| No-op edit | `no_change` |
| Edit after `served` | `not_editable` |
| Customer's bill | 9000, `1x Türk Kahvesi` — matches |
| Audit trail | both edits attributed, correctly flagged before/after print |

### A thing I got wrong and removed

The dialog first showed a projected new total, computed by dividing the order
total by the item count to guess a unit price — arithmetic that is wrong for any
order with differently-priced lines, hidden in an `sr-only` element. Removed; it
now shows the current total, and the new one comes back from the server.

### Not done

- No adding items, notes or modifier changes; all three are separate builds.
- No bill adjustment after `served`.
- The customer's phone sees the new total but is not told *why* it changed.

---

## 2026-09-14 — Phone testing parked: unresolved, not fixed

**Status: OPEN.** Scanning a QR on a phone has never once been verified to work.
Phone testing is deferred by decision, not because the problem was solved.

### Where it was left

Safari reports *"cannot open the page because it couldn't connect to the
server"* for `http://192.168.0.152:3000/api/health` — a TCP-level failure, so
the application is not involved.

Everything on the Mac checks out:

| Check | Result |
|---|---|
| Application firewall | disabled, stealth mode off |
| Listener | `tcp46 *.3000 LISTEN` — dual-stack, accepts IPv4 |
| Subnet | 192.168.0.0/24, gateway 192.168.0.1 |
| Origin | matches the machine's address; startup guard silent |
| `/api/health` locally | `{"status":"ok"}` |

Two possibilities remain, unresolved:

1. The phone is on a different network (cellular, or another SSID).
2. The router isolates wireless clients from each other. The 11 hosts that
   answered a ping sweep may all be wired, in which case the Mac reaching *them*
   says nothing about a phone reaching the Mac.

**The phone's IP address distinguishes these** and was never obtained.

### A limit on every check done from this machine

Connecting to `192.168.0.152:3000` *from the Mac* is short-circuited through
loopback by the kernel — it never crosses the wifi. So no test runnable here can
demonstrate external reachability. The same trap applied to the `.local`
hostname, which resolves to `127.0.0.1` on the machine itself.

This is why several rounds of "verified working" were followed by "still fails
on the phone": the verification could not, even in principle, cover the failing
path.

### Risk carried forward

QR ordering is the product's entire premise and it has not been demonstrated on
a real device. Nothing in the codebase is known to be wrong — the last three
causes were all environmental (stale origin, cross-origin dev blocking, network
isolation) — but "no known defect" is not the same as "works".

Before the restaurant install, on the venue's own network:

- Confirm a phone can load `/api/health` over the venue wifi.
- Confirm wireless-to-wireless traffic is permitted; guest networks commonly
  block it, which would stop **every customer phone**, not just a test one.
- Only then print table cards.

Options offered and not taken: a public tunnel (works from any network), reading
the phone's IP, disabling AP isolation on the router.

---

## 2026-09-14 — Stale origin again; added a startup guard

**Reported:** the hotspot approach also failed; scanning still fails on the phone.

### What was actually wrong

Two mismatches, either of which alone guarantees failure:

- The Mac was on **192.168.0.152** (gateway `192.168.0.1`) — an ordinary wifi
  network, **not** a hotspot, which would be `172.20.10.x`. The tethering step
  did not end up in effect.
- `.env` still held **192.168.3.176**, an address the machine no longer had.

Every QR therefore pointed at an address that could not exist anywhere.

### The network itself is fine

A sweep of `192.168.0.x` found **11 responding hosts**, so this network permits
device-to-device traffic — no client isolation, unlike the previous one. Nothing
further is needed to make a phone able to reach the server here.

### Change: the server now refuses to be quiet about a stale origin

A stale `NEXT_PUBLIC_BASE_URL` is invisible from the server's point of view —
pages serve, tests pass, the laptop works over localhost — while every QR it
generates is unreachable. That has now been mistaken for a broken app twice.

`src/lib/devOrigin.ts`, called from `src/instrumentation.ts` in development
only, compares the configured origin's host against the machine's actual IPv4
addresses (skipping VPN and virtual interfaces) and prints a warning naming both
and the fix. Hostnames and `localhost` are left alone: the former resolves
through DNS or mDNS and cannot be checked locally, the latter is deliberate.

Verified by pointing the origin at `192.168.99.99` and restarting:

```
⚠  NEXT_PUBLIC_BASE_URL points at an address this machine does not have.
   configured: 192.168.99.99
   this machine: 192.168.0.152
   Every QR code generated now will be unreachable from a phone.
   Fix with:  npm run dev:origin   then restart the dev server.
```

Silent again once the origin was corrected.

### State

Origin `http://192.168.0.152:3000`, server restarted, `/api/health` returns
`{"status":"ok"}`, `/scan` redirects correctly. `tsc` clean, lint clean,
**195 tests pass**.

### Not done

- Still not verified from a real phone. Every check remains machine-local, which
  is exactly the gap that has made the last several rounds slow.

---

## 2026-09-14 — Phone cannot reach the dev server: client isolation

**Reported:** QR links work on the laptop but still fail on the phone.

### Cause: the network, not the app

A sweep of the subnet found **only two responding hosts** — the router
(`192.168.3.1`) and the Mac itself (`192.168.3.176`). Nothing else on the
network is reachable.

That is **client isolation** (AP isolation): devices reach the internet through
the router but not each other. Standard on café, hotel and ISP guest networks.
No application change can defeat it.

The `/api/health` probe was what separated the two possibilities: plain JSON, no
JavaScript, no session. Its failure ruled out the app immediately.

Also confirmed: firewall off, server bound to `*:3000`, IP unchanged, en0 is
Wi-Fi with gateway `192.168.3.1`.

### Why the laptop "working" was misleading

`nedims-macbook-pro.local` resolves to **127.0.0.1** on the Mac itself, so that
request never left the machine. A laptop test says nothing about whether a phone
can reach the server. Worth remembering as a general rule.

### Change: `npm run dev:origin`

The origin has now broken four times through network changes. Re-pointing it by
hand each time is what kept producing "the QR code is broken", so
`scripts/dev-origin.mjs` does the whole job: detect the LAN address (skipping
VPN and virtual interfaces, preferring the iOS hotspot range), rewrite `.env`,
and print every table's live scan URL plus the health-check URL.

Printing the URLs matters as much as setting the origin — a stale QR image is
indistinguishable from a broken app when scanned.

README gained a "Testing on a phone" section covering the command, client
isolation, and the `.local`-resolves-to-loopback trap.

### Resolution

Chosen: tether the Mac to the iPhone's Personal Hotspot, putting both devices on
a network that permits device-to-device traffic. Pending the user performing the
hotspot step.

### Not done

- Nothing yet verified on a real phone. Every check so far has been from the Mac
  or the laptop browser, neither of which crosses the network.

---

## 2026-09-13 — QR page stuck on a loading dot: Next dev blocked cross-origin

**Reported:** opening a QR link shows a screen with a yellow dot in the middle.

### Cause

`next dev` blocks requests to `/_next/*` dev resources from any origin other
than `localhost`. Reaching the dev server by hostname or LAN IP — which is what
a phone, and the QR links, necessarily do — counts as cross-origin, so the
client bundle never loaded and React never hydrated.

Every page was therefore stuck on its **server-rendered shell**. The customer
page's shell is `if (!menu) return <pulsing dot/>`, so it showed exactly one
amber dot and nothing else.

Fixed with `allowedDevOrigins` in `next.config.ts`, derived from
`NEXT_PUBLIC_BASE_URL`'s hostname plus private-network ranges so a phone can
also reach it by IP. Development only; production serves no dev endpoints.
**Requires a dev server restart** to take effect.

### How it was found

The Next dev server writes `.next/dev/logs/next-development.log`. Its last line
stated the cause outright:

> ⚠ Blocked cross-origin request to Next.js dev resource /_next/hmr from
> "nedims-macbook-pro.local" … add it to "allowedDevOrigins"

That log should have been the first thing read, not the last.

### Two wrong turns, recorded because they cost the most time

**1. Blamed the CSP, twice.** The browser console did show a real error —
`eval() is not supported in this environment … make sure that 'unsafe-eval' is
included`, from React's development build. It was genuine and is now fixed
(dev-only `'unsafe-eval'`; production stays strict). But it was **not** the
cause: removing the CSP header entirely left the page identical. A real error in
the console is not automatically *the* error.

**2. Trusted unreadable diagnostics.** `window.__next_f` and React fiber keys
both read as empty/absent from the page, which looked like proof that hydration
had failed. Checking the same values on `/login` — which rendered fine —
returned exactly the same empty results. The extension's JS context cannot see
them at all. Two "findings" were measurement artefacts.

The check that actually discriminated was comparing against a working page.
`/login` looked fine because its markup is server-rendered, so a missing client
bundle is invisible there; `/t/[code]` needs the client to fetch the menu, so the
same failure was obvious. Both pages were equally un-hydrated the whole time.

### Verification

Dev server restarted; its log immediately showed the client's own calls —
`/api/menu/CR0UaX8S 200`, `/api/orders 200`, `/api/bill 200`. Browser screenshot
confirms the full customer app: four categories, items with prices, the
Menü / Siparişlerim / Hesap tabs, the `Masa: Masa 2` badge and the EN toggle.

`tsc` clean, `eslint src tests` clean, **195 tests pass**.

### Not done

- `allowedDevOrigins` covers `192.168.*.*`, `10.*.*.*`, `172.*.*.*`, `*.local`
  and the configured hostname. A venue on some other private range would need
  it added.
- `next dev` rewrites a managed block into `AGENTS.md` on start; that edit is
  the framework's, not this work's.

---

## 2026-09-12 — QR links failing again: switched to a stable hostname

**Reported:** QR links still error when scanned.

### Cause

The same recurrence, one network later. `.env` held
`NEXT_PUBLIC_BASE_URL="http://192.168.0.152:3000"`; the machine had moved to
`192.168.3.176`. Every generated QR pointed at an address nothing answered on.

This was the third time an IP change broke scanning, so the fix this time was
the recurrence, not the address.

### A correction to earlier claims

`ONPREM_SETUP.md` and two worklog entries stated that changing
`NEXT_PUBLIC_BASE_URL` **invalidates every printed QR**. That is wrong about the
mechanism, and the mechanism changes the remedy.

`signTableQr` is `HMAC(qrSecret, "tableCode:qrVersion")` — the origin is **not**
part of the signed payload. The same `?k=` therefore verifies on any host.
Changing the base URL does not invalidate a card; it points it at an address
that may not answer.

Verified directly: a card generated for one origin was scanned against another
and the signature passed. What actually invalidates a card is bumping
`qrVersion` (per-table regeneration) or rotating `qrSecret`.

The consequence: **a stable hostname means printed cards survive network
changes**, which a hard-coded IP can never do. Docs corrected.

### Fix

`.env` now uses the machine's Bonjour name,
`http://nedims-macbook-pro.local:3000`. macOS advertises it over mDNS and iOS
resolves it natively; confirmed `dns-sd` maps it to the current wifi address
(`192.168.3.176`) on the wifi interface. The name follows the machine, so an IP
change no longer breaks anything.

### Verification

| Check | Result |
|---|---|
| Server on the hostname | `/login` 200 |
| `/scan` on the hostname | `307 → http://nedims-macbook-pro.local:3000/t/CR0UaX8S` |
| Menu page | 200, 12632 bytes |
| Menu API | 200 — The Heaven Restaurant &amp; Cafe, Masa 2, 4 categories |
| mDNS advertisement | `nedims-MacBook-Pro.local → 192.168.3.176` (wifi iface) |
| Old IP-based card, same `?k=` | still verifies, redirects to the hostname |

Backup of the previous `.env` at `/tmp/env.before-hostname.bak`.

### Not done

- Cards already printed against `192.168.0.152` must be regenerated once, since
  that address is dead. After this change, future network moves will not require
  it.
- `.local` depends on mDNS. iOS resolves it; Android is reliable from 12
  onwards. If a customer device cannot, the fallback is the LAN IP — and for the
  real venue the answer is the DNS name plus certificate in `ONPREM_SETUP.md` §2.

---

## 2026-09-12 — Customer order cancellation

**Asked for:** the next item from the review backlog. Picked customer
cancellation: previously a customer could not withdraw an order even seconds
after sending it, and the only escape was staff rejecting the whole ticket.

Deliberately **not** call-waiter, which was offered during the bill design and
not chosen.

### Code

**New — `src/lib/orderStatus.ts`.** Statuses were scattered as string literals
across seven files. Centralised, and a new `cancelled` status added alongside
`rejected`:

- `rejected` — staff refused it (out of stock, table left, suspected abuse)
- `cancelled` — the customer withdrew it before the kitchen accepted

Kept distinct rather than collapsed into one value: a manager looking at a spike
wants to know whether it was "we could not serve this" or "they changed their
mind".

**New — `POST /api/orders/[id]/cancel`.**

**Modified** — `visit.ts` and `reporting.ts` now exclude both void statuses
(`notVoid()`), the desk transition table, `i18n.ts` (tr + en), `CustomerApp`
(cancel button), `DeskBoard` and `AdminApp` (show the two outcomes distinctly).

### Decisions worth knowing

**Cancellable only while `received`.** Once staff accept, food may already be on
the pass, so the withdrawal has to go through them. No additional time limit: an
order sitting unaccepted for twenty minutes is one the customer is entitled to
give up on.

**Scoped to the placing session, not the table.** The orders list is a
whole-table view, so without this one diner could cancel another's food. The
lookup is `{ id, sessionId }`, and a foreign order returns 404.

**The update is conditional on the status, not just the id**
(`updateMany({ where: { id, status: "received" } })`). A cancel racing the desk's
accept must not both win — whoever writes first owns the outcome, and the loser
gets 409.

**`notVoid()` is a function, not a shared constant.** Prisma is handed a fresh
array each call, so no caller can mutate the one every other query depends on.
(The first attempt used `as const`, which Prisma's filter type rejects outright
for being readonly.)

### Verification

Unit: **195 tests pass** (14 new in `tests/orderCancel.test.ts`). `tsc` clean,
`eslint src tests` clean, `npm run package` zero warnings.

Three existing tests failed on the widened rule — correctly, since
`{ not: "rejected" }` became `{ notIn: ["rejected", "cancelled"] }`. Updated to
assert the new behaviour explicitly rather than loosened.

End-to-end against a real PostgreSQL instance, two phones at one table:

| Check | Result |
|---|---|
| Phone B cancels phone A's order | **404** — not theirs |
| Phone A cancels its own | 200 |
| Bill before → after | 27000 (2 lines) → **9000 (1 line)** |
| Cancel twice | 409 `already_accepted`, status `cancelled` |
| Cancel after the desk accepted | **409** `already_accepted`, status `accepted` |
| Desk active list | cancelled order gone |
| Desk SSE during a cancellation | `order.updated` received |
| Admin order log | `#1 cancelled`, `#2 accepted` — distinct |
| Items sold today | 1, not 3 — the cancelled 2× excluded |
| Attempt ledger | `customer_cancelled: 1` |

### Not done

- Staff cannot cancel on a customer's behalf; they reject, which requires a
  reason. Whether those should merge is a product question.
- No partial cancellation — it is the whole order or nothing. Removing one item
  from a multi-item order still needs the desk-editing feature, still open.
- A cancelled order that already reached the POS outbox is not recalled; the
  gate at `received` means it cannot have, since the outbox is only written on
  accept.

---

## 2026-09-12 — Fix: scanning a QR gave a black screen

**Reported:** scanning a table QR on a phone produced a black screen. The URL on
the card was `http://172.20.10.14:3000/scan/CR0UaX8S?k=…`.

Three separate faults were stacked, which is why the earlier origin fix alone
did not resolve it.

### 1. The origin on the card was dead

`.env` held `NEXT_PUBLIC_BASE_URL="http://172.20.10.14:3000"` — the iOS
personal-hotspot subnet, saved while tethered. The machine is now
`192.168.0.152`, so nothing answered at that address. Corrected in `.env`.

### 2. Every scan returned HTTP 500 with an empty body

The dev server points at Neon, which was missing the `20260910040000_table_visits`
migration — 5 of 6 applied. `mintSession` therefore wrote `visitId` to a column
that did not exist and threw on every scan.

**An empty 500 body is what renders as a black screen**, so this was the
proximate cause of the symptom as described. Fixed with `prisma migrate deploy`;
all 6 migrations now applied.

### 3. The redirect sent phones to their own localhost — a real code bug

`src/app/scan/[code]/route.ts` built both redirects with
`new URL(path, req.url)`. Next reconstructs `req.url` from the **bind** address,
so a phone that correctly reached `192.168.0.152:3000` was told
`Location: http://localhost:3000/t/…` — which it resolves against **itself**.
Connection refused, indistinguishable from a broken QR code.

Both redirects now use `baseUrl()`, the same runtime accessor QR generation
uses. A regression test in `tests/scanRateLimit.test.ts` pins that the redirect
targets the venue origin rather than the bind address.

### A hypothesis that did not survive

The customer page renders client-side, so a blank body would also result from
client JavaScript never running — and the CSP added earlier has no
`'unsafe-eval'`. A dev-only exception was added on that theory, then tested:
Turbopack's dev output contains **zero** `eval(` calls across all 8 chunks,
including the 900KB client bundle. The theory was wrong, so the change was
reverted rather than leaving the policy weakened. `next.config.ts` is unchanged.

### A correction made mid-investigation

Fault 2 was first identified correctly, then wrongly retracted: a later query
found `TableVisit` present and it was put down to a cold-start misread. In fact
the table had been genuinely missing, and the migration was applied in parallel
between the two observations. The original reading was right.

### Verification

| Check | Result |
|---|---|
| `/scan` before | HTTP **500**, 0 bytes |
| `/scan` after | `307 → http://192.168.0.152:3000/t/CR0UaX8S` |
| Signature on the reported card | **valid** — the QR itself was never wrong |
| Session cookie | set |
| Menu API over the LAN address | 200 |
| Dev chunks using `eval(` | 0 of 8 |

`tsc` clean, `eslint src tests` clean, **181 tests pass** (1 new).

### Not done

- Existing printed or screenshotted QR images still encode the dead origin and
  must be regenerated from Admin → Masalar.
- The LAN IP changes with every network switch, and each change leaves printed
  cards pointing at an address that no longer answers. (They are not invalidated
  cryptographically — see the 2026-09-12 hostname entry.) Only a stable hostname
  fixes this properly — `ONPREM_SETUP.md` §2.

---

## 2026-09-12 — Bulk QR print sheet (and a build-time origin bug it exposed)

**Asked for:** the bulk QR print sheet. Installing a venue meant opening
`/api/admin/tables/<id>/qr` once per table and printing each PNG by hand — forty
times for a mid-sized restaurant, and again after any QR rotation.

### Code

**New — `/admin/qr-sheet`** (`src/app/admin/qr-sheet/page.tsx` +
`src/components/QrSheet.tsx`): every table's card on A4, ready to cut.

- Three sizes — 4, 9 or 16 cards per page.
- Optional dashed cut guides.
- Active tables by default; `?include=all` adds deactivated ones.
- Print CSS: `@page { size: A4 }`, `break-inside: avoid` so a card is never
  split across sheets, and `print-color-adjust: exact` so the cut guides survive
  the browser's background-stripping.
- QR payloads are generated **server-side** and inlined as data URIs. The venue's
  signing secret must never reach the browser, and an inlined image cannot fail
  to load at print time and leave a sheet of blank cards.
- Error correction level **H** (30% recoverable): these live on café tables and
  will get wet, smudged and scratched.
- Linked from Admin → Masalar.

### The bug this exposed

The first live render encoded `http://172.20.10.14:3000` — a stale LAN address
from the **build machine's** `.env` — even though the server was started with
`NEXT_PUBLIC_BASE_URL=http://127.0.0.1:3111`.

**Next.js replaces `process.env.NEXT_PUBLIC_*` references with string literals at
build time.** Any direct read is frozen to whatever the build machine had. Four
places did this, and two of them generated QR codes:

| File | Effect |
|---|---|
| `api/admin/tables/[id]/qr` | **every single-table QR PNG** |
| `api/admin/tables` | the QR URL shown in the admin table list |
| `admin/qr-sheet` | the new sheet |
| `app/page.tsx` | dev scan links |

This is pre-existing and worse than the README's "set the base URL before
printing" warning implies: setting it correctly on the venue's server was **not
enough**, because the value was already baked in at build time. A venue built on
a developer's laptop would have printed cards pointing at that laptop.

`src/lib/env.ts` validates by passing the whole `process.env` object to zod,
which Next cannot inline — so that path was always correct. Added `baseUrl()`
there as the single accessor and routed all four call sites through it.

### Decisions worth knowing

**The sheet refuses to print against a local origin.** If `NEXT_PUBLIC_BASE_URL`
is empty, `localhost` or `127.0.0.1`, the print button is disabled and the page
explains why. The origin is inside every signature, so cards printed wrong
cannot be fixed afterwards — they have to be reprinted. Cheap guard, expensive
mistake.

**Screen chrome is `.no-print`.** What comes out of the printer is cards and
nothing else.

### Verification

Unit: **180 tests pass** (unchanged — this step is a page and a config fix;
the QR signing it relies on is already covered by `tests/qr.test.ts`).
`tsc` clean, `eslint src tests` clean, `npm run package` zero warnings.

End-to-end against a real PostgreSQL instance:

| Check | Result |
|---|---|
| Sheet renders | 200, 8 cards, QR images inlined |
| `qrSecret` in HTML | **absent** |
| **Before the fix** — origin encoded | `http://172.20.10.14:3000` (build machine) |
| **After the fix** — origin encoded | `http://127.0.0.1:3111` (runtime) |
| QRs matching the expected signed URL | **8/8**, verified by re-encoding and comparing bytes |
| Scanning a sheet QR | admitted, session cookie set |
| Local-origin guard | fires, print button `disabled` |
| Sizes | large 2/row, medium 3/row, small 4/row |
| Active only vs `include=all` | 7 vs 8 cards with one table deactivated |
| Desk user → `/admin/qr-sheet` | 307 → `/desk` |
| Anonymous | 307 → `/login` |

### Documentation

`ONPREM_SETUP.md`: the install checklist now includes printing the cards, and
the `NEXT_PUBLIC_BASE_URL` note explains the build-time trap and that code must
read through `baseUrl()`.

### Not done

- No PDF export; printing goes through the browser's print dialog.
- Card layout is not configurable beyond the three sizes — no logo, no custom
  wording, no per-table notes.
- Nothing tracks which tables have had a card printed since their last QR
  rotation, so after a rotation it is on staff to reprint all of them.

---

## 2026-09-12 — Venue settings UI

**Asked for:** the venue settings screen. The Settings tab had been a "Yakında /
Coming Soon" placeholder, and venue name, currency, locale and POS adapter were
database columns with no way to change them short of a SQL statement.

### Prerequisite: currency was decorative

`Venue.currency` had existed since the first schema, but **all 26 `formatKurus`
call sites ignored it** and rendered ₺ regardless. Shipping an editable setting
that silently did nothing would have been worse than not shipping it, so the
currency was wired through first:

- `src/components/MoneyContext.tsx` — a `CurrencyProvider` and `useMoney()` hook.
  Money is formatted in eight subcomponents across the admin and desk screens; a
  context beat threading a prop through all of them.
- `/admin` and `/desk` pages read the currency server-side and pass it in, so it
  arrives with the first render rather than flashing the wrong symbol.
- `CustomerApp` uses the currency it already receives from `/api/menu`.
- `Ticket` gained a `currency` field, so the **kitchen ticket** prints it too.

### Code

**New — `src/lib/venueSettings.ts`**: `updateVenueSettings`, `rotateQrSecret`,
and bridge-key create/list/delete, with the allowed currency and adapter lists
in one place.

**New routes**

| Route | Purpose |
|---|---|
| `GET/PATCH /api/admin/venue` | read and update settings |
| `POST /api/admin/venue/qr-secret` | rotate the QR signing key (slug-confirmed) |
| `POST/DELETE /api/admin/bridge-keys` | issue and revoke bridge keys |

**Settings tab rebuilt** — `VenuePanel`, `BridgeKeyPanel`, `DangerZonePanel`,
alongside the existing POS health and staff panels.

### Decisions worth knowing

**`qrSecret` never leaves the server.** The GET route selects columns
explicitly rather than returning the venue row.

**Bridge keys are shown once, at creation.** Listing returns a `…abcdef` hint —
enough to tell two keys apart, not enough to use one. A stolen admin session
should not yield a key that drains the print outbox from outside the building.

**Rotating the QR secret is gated behind typing the venue slug.** It invalidates
every printed table card at once and signs out every customer — the remedy for a
leaked secret, not routine maintenance. Per-table regeneration already exists on
the Tables screen for the ordinary case.

**Changing currency warns that prices are not converted.** Amounts are stored as
integer minor units; switching TRY→EUR relabels 18000 from ₺180 to EUR 180. The
UI says so in both languages.

**Saving reloads the page.** The currency is read server-side at page load, so a
change only reaches every price on screen after a reload.

**The POS adapter dropdown flags the trap**: choosing "Server log" means nothing
prints in the kitchen.

### Verification

Unit: **180 tests pass** (14 new in `tests/venueSettings.test.ts`). `tsc` clean,
`eslint src tests` clean, `npm run package` zero warnings.

End-to-end against a real PostgreSQL instance:

| Check | Result |
|---|---|
| GET settings | `qrSecret` absent; bridge key shown as `…99790c` only |
| Full key in response? | no |
| Rename + currency → EUR | applied |
| Customer menu after change | `The Heaven Bistro`, `EUR` |
| **Kitchen ticket after change** | `TOPLAM: EUR 180` (was `TL180`) |
| Invalid adapter (`escpos`) | rejected with the allowed values |
| Empty PATCH | `nothing_to_do` |
| QR rotation, wrong confirmation | `confirmation_required`, expects `the-heaven` |
| QR rotation, correct slug | 8 tables bumped |
| Previously-valid QR afterwards | **blocked** |
| Live sessions afterwards | 2/2 revoked |
| Freshly generated QR | works (reprinted cards are fine) |
| Bridge key issue → list | issued once, then listed as a hint |

### Incident during this step

While scripting the currency refactor I ran
`open(p, "w").write(open(p).read())`, which **truncated `DeskBoard.tsx` to zero
bytes** — Python opens for writing (truncating) before the read executes. The
file was uncommitted, so git held only the pre-session version.

Recovered in full from `sourcesContent` in the production build's source map
(`.next/server/chunks/ssr/*.map`), verified by brace balance and feature
checks (bills panel, settle dialog, password dialog, reject reasons, beep), then
re-applied the currency edits on top. No work was lost.

All subsequent file rewrites in this step used a read → transform → write-temp →
assert → move pattern instead.

### Not done

- `slug` is not editable; it is the confirmation token for QR rotation and
  appears in no user-facing text.
- No service charge, tax rate, opening hours, or venue logo.
- Currency affects display only — no conversion of existing prices, and the
  formatter still groups digits with Turkish conventions regardless of currency.

---

## 2026-09-11 — Scan rate limiting and a health endpoint

**Asked for:** two items from the review, done together — `/scan` had no rate
limit (a disk-filling DoS), and there was no health endpoint for monitoring.

### 1. Scan rate limiting

`/scan/[code]` is the only unauthenticated write path in the app. Every attempt
appended an `OrderAttempt` row with no limit, so a loop on that URL would fill
the venue's single disk. The signature itself is not brute-forceable (144 bits),
so the limits exist to bound **writes**, not to protect the secret.

**The constraint that shaped the design:** every customer on the venue's wifi
shares one NAT'd public IP. A straightforward per-IP cap on scans would lock out
a full restaurant. So the limit applies to **failed** scans — legitimate
customers succeed, a brute-forcer fails every time.

- 20 failed scans per IP per 10 minutes, checked **before** the table lookup, so
  a flood costs neither a query nor a row.
- Once blocked, exactly **one** `rate_limited` ledger row per window, so the
  abuse stays visible without the ledger becoming the flood.
- A valid scan **refunds** the failure budget (`clearRateLimit`): a party whose
  QR was regenerated mid-meal fails several times before someone reprints the
  card, and must not stay locked out afterwards.
- A generous 300 successful scans per IP per 10 minutes as a backstop against
  the session table being flooded.

Added `clearRateLimit(key)` to `src/lib/rateLimit.ts`.

### 2. Health endpoint

`GET /api/health` — **200** healthy, **503** degraded, so a monitor can alert on
the status code alone.

- **Database**: `SELECT 1`, not a connection test — a pooled connection can look
  alive while the database behind it refuses work.
- **Scheduler**: stale if the last POS sweep is older than 3 cycles (180s).
  Distinguishes "stopped running" from "running but failing".

`systemd`'s `Restart=always` recovers a process that *crashed*; it cannot see
one that is up but broken. That gap is what this closes.

Unauthenticated callers get `{"status":"ok"}` and nothing else. Detail — checks,
uptime, error text — requires the `CRON_SECRET` as a bearer token, so the
endpoint is safe to poll from the LAN.

`src/lib/scheduler.ts` now records `startedAt` / `lastSweepAt` / `lastSweepOk`
for this.

### Decisions worth knowing

**Limit failures, not scans.** The NAT'd-wifi constraint is the whole reason;
getting this backwards would have been a self-inflicted outage on a busy night,
and would have looked like the app "randomly" refusing customers.

**Health reports blank-free errors.** Prisma messages begin with blank lines and
a generic ``Invalid `prisma.x()` invocation:`` header. The first pass handed
monitoring an empty detail string; it now skips the noise and returns
``Can't reach database server at `127.0.0.1:55432` ``, which is something you
can act on at 20:00 on a Saturday.

### Verification

Unit: **166 tests pass** (10 new in `tests/scanRateLimit.test.ts`). `tsc` clean,
`eslint src tests` clean, `npm run package` zero warnings.

End-to-end against a real PostgreSQL instance:

| Check | Result |
|---|---|
| 100 invalid scans from one IP | **21 rows** written, not 100 (20 failures + 1 `rate_limited`) |
| Blocked IP | no further database queries |
| **60 valid scans from one NAT'd venue IP** | **0 locked out** |
| Attacker on another IP, 25 attempts | 21 rows, still blocked |
| Venue IP after the attack | still scanning normally |
| Health, unauthenticated | `{"status":"ok"}`, 200 |
| Health, with `CRON_SECRET` | full checks, uptime, sweep age |
| Health, wrong token | verdict only, no detail |
| **Postgres stopped** | `{"status":"degraded"}`, **503**; app still served `/login` |
| Health detail | ``Can't reach database server at `127.0.0.1:55432` `` |
| Postgres restarted | back to 200 |

### Documentation

`ONPREM_SETUP.md` gained a **Monitoring** section: what the codes mean, how to
get detail, and a systemd timer + watchdog that restarts the service on a failed
health check.

### Not done

- No alerting transport (email/SMS/Telegram). Health is pollable; nothing
  delivers a notification yet.
- No rate limit on the other customer endpoints (`/api/orders`, `/api/menu`),
  which are already gated behind a valid table session.
- Health does not check disk space, which is the resource the scan flood was
  threatening in the first place.

---

## 2026-09-11 — Admin reporting: three bugs fixed

**Asked for:** the three admin bugs found in the earlier review — a wrong
revenue comparison, a "revenue" figure that was not revenue, and a stats screen
that never refreshed.

### The bugs

1. **The yesterday comparison was wrong every day.** `OrdersTab` fetched
   `/api/desk/orders?all=1` — a **24-hour** window — then bucketed a "yesterday"
   of `[yesterday 00:00, today 00:00)`. Only the part of yesterday inside the
   rolling window was ever counted, so the baseline was understated and the
   percentage inflated, by an amount that changed with the time of day.
2. **"CİRO / REVENUE" counted orders placed, not money taken.** It summed every
   non-rejected order including tables still sitting there, who had not paid and
   might walk out. Nothing set `paymentStatus` at the time, so a correct figure
   was not even possible.
3. **The screen fetched once on mount** and then silently went stale for the
   rest of the shift.

### Code

**New — `src/lib/reporting.ts`**, server-side figures over an explicit range:

- `dayBounds(daysAgo)` — calendar-day boundaries, midnight to midnight
- `periodReport(venueId, from, to)` — takings split cash/card, settled tables,
  average check, orders placed/rejected, items sold
- `openTables(venueId)` — what is on the floor and still owed
- `percentChange` — returns `null` with no baseline, rather than a misleading `0%`

**New routes**

| Route | Purpose |
|---|---|
| `GET /api/admin/stats` | today + a full yesterday + open tables + change |
| `GET /api/admin/orders?days=N` | admin order log, clamped to 365 days / 500 rows |

**Modified** — `src/components/AdminApp.tsx` (Orders tab rewritten),
`src/app/api/admin/orders/export/route.ts` (added `payment_method` and
`visit_outcome` columns, which now carry real data).

### Decisions worth knowing

**Takings and orders are now two separate figures, deliberately.** `CİRO /
TAKINGS` counts only visits staff settled at the till — the number that
reconciles against the cash drawer. Orders placed is shown beside it as kitchen
volume. Open tables appear on their own line as "not yet taken", so a busy floor
never inflates the day's takings.

**Abandoned visits are excluded from takings.** A walkout closed by the sweep is
not money; counting it would inflate the figure against a drawer that never
received it.

**Average check is per settled table, not per order.** That is the restaurant
measure, and it is only meaningful now that visits exist.

**Cash/card split added** — the point of recording payment method last step was
to make end-of-day reconciliation possible, so it is now on the screen.

**Day boundaries use the server's local clock.** The app runs on a machine
inside the venue, so the server clock *is* the venue clock; no timezone column
is needed. Documented in `reporting.ts`, along with the note that a venue
trading past midnight would want an 04:00 business-day cutoff instead — a
deliberate simplification, not an oversight.

**The log's day filter is labelled "son N gün" (last N days).** It is a rolling
window, unlike the calendar-day stat cards above it. It was briefly labelled
"Bugün", which would have reproduced exactly the confusion this step fixed.

### Verification

Unit: **156 tests pass** (16 new in `tests/reporting.test.ts`). `tsc` clean,
`eslint src tests` clean, `npm run package` zero warnings.

End-to-end against a real PostgreSQL instance, seeded with known figures:

| Check | Result |
|---|---|
| Today: 2 settled (₺300 cash + ₺200 card) + one ₺900 **abandoned** walkout | takings **50000**, cash 30000, card 20000 — walkout excluded |
| Average check | 25000 = 50000 / 2 tables |
| Yesterday: 4 settled = 100000 | 100000, change −50% |
| **Added a 40000 sale at 09:00 yesterday**, outside a rolling 24h window | yesterday **140000**, change **−64%** |
| Live open table ordering ₺270 | takings unchanged at 50000; shown separately as `running: 27000` |
| `days` clamping | 9999 → 365; `abc` → 7 |
| Admin can open the desk SSE stream the tab subscribes to | `data: {"type":"connected"}` |
| CSV header | now includes `payment_method`, `visit_outcome` |

The fourth row is the proof for bug 1: at the time of the test a rolling 24-hour
window began at 10:45 yesterday, so a 09:00 sale fell outside it. The old code
would have reported yesterday as 100000 and a change of −50%; the truth is
140000 and −64%.

### Not done

- No weekly/monthly view, no per-item or per-category sales breakdown.
- No business-day cutoff for venues trading past midnight (see above).
- Bug 3 is fixed by an SSE subscription plus a 60s poll; verified the stream is
  reachable and the endpoints serve, but the React refresh itself was not
  exercised in a browser.

---

## 2026-09-11 — Staff account management

**Asked for:** staff account creation. Previously accounts existed only from the
database seed: adding an employee needed `psql`, and nobody — admin or desk —
could change their own password.

### Code

**New — `src/lib/staffAdmin.ts`** holds the rules, so the guards cannot drift
apart between routes:

- `createStaff` — email normalised to lowercase, password hashed with bcrypt
- `updateStaff` — rename, role change, password reset, deactivate, sign-out-everywhere
- `changeOwnPassword` — requires the current password
- `PASSWORD_MIN = 8`

**New routes**

| Route | Purpose |
|---|---|
| `POST /api/admin/staff` | create an account (admin only) |
| `PATCH /api/admin/staff/[id]` | rewritten: name, role, password, active, sign-out |
| `POST /api/auth/password` | self-service password change, any signed-in staff |

**New — `src/components/PasswordChangeDialog.tsx`**, reachable from both the
desk header and the admin sidebar. Extracted to its own module rather than
living in `DeskBoard`, so importing it into the admin screen does not drag the
whole desk bundle along.

**Modified** — `src/components/AdminApp.tsx` (staff panel rebuilt: add/edit
form, role select, password reset), `src/components/DeskBoard.tsx` (password
button).

### Decisions worth knowing

**Password minimum is 8, not 12+.** Staff type this on a shared terminal
several times a shift; a long minimum drives them to write it on a sticky note
by the till, which is worse. The real defence against guessing is the login rate
limiter (5 attempts per account per 15 minutes), which already existed.

**Changing role, password, or active status bumps `tokenVersion`; renaming does
not.** Staff tokens are stateless 12h JWTs, so without the bump a demotion or a
password reset would not take effect until the token expired. A rename changes
nothing about who may use the account, so it does not sign anyone out.

**A self-service password change re-issues the caller's own cookie.** Bumping
`tokenVersion` invalidates every token including the one in the browser doing
the changing. The route mints a fresh token at the new version, so the person
standing at the terminal stays signed in while every other device is signed out
— which is the point of changing it.

**A duplicate email returns the same error regardless of which venue owns it.**
`StaffUser.email` is globally unique, so a manager could otherwise probe which
addresses exist elsewhere on the platform.

**The current password is required to change it.** The desk is a shared
terminal; without that check anyone passing an unattended screen could take the
account over.

### Verification

Unit: **140 tests pass** (20 new in `tests/staffAdmin.test.ts`). `tsc` clean,
`eslint src tests` clean, `npm run package` zero warnings.

End-to-end against a real PostgreSQL instance:

| Check | Result |
|---|---|
| Create desk account | created; email normalised `Ayse@Theheaven.Local` → `ayse@theheaven.local` |
| New account signs in | 200 |
| Role boundary | desk 200 / admin **401** |
| Duplicate email | `email_taken` |
| Password under 8 | `invalid` + the reason |
| Deactivate self | `cannot_deactivate_self` |
| Demote self | `cannot_demote_self` |
| Promote to admin | her existing session → **401** (token revoked) |
| Rename | her session → **200** (not revoked) |
| Password change, wrong current | `wrong_password` |
| Password change, correct | changing device 200, **other device 401**, old password 401, new password 200 |

### Two caveats found while testing

**1. The `last_admin` guard is currently unreachable through the API.** It
refuses to deactivate or demote the last active admin — but the actor is always
an active admin, so any *other* account is never the last one, and acting on
yourself is caught earlier by `cannot_deactivate_self` / `cannot_demote_self`.
The venue-keeps-an-admin invariant holds (verified live: sole admin cannot
deactivate themselves), but it is the self-guard doing the work. The
`last_admin` branch is defence in depth for a future "delete staff" feature,
not live protection today.

**2. Two admins deactivating each other simultaneously could lock a venue out.**
Each request reads the other as still active, so both succeed. It needs two
admins acting in the same instant, so it is unlikely rather than impossible.
The fix is a transaction with a re-check, or a database constraint. **Not
fixed** — flagged for a decision.

### Not done

- No hard delete of staff accounts; deactivation only (they are referenced by
  `TableVisit.closedByStaffId`).
- No password reset for someone locked out — an admin must set a new one for
  them. There is no email delivery in this app.
- No audit trail of who changed which account.

---

## 2026-09-10 — Bill and close-table workflow

**Asked for:** the bill / close-table workflow — identified as the largest
functional gap in the app, which had no concept of a bill at all. The order
lifecycle ended at `served` and nothing ever closed a table.

### Design decisions taken before writing code

Three were put to the user rather than assumed, because each changes the
shape of the work:

| Question | Chosen |
|---|---|
| What does a bill cover when several phones share a table? | One table bill, with a per-phone split **view** |
| What is recorded at settlement? | Payment method + amount |
| Can customers request the bill? | Yes — customer requests, staff settle |

The remaining structural choice — introducing a **visit** entity rather than
deriving the bill from open orders — was mine, and is the spine of everything
below. Two facts forced it:

- A table seats up to `MAX_ACTIVE_PER_TABLE` (6) phones, each with its own
  `TableSession`, so a bill cannot be scoped per session.
- The customer's order list used a **four-hour wall-clock window**, which could
  show a newly-seated party the orders of the party before them.

A visit solves both: it is the unit a bill covers, and it is the correct scope
for "what has this party ordered".

### Schema

`prisma/schema.prisma` + migration `20260910040000_table_visits`.

New model **`TableVisit`** — one party's stay at a table:

- `status`: `open` → `bill_requested` → `closed`
- `openedAt`, `billRequestedAt`, `closedAt`, `closedReason` (`settled` | `abandoned`)
- `totalKurus`, `paymentMethod`, `paidAmountKurus`, `closedByStaffId`
- indexed on `(tableId, status)` and `(venueId, status)` — finding the open
  visit for a table is the hottest query in the flow

`TableSession.visitId` and `Order.visitId` added, both **nullable** so rows
created before visits existed keep working instead of requiring a risky
backfill.

The migration adopts any table with live sessions into an open visit, so a
party mid-meal when this deploys can still be billed rather than being stranded
with orders belonging to no visit.

### Code

**New — `src/lib/visit.ts`** holds the whole lifecycle:

- `openOrJoinVisit` — join the party at the table, or start one if idle
- `buildBill` — itemised bill plus the per-phone split
- `requestBill` / `clearBillRequest`
- `settleVisit` — the only place in the app that records money
- `closeAbandonedVisits` — walkout recovery

**New API routes**

| Route | Purpose |
|---|---|
| `GET/POST /api/bill` | customer's table bill; `POST` is "hesap istiyorum" |
| `GET /api/desk/bills` | open tables, bill requests sorted first |
| `GET/PATCH /api/desk/bills/[id]` | itemised bill w/ split; `PATCH` dismisses a request |
| `POST /api/desk/bills/[id]/settle` | staff-only; takes payment and closes the table |

**Modified**

- `src/lib/bus.ts` — added `bill.requested`, `bill.updated`, `visit.closed`
- `src/lib/tableSession.ts` — `mintSession` joins a visit; `ActiveSession` carries `visitId`
- `src/app/api/orders/route.ts` — orders join the visit; **the customer order
  list is now visit-scoped, retiring the four-hour window**
- `src/app/api/session/stream/route.ts`, `src/app/api/desk/stream/route.ts` — carry bill events
- `src/lib/scheduler.ts` — abandoned-visit sweep every 10 minutes
- `src/lib/i18n.ts` — bill vocabulary, tr + en
- `src/components/CustomerApp.tsx` — bill tab, request button, settled screen
- `src/components/DeskBoard.tsx` — open-tables queue, settle dialog with split view

### Decisions worth knowing

**Settling refuses by default when orders are still in the kitchen.** Closing a
table whose food is being cooked is nearly always a mis-tap. Staff get an
explicit "close anyway" override rather than being blocked.

**The total is snapshotted onto the visit at settlement**, so a later menu price
edit cannot rewrite what the till took that night.

**Abandoned visits close themselves** after 3 hours with no live session *and*
no recent order — both conditions, because a party can legitimately let every
phone idle out (30 min) while still sitting there waiting for food. They close
as `abandoned`, never `settled`, so the takings never claim money nobody paid.

**A settled table shows a thank-you, not an error.** The phone receives
`visit.closed` over SSE and renders "Teşekkürler"; previously it would have hit
the alarming "session expired, re-scan" wall.

**The scan race is handled.** Two phones scanning an idle table simultaneously
both try to open a visit; the loser deletes its row and joins the older one, so
a table cannot end up with two open visits splitting the bill in half.

**`paymentStatus` is now actually written.** Settling marks every order `paid`
with the method, closing the till-reconciliation gap — the app can now report
what a day took, split by cash and card.

### Verification

Unit: **120 tests pass** (27 new — `tests/visit.test.ts` 21, `tests/i18n.test.ts` 6).
`tsc --noEmit` clean, `eslint src tests` clean, `npm run package` with zero warnings.

End-to-end against a real PostgreSQL instance (throwaway cluster, migrations
applied, seeded, packaged bundle driven over HTTP):

| Check | Result |
|---|---|
| Two phones order at one table | ₺180 + ₺80 |
| Both see the table bill | total 26000; shares 18000 / 8000 |
| Customer requests bill | desk queue: `Masa 1 \| bill_requested \| 2 orders, 2 phones` |
| Settle with food in the kitchen | refused — `orders_in_flight` |
| Settle after serving | `{ok:true, totalKurus:26000}` |
| After settlement | orders `paid/cash`, 4/4 sessions revoked, phone gets `no_session`, table free |
| Re-scan | new visit, total 0 — **previous party invisible** |
| SSE desk | `bill.requested` → `visit.closed` |
| SSE customer | `bill.updated` → `visit.closed` |

`tests/tableSession.test.ts` needed its `db` mock extended, since minting a
session now joins a visit.

### Not done

- **No split payments.** The per-phone breakdown is a view for "we're paying
  separately"; the table settles once. Real split settlement, partial payments
  and split-by-item remain open.
- No printed customer receipt.
- The abandoned-visit sweep is unit-tested but not exercised live — the
  threshold is three hours.

---
