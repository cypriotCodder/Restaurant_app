# Setup & Security Guide

This document outlines the step-by-step instructions for setting up, configuring, and safely running the **QR Table Ordering System** (`Masadan Sipariş`).

---

## 1. Prerequisites & Installation

Ensure Node.js (v20+) is installed, then install dependencies:

```bash
npm install
```
*(This automatically runs `prisma generate` post-install).*

---

## 2. Environment Configuration

Create or update `.env.local` in the project root:

```env
# Secret key for JWT signing (at least 32 characters long)
AUTH_SECRET="rwOnyRrSsYRCGnSkOcGkbkxSCW1tLw87Q+WFUF9eNUI="

# Neon Postgres connections
DATABASE_URL="postgresql://user:password@ep-pooled.neon.tech/neondb?sslmode=require"
DATABASE_URL_UNPOOLED="postgresql://user:password@ep-direct.neon.tech/neondb?sslmode=require"

# Upstash Redis connection (must start with rediss:// or redis:// for pub/sub)
REDIS_URL="rediss://default:token@your-redis-host.upstash.io:6379"

# Vercel Blob read/write token for menu images
BLOB_READ_WRITE_TOKEN="vercel_blob_rw_..."

# Application Origin Base URL
NEXT_PUBLIC_BASE_URL="http://localhost:3000"

# (Optional) Seed Staff Credentials
SEED_ADMIN_EMAIL="admin@theheaven.local"
SEED_ADMIN_PASSWORD="YourCustomAdminPassword123!"
SEED_DESK_EMAIL="desk@theheaven.local"
SEED_DESK_PASSWORD="YourCustomDeskPassword123!"
```

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
- **Remote Services:** The database (Neon) and Redis (Upstash) are cloud-managed services configured in your `.env.local`.

### Exposing Server IPs to Customer Devices
- ⚠️ **Do NOT expose raw host IP addresses directly to customers in production.**
- Exposing a local IP (e.g. `http://192.168.1.X:3000`) on guest Wi-Fi exposes your host machine/terminal to local network port scanning and runs unencrypted over plain HTTP (triggering browser security warnings).
- **Production Standard:** Use a production domain with SSL/TLS (`https://your-domain.com`) placed behind a reverse proxy or CDN (like Vercel or Cloudflare) to hide the origin IP and encrypt customer traffic.

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
