# Performance & Maintainability Work Order

This document outlines the planned optimizations for the Restaurant App to improve performance, maintainability, and user experience.

## Phase 1: Component Splitting & Modularization
**Goal:** Break down monolithic files to improve readability, reduce merge conflicts, and facilitate targeted rendering.

- [x] **AdminApp Splitting:**
  - [x] Extract `MenuTab` into `src/components/admin/MenuTab.tsx`
  - [x] Extract `TablesTab` into `src/components/admin/TablesTab.tsx`
  - [x] Extract `OrdersTab` into `src/components/admin/OrdersTab.tsx`
  - [x] Extract `SettingsTab` into `src/components/admin/SettingsTab.tsx`
  - [x] Refactor `AdminApp.tsx` to serve primarily as the layout and navigation shell.
- [x] **CustomerApp Splitting:**
  - [x] Analyze `CustomerApp.tsx` (35KB) and identify distinct UI sections (e.g., Menu, Cart, Order Status).
  - [x] Extract these sections into smaller components within `src/components/customer/`.

`AdminApp.tsx` went from 1609 lines to a 92-line shell. Beyond the four tabs, the
settings panels were extracted individually (`VenuePanel`, `PosHealthPanel`,
`BridgeKeyPanel`, `StaffPanel`, `DangerZonePanel`), since `SettingsTab` was the
largest tab by far and the panels are independently useful. `ItemEditor` also
moved out of `MenuTab`.

`CustomerApp.tsx` went from 851 lines to a 314-line container that owns session
state and data, with `Header`, `MenuSection`, `OrdersList`, `BillPanel`,
`CartBar`, `CartSheet`, `ItemSheet`, `Sheet` and `StateScreens` beneath it.

## Phase 2: React Server Components (RSC) & Bundle Optimization
**Goal:** Reduce the amount of JavaScript sent to the client.

- [~] **Push down `"use client"`:**
  - [~] Remove `"use client"` from the top level of `AdminApp` and `CustomerApp` if possible.
  - [x] Apply `"use client"` only to leaf components that require interactivity (e.g., buttons, forms, stateful tabs).
  - [~] Convert static layout wrappers (sidebars, headers) to Server Components.
- [x] **Lazy Loading:**
  - [x] Implement `next/dynamic` or `React.lazy` in `AdminApp` to lazy-load tab components (`MenuTab`, `OrdersTab`, etc.) so they are only downloaded when the user navigates to them.

**Not done, and why.** Both shells have to stay client components. `AdminApp`
owns the `tab` state its sidebar buttons set, and `CustomerApp` owns the table
session, cart, and live `EventSource`. Making either a Server Component would
mean lifting that state into a client child that still wraps the whole tree, so
the client boundary would not actually move — only the file it lives in would.
The sidebar and topbar are the same story: every nav button is a `setTab` call.

The bundle win came from lazy loading instead, which is where it actually was.
The four admin tabs load on first navigation, so a manager who only opens the
menu never downloads the settings panels. On the customer side `ItemSheet` and
`CartSheet` are also dynamic: neither is part of the first paint at the table,
and that is the phone-over-cellular path that matters most here.

## Phase 3: Data Fetching & Caching
**Goal:** Improve UI responsiveness, reduce server load, and eliminate basic `fetch` calls in `useEffect`.

- [x] **Adopt Data Fetching Library:**
  - [x] Install and configure **SWR** or **React Query**.
- [x] **Refactor API Calls:**
  - [x] Replace `useEffect` + `fetch` logic in `MenuTab` (categories loading) with the selected library.
  - [x] Apply the same refactoring to `TablesTab`, `OrdersTab`, and `CustomerApp`.
  - [x] Ensure mutations (e.g., adding a category, toggling availability) correctly invalidate and revalidate the cached data.

SWR, configured once in `src/lib/swr.ts`. Every panel previously owned a
`load()` callback plus a mount effect, which had two costs: two panels reading
the same endpoint issued two requests, and every mutation had to remember to
call its own reload. Keying on the URL fixes both — `VenuePanel` and
`BridgeKeyPanel` now share a single `/api/admin/venue` request, and mutations
revalidate by key.

One behavioural change worth knowing about: a 401 no longer retries. On the
customer app it means the table session was revoked or expired, and retrying
only burns requests against an endpoint that will keep refusing.

## Phase 4: Rendering Performance & Core Web Vitals
**Goal:** Optimize media loading and handle large lists efficiently.

- [x] **Image Optimization:**
  - [x] Replace native `<img>` tags in `MenuTab` (and customer-facing menu) with Next.js `<Image>` components.
  - [x] Configure `next.config.ts` for remote image domains if necessary.
- [x] **List Virtualization / Pagination:**
  - [x] Identify potentially large lists (e.g., historical orders in `OrdersTab`, large menus in `CustomerApp`).
  - [x] Implement pagination for historical data fetching.
  - [~] If rendering long lists on a single page, implement virtualization using `react-window` or `react-virtuoso`.

All four menu-photo sites now use `next/image`. No `remotePatterns` were needed:
photos are stored on the venue's own disk and served from `/api/media`, so every
URL is same-origin and already covered by the existing `img-src 'self'` CSP. The
`/api/media` route is public and immutable-cached, so the optimizer can refetch
it server-side without a session.

`/api/admin/orders` gained cursor pagination — 50 rows a page, `id` as the
`createdAt` tiebreaker so rows sharing a timestamp cannot repeat or vanish
between pages — replacing the flat 500-row cap that told managers to download a
CSV for anything older. `OrdersTab` pages through it with `useSWRInfinite`.

**Virtualization was deliberately skipped.** With the order log paged at 50 rows,
nothing renders a list long enough to pay for a windowing library. The customer
menu is the other candidate, but it is a category-anchored scroll: the header
rail links to `#cat-<id>` targets, and virtualizing the sections would break
those anchors to solve a problem a menu of a few hundred items does not have.
Worth revisiting only if a venue's menu or an unpaged list actually grows.

## Verification

`npm run typecheck`, `npm run lint`, `npm run build`, and `npm test` (222 tests)
all pass. The customer session was exercised end-to-end against a dev server —
scan link → table page → `/api/menu`, `/api/orders`, `/api/bill` — confirming
the split component tree renders and the endpoints the SWR hooks call are
intact. The authenticated admin screens were not clicked through; no admin
credentials were available in this environment.
