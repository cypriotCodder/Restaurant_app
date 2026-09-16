# Performance & Maintainability Work Order

This document outlines the planned optimizations for the Restaurant App to improve performance, maintainability, and user experience.

## Phase 1: Component Splitting & Modularization
**Goal:** Break down monolithic files to improve readability, reduce merge conflicts, and facilitate targeted rendering.

- [ ] **AdminApp Splitting:**
  - [ ] Extract `MenuTab` into `src/components/admin/MenuTab.tsx`
  - [ ] Extract `TablesTab` into `src/components/admin/TablesTab.tsx`
  - [ ] Extract `OrdersTab` into `src/components/admin/OrdersTab.tsx`
  - [ ] Extract `SettingsTab` into `src/components/admin/SettingsTab.tsx`
  - [ ] Refactor `AdminApp.tsx` to serve primarily as the layout and navigation shell.
- [ ] **CustomerApp Splitting:**
  - [ ] Analyze `CustomerApp.tsx` (35KB) and identify distinct UI sections (e.g., Menu, Cart, Order Status).
  - [ ] Extract these sections into smaller components within `src/components/customer/`.

## Phase 2: React Server Components (RSC) & Bundle Optimization
**Goal:** Reduce the amount of JavaScript sent to the client.

- [ ] **Push down `"use client"`:**
  - [ ] Remove `"use client"` from the top level of `AdminApp` and `CustomerApp` if possible.
  - [ ] Apply `"use client"` only to leaf components that require interactivity (e.g., buttons, forms, stateful tabs).
  - [ ] Convert static layout wrappers (sidebars, headers) to Server Components.
- [ ] **Lazy Loading:**
  - [ ] Implement `next/dynamic` or `React.lazy` in `AdminApp` to lazy-load tab components (`MenuTab`, `OrdersTab`, etc.) so they are only downloaded when the user navigates to them.

## Phase 3: Data Fetching & Caching
**Goal:** Improve UI responsiveness, reduce server load, and eliminate basic `fetch` calls in `useEffect`.

- [ ] **Adopt Data Fetching Library:**
  - [ ] Install and configure **SWR** or **React Query**.
- [ ] **Refactor API Calls:**
  - [ ] Replace `useEffect` + `fetch` logic in `MenuTab` (categories loading) with the selected library.
  - [ ] Apply the same refactoring to `TablesTab`, `OrdersTab`, and `CustomerApp`.
  - [ ] Ensure mutations (e.g., adding a category, toggling availability) correctly invalidate and revalidate the cached data.

## Phase 4: Rendering Performance & Core Web Vitals
**Goal:** Optimize media loading and handle large lists efficiently.

- [ ] **Image Optimization:**
  - [ ] Replace native `<img>` tags in `MenuTab` (and customer-facing menu) with Next.js `<Image>` components.
  - [ ] Configure `next.config.ts` for remote image domains if necessary.
- [ ] **List Virtualization / Pagination:**
  - [ ] Identify potentially large lists (e.g., historical orders in `OrdersTab`, large menus in `CustomerApp`).
  - [ ] Implement pagination for historical data fetching.
  - [ ] If rendering long lists on a single page, implement virtualization using `react-window` or `react-virtuoso`.
