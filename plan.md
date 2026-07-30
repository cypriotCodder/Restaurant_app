# Prompt: Execute Masadan Sipariş Deployment-Readiness Plan

*(Intended for Claude Opus 5 / Claude Code, with repo, terminal, and `vercel` CLI access. Run at high effort — this is a security-relevant, multi-file migration where correctness matters more than token cost.)*

---

## Role

You are acting as the implementing engineer for **Masadan Sipariş**, a Next.js QR
table-ordering app, on a repo you have full read/write and terminal access to.
The app is architecturally complete but every stateful/realtime piece is a
dev-mode placeholder. Your job is to take it from "works on my machine" to
"deployable on Vercel for a single venue," by executing the plan in
`<plan>` below **exactly and in order**.

You are not designing this migration — it's already decided. Your job is
disciplined execution, verification at each step, and flagging anything the
plan doesn't cover instead of guessing.

---

## Ground rules (read before touching anything)

1. **Work phase by phase, in order: 0 → 1 → 2 → 3.** Do not begin a phase until
   the previous phase's verification step(s) have actually been run and pass.
   If a verification step fails, stop and fix it before moving on — don't
   patch around it and continue.
2. **State intent before each file edit.** One line: which file, what change,
   why — then make the change.
3. **Preserve public signatures.** `bus.ts`'s `publish(event)` / `subscribe(handler)`
   must keep their exact call signatures; only internals change. Every route
   that calls them should need zero edits.
4. **Do not touch** the files listed under "Unchanged by design" in the plan.
5. **No scope creep.** No payment/PSP logic, no self-serve onboarding, no
   multi-venue support, no features beyond what's listed. If you notice a
   related improvement, note it at the end instead of doing it.
6. **Never fabricate or guess credentials, env values, or provisioning state.**
   Anything that requires a real Vercel Marketplace action, a real account,
   or a human clicking "approve" — stop and ask, don't simulate it or invent
   plausible-looking values.
7. **No irreversible or external actions without confirmation** — this
   includes running `prisma migrate deploy` against a real database, deploying
   to Vercel, or provisioning Marketplace integrations. Ask first, even if the
   plan describes the action, unless you're clearly in a local/dev/test
   context.
8. **Report, don't narrate.** After each phase: a short status (what changed,
   what you ran, actual output/result — not "should work"), then move to the
   next phase or stop if blocked.

---

## Opus 5 calibration

*(Behavioral tuning, not task content — this section adjusts how you work, not what you build.)*

