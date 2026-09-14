import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { getEnv, resetEnvCache, isSecureOrigin } from "@/lib/env";

// Validation runs at boot (src/instrumentation.ts), so what these pin is which
// misconfigurations stop the server starting rather than surfacing later as a
// customer being unable to order.

const VALID = {
  AUTH_SECRET: "a".repeat(32),
  CRON_SECRET: "b".repeat(24),
  DATABASE_URL: "postgres://masadan:pw@localhost:5432/masadan",
  NEXT_PUBLIC_BASE_URL: "https://pos.example.com",
};

const MANAGED = [
  "AUTH_SECRET",
  "CRON_SECRET",
  "DATABASE_URL",
  "NEXT_PUBLIC_BASE_URL",
  "UPLOAD_DIR",
] as const;

let saved: NodeJS.ProcessEnv;

function setEnv(vars: Record<string, string>) {
  for (const key of MANAGED) delete process.env[key];
  Object.assign(process.env, vars);
  resetEnvCache();
}

function without(key: string): Record<string, string> {
  const copy: Record<string, string> = { ...VALID };
  delete copy[key];
  return copy;
}

beforeEach(() => {
  saved = { ...process.env };
});
afterEach(() => {
  process.env = saved;
  resetEnvCache();
});

describe("required configuration", () => {
  it("accepts a complete environment", () => {
    setEnv(VALID);
    expect(getEnv().DATABASE_URL).toBe(VALID.DATABASE_URL);
  });

  it("refuses to start without a signing secret", () => {
    setEnv(without("AUTH_SECRET"));
    expect(() => getEnv()).toThrow(/AUTH_SECRET/);
  });

  it("refuses a signing secret shorter than the HS256 digest", () => {
    setEnv({ ...VALID, AUTH_SECRET: "too-short" });
    expect(() => getEnv()).toThrow(/AUTH_SECRET/);
  });

  it("refuses a non-Postgres database URL", () => {
    setEnv({ ...VALID, DATABASE_URL: "mysql://nope" });
    expect(() => getEnv()).toThrow(/DATABASE_URL/);
  });

  it("refuses a base URL that is not an absolute origin", () => {
    setEnv({ ...VALID, NEXT_PUBLIC_BASE_URL: "pos.example.com" });
    expect(() => getEnv()).toThrow(/NEXT_PUBLIC_BASE_URL/);
  });

  it("reports every problem at once, not just the first", () => {
    setEnv({ AUTH_SECRET: "short", DATABASE_URL: "mysql://x" });
    const message = (() => {
      try {
        getEnv();
        return "";
      } catch (e) {
        return (e as Error).message;
      }
    })();
    expect(message).toMatch(/AUTH_SECRET/);
    expect(message).toMatch(/DATABASE_URL/);
    expect(message).toMatch(/NEXT_PUBLIC_BASE_URL/);
  });
});

describe("upload directory", () => {
  it("defaults outside the application tree, so an update cannot delete photos", () => {
    setEnv(VALID);
    expect(getEnv().UPLOAD_DIR).toBe("/var/lib/masadan/uploads");
  });

  it("honours an explicit directory", () => {
    setEnv({ ...VALID, UPLOAD_DIR: "/srv/masadan/photos" });
    expect(getEnv().UPLOAD_DIR).toBe("/srv/masadan/photos");
  });
});

describe("isSecureOrigin", () => {
  it("is true for an https origin", () => {
    setEnv(VALID);
    expect(isSecureOrigin()).toBe(true);
  });

  it("is false for a plain-http LAN origin, so cookies stay sendable", () => {
    // Marking a cookie `secure` on http means the browser never sends it back:
    // customers would scan, get a session, and be told to re-scan forever.
    setEnv({ ...VALID, NEXT_PUBLIC_BASE_URL: "http://192.168.1.50:3000" });
    expect(isSecureOrigin()).toBe(false);
  });
});
