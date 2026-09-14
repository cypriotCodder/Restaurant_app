# Setup & Security Guide

This document outlines the step-by-step instructions for setting up, configuring, and safely running the **QR Table Ordering System** (`Masadan Sipariş`).

---

## 1. Prerequisites & Installation

Ensure Node.js (v24 LTS) and PostgreSQL 16+ are installed, then install dependencies:

```bash
npm install
```
*(This automatically runs `prisma generate` post-install).*

---

## 2. Environment Configuration

Copy `.env.example` to `.env.local` and fill it in. **Do not copy secrets out of
any document — generate your own**, or every install that follows the guide
shares the same signing key:

```env
# openssl rand -base64 32   — signs staff session tokens
AUTH_SECRET=""

# openssl rand -base64 24   — authenticates the manual POS sweep endpoint
CRON_SECRET=""

# PostgreSQL on the same machine as the app
DATABASE_URL="postgresql://masadan:PASSWORD@localhost:5432/masadan"

# The origin customers reach the app on. Table QRs are signed against this,
# and the `secure` cookie flag and HSTS/CSP are derived from its scheme.
NEXT_PUBLIC_BASE_URL="http://localhost:3000"

# Where menu photos are written; keep it outside the application directory.
UPLOAD_DIR="./.uploads"

# (Optional) Seed Staff Credentials — random ones are generated and printed
# once if these are unset.
SEED_ADMIN_EMAIL="admin@theheaven.local"
SEED_ADMIN_PASSWORD=""
SEED_DESK_EMAIL="desk@theheaven.local"
SEED_DESK_PASSWORD=""
```

There is nothing else to configure: no cache, object store or scheduler service.
For installing on the restaurant PC, see [ONPREM_SETUP.md](ONPREM_SETUP.md).

---

## 3. Database Migration & Initial Seeding

1. Apply Prisma migrations to your Postgres database:
   ```bash
   npm run migrate:deploy
   ```

2. Seed the database with initial venue data, sample menu items, table QR signatures, and staff users:
   ```bash
   npm run seed
   ```

> 🔑 **Default Staff Credentials:**
> - **Admin Email:** `admin@theheaven.local` (or `SEED_ADMIN_EMAIL`)
> - **Desk Email:** `desk@theheaven.local` (or `SEED_DESK_EMAIL`)
> - **Passwords:** If `SEED_ADMIN_PASSWORD` or `SEED_DESK_PASSWORD` are not specified in `.env.local`, the seed script generates random 12-character passwords and prints them **once** to your terminal output during `npm run seed`.

---

## 4. Running the Application Locally

Start the Next.js development server:

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) in your browser.

### Key Application Routes:
- `/` — Landing page with test QR scan links for all tables.
- `/scan/{code}?k={sig}` — Customer QR scan entry point (validates HMAC signature, mints session, redirects to menu).
- `/t/{code}` — Customer menu, cart, modifiers, and real-time order tracking.
- `/desk` — Kitchen & Desk live order ticket board (SSE real-time stream).
- `/admin` — Admin management dashboard (Menu items, Category CRUD, Table & QR generation, order history).
- `/login` — Staff login page (`/admin` and `/desk`).

---

## 5. Hosting & Security Best Practices

### Local vs. Cloud Deployment
- **Local Application Server:** The Next.js app runs locally (`http://localhost:3000`) without requiring immediate cloud hosting.
- **No remote services:** PostgreSQL runs on the same machine as the app; the event bus, rate limiter and scheduler are all in-process. Node and Postgres are the only runtime dependencies.

### Exposing Server IPs to Customer Devices
- ⚠️ **Do NOT expose raw host IP addresses directly to customers in production.**
- Exposing a local IP (e.g. `http://192.168.1.X:3000`) on guest Wi-Fi exposes your host machine/terminal to local network port scanning and runs unencrypted over plain HTTP (triggering browser security warnings).
- **Production Standard:** Serve the app over TLS on a real hostname, behind a reverse proxy (Caddy or nginx) that terminates the certificate. Customer phones must trust it — a self-signed certificate shows a full-page warning before the menu loads. See [ONPREM_SETUP.md](ONPREM_SETUP.md) §2.

---

## 6. (Optional) Kitchen Printer Bridge Agent

To print tickets directly to an on-premise ESC/POS network kitchen printer (port 9100):

```bash
BASE_URL=http://localhost:3000 \
BRIDGE_KEY=<KEY_FROM_SEED_OUTPUT> \
PRINTER_HOST=192.168.1.50 \
node bridge/agent.mjs
```
*(Set `DRY_RUN=1` to preview printed output in the terminal).*