- **Narration:** before a phase's first tool call, one sentence on what you're about to do is enough. While working, only interrupt with an update if you hit something that changes the plan (a file doesn't match the plan's assumptions, an approach won't work). Don't narrate routine steps. When a phase finishes, lead with the outcome — pass/fail — then supporting detail.
- **Verification:** the phase-gate checks below are acceptance tests tied to the plan's own Verification section — run them because they're the deliverable's definition of done, not as an extra self-check layer. Don't add additional "let me double-check this is correct" passes beyond what's specified; you already verify your own work well without being told to, and stacking more on top just burns tokens.
- **Scope:** make routine implementation calls yourself (exact zod error message wording, exact security-header values, code style) without asking. Only stop for the specific triggers in the ground rules — real Marketplace/credential actions, irreversible commands, or a plan gap. If you think a step in the plan is wrong or there's a better approach, say so in one sentence and continue with the plan as written rather than substituting your own design.
- **Subagents:** if your harness supports delegation, only spawn one for a genuinely independent, parallelizable chunk of work (e.g., writing the Vitest suite while the Redis swap happens separately). Don't delegate small edits, and don't spawn a subagent just to verify your own work.
- **Self-correction:** if you catch a mistake from an earlier phase, fix it and mention it in one line only if it changes what ships. Don't narrate minor corrections.

---

## <plan>

# Deployment-Readiness Plan — Masadan Sipariş (QR Table Ordering)

## Context

The app is architecturally complete (customer scan → order → desk board →
AKINSOFT ESC/POS bridge) but every stateful/realtime piece is a **dev-mode
placeholder**: SQLite on local disk, an in-process `EventEmitter` bus,
disk-backed photo uploads, and an `AUTH_SECRET` that silently falls back to
`"dev-secret"`. On **Vercel** (chosen host) each of these breaks — serverless
is multi-instance, its filesystem is ephemeral, and the in-process bus can't
cross instances.

**Decisions locked (this session):**
- Host: **Vercel** (serverless / Fluid Compute)
- Scope: **single venue first** — no self-serve onboarding yet
- Payment: **pay-at-till** — PSP fields stay dormant, no payment work
- Realtime: **Upstash Redis pub/sub, keep SSE** — swap `bus.ts` internals
  behind its existing `publish`/`subscribe` API
- Hardening: **in scope now** — tests for security-critical logic + CI

**Outcome:** a Vercel deployment where the desk board updates live across
instances, photos persist, staff JWTs are unforgeable, the DB is hosted
Postgres, and the QR/session/rate-limit logic is covered by tests + CI.

---

### Phase 0 — Provision managed services (do this FIRST)

External services must be **really provisioned via the Vercel Marketplace**,
not hardcoded SDKs. First implementation action: **run the `marketplace`
skill** (`vercel integration`) to provision and pull env keys for:

| Need | Marketplace choice | Env vars produced |
|---|---|---|
| Postgres | **Neon** (Marketplace-native, serverless pooling) | `DATABASE_URL` (pooled), `DIRECT_URL` (unpooled, for migrations) |
| Redis pub/sub | **Upstash Redis** (Redis-protocol endpoint, supports SUBSCRIBE) | `REDIS_URL` (rediss://…) |
| Photo storage | **Vercel Blob** (native) | `BLOB_READ_WRITE_TOKEN` |

> Upstash must be reached with a **Redis-protocol** client (`ioredis`) for
> pub/sub — the `@upstash/redis` HTTP client cannot `SUBSCRIBE`.

---

### Phase 1 — Make it run on serverless (the load-bearing swaps)

**1a. Database: SQLite → Neon Postgres**
- `prisma/schema.prisma`: `datasource db` provider `sqlite` → `postgresql`;
  add `directUrl = env("DIRECT_URL")`.
- Switch from `prisma db push` to **migrations**: `prisma migrate dev`
  locally, `prisma migrate deploy` in the build. Add `postinstall`/build step
  `prisma generate`.
- `src/lib/db.ts` singleton is fine as-is (guards against hot-reload
  duplicates); keep it. Pooled `DATABASE_URL` handles serverless connection
  fan-out.
- `prisma/seed.mjs`: verify it runs against Postgres; reduce to **one real
  venue** (menu, tables, staff, bridge key) rather than the demo fixture for
  the single-venue launch.

**1b. Realtime: in-process bus → Redis pub/sub (keep SSE, zero route changes)**
- `src/lib/bus.ts` — keep the **exact `publish(event)` / `subscribe(handler)`
  signatures**. Internally:
  - Keep the local `EventEmitter` for in-process fan-out to open SSE handlers.
  - Add one module-level **`ioredis` subscriber** connection per instance that
    `SUBSCRIBE`s to a channel and re-`emit`s received events into the local
    EventEmitter.
  - `publish()` → `redis.publish(channel, JSON.stringify(event))` (every
    instance's subscriber, including the sender's, receives it and fans out
    locally).
- `src/lib/sse.ts` and both stream routes (`api/desk/stream/route.ts`,
  `api/session/stream/route.ts`) need **no changes** — they already consume
  `subscribe()`.
- Add `export const maxDuration = 300` to the SSE routes; the browser
  `EventSource` auto-reconnects when Vercel closes the stream at the duration
  cap (25s heartbeat already in place).

**1c. Uploads: local disk → Vercel Blob**
- `src/app/api/admin/upload/route.ts` — replace `fs writeFile` to
  `public/uploads` with `@vercel/blob` `put(name, buffer, { access: 'public' })`;
  store the returned URL in `MenuItem.photoUrl`. Keep the existing size/type
  validation (4 MB, jpg/png/webp).

---

### Phase 2 — Security & config hardening

**2a. Fail-closed secrets (highest priority)**
- `src/lib/staffAuth.ts:6` — **remove the `"dev-secret"` fallback.** Read
  `AUTH_SECRET` from a validated env module; throw at boot if missing.
- Add `src/lib/env.ts`: a **zod-validated env schema** (`zod` is already a
  dep) asserting `AUTH_SECRET` (min length), `DATABASE_URL`, `DIRECT_URL`,
  `REDIS_URL`, `BLOB_READ_WRITE_TOKEN`, `NEXT_PUBLIC_BASE_URL`. Import it in
  instrumentation so a misconfigured deploy fails fast, not silently.

**2b. Deployment config**
- `NEXT_PUBLIC_BASE_URL` must be the **final production QR domain before any
  QR is printed** — every physical QR is signed/encoded against it. Document
  as a release gate.
- Confirm bridge-key check (`api/bridge/pending`, `api/bridge/ack`) uses a
  constant-time compare; align with `verifyTableQr`'s `timingSafeEqual`
  pattern.
- Add security headers (via `next.config` or middleware): HSTS,
  `X-Content-Type-Options`, frame/referrer policy.

---

### Phase 3 — Hardening: tests + CI

**3a. Tests (Vitest)**
Add `vitest` + focused unit tests on the security-critical pure/logic layer:
- `src/lib/qr.ts` — sign/verify round-trip, `qrVersion` bump invalidates old
  sig, wrong-length/forged sig rejected.
- `src/lib/tableSession.ts` — hard-cap expiry, idle timeout, concurrent-cap
  displacement, table-code mismatch, revocation (Prisma against a test DB or
  mocked).
- Rate-limit path in `api/orders/route.ts` — 5 orders/session/10 min and
  10-open-orders/table enforcement.

**3b. CI (GitHub Actions)**
`.github/workflows/ci.yml`: on PR/push run `prisma validate` + `prisma generate`,
`eslint`, `tsc --noEmit`, `vitest run`. Gate merges on green.

---

### Critical files

| File | Change |
|---|---|
| `prisma/schema.prisma` | provider → postgresql, `directUrl` |
| `prisma/seed.mjs` | single real venue seed, Postgres-verified |
| `src/lib/bus.ts` | Redis pub/sub behind existing publish/subscribe API |
| `src/app/api/admin/upload/route.ts` | Vercel Blob instead of disk |
| `src/lib/staffAuth.ts` | remove `"dev-secret"` fallback |
| `src/lib/env.ts` *(new)* | zod env validation |
| `src/app/api/desk/stream/route.ts`, `api/session/stream/route.ts` | add `maxDuration` |
| `vitest.config.ts` + `tests/**` *(new)* | security-logic tests |
| `.github/workflows/ci.yml` *(new)* | lint/typecheck/test gate |

Unchanged by design: `sse.ts`, POS adapter/outbox layer, `bridge/agent.mjs`,
all customer/desk/admin UI, payment (pay-at-till).

---

### Verification (end-to-end)

1. **Local against prod-shaped stack:** `vercel env pull`,
   `prisma migrate deploy`, `npm run seed`, `npm run dev`. Scan a seeded
   table's `/scan/{code}?k=…` → menu → place order.
2. **Realtime across instances:** open `/desk` in one browser, order from
   `/t/{code}` in another → ticket appears live (proves Redis pub/sub, not
   in-process). Preview deployment on Vercel is the real multi-instance test.
3. **Uploads:** admin uploads a menu photo → returned Blob URL renders and
   survives a redeploy.
4. **Secrets fail-closed:** deploy with `AUTH_SECRET` unset → boot/env-validation
   error (not a silent dev-secret).
5. **QR revocation:** admin "QR Yenile" → old signed URL hits the re-scan
   wall; new QR works.
6. **POS bridge:** set venue `posAdapter=escpos_bridge`, run `bridge/agent.mjs`
   with `DRY_RUN=1` against the deployment → accepted order prints ticket to
   stdout; force a failure → "YAZICI HATASI" badge on desk.
7. **CI:** open a PR → lint + typecheck + vitest all green.

## </plan>

---

## Execution protocol

For each phase, follow this loop:

1. **Restate the phase's goal** in one sentence before starting.
2. **Make the changes**, file by file, per the ground rules above.
3. **Run that phase's relevant verification step(s)** from the plan's
   Verification section (map: Phase 0 → provisioning exists and env vars are
   real; Phase 1 → verification steps 1–3; Phase 2 → step 4; Phase 3 → step 7).
   Steps 2, 5, 6 are cross-cutting — re-check them once Phases 1–2 are both
   done.
4. **Report** pass/fail with real command output, not a summary claim.
5. Only then move to the next phase.

If you hit something the plan doesn't specify (e.g., a Marketplace UI flow
that needs a human click, an ambiguous existing file structure, a test that
needs a fixture not yet described), **stop and ask** — do not improvise scope.

---

## Definition of done

- [ ] Neon Postgres, Upstash Redis, and Vercel Blob are provisioned via the
      Vercel Marketplace (not hardcoded SDK config), with env vars pulled.
- [ ] `prisma/schema.prisma` targets Postgres with pooled + direct URLs;
      migrations (not `db push`) run in the build.
- [ ] `bus.ts` publish/subscribe callers are untouched; Redis pub/sub proven
      live across two instances (not just locally).
- [ ] Photo uploads go to Vercel Blob and survive a redeploy.
- [ ] `AUTH_SECRET` has no fallback; missing/invalid env fails the boot via
      `src/lib/env.ts`, not silently.
- [ ] `NEXT_PUBLIC_BASE_URL` is flagged as a release gate (final domain set
      before any QR is printed).
- [ ] Bridge-key and QR verification both use constant-time comparison;
      security headers are in place.
- [ ] Vitest covers `qr.ts`, `tableSession.ts`, and the order-route rate
      limits, all passing.
- [ ] `.github/workflows/ci.yml` runs prisma validate/generate, eslint,
      tsc --noEmit, and vitest on PRs, and is green.
- [ ] All 7 end-to-end verification steps from the plan have been executed
      (not just described) with real output.
- [ ] No file under "Unchanged by design" was modified; no payment,
      onboarding, or multi-venue work was added.

## Communication format

Keep phase reports short and concrete:

```
Phase N — <one-line goal>
Changed: <files>
Ran: <exact command(s)>
Result: <actual output / pass-fail>
Next: <phase N+1 | blocked on X, need your input>
```

Do not declare the migration complete until every item in "Definition of
done" is checked and evidenced.