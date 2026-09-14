import { describe, it, expect, beforeEach, afterEach } from "vitest";
import path from "node:path";
import { resolveUploadPath, readStored } from "@/lib/storage";
import { resetEnvCache } from "@/lib/env";

// On-prem, menu photos are read back through /api/media/[...path], whose
// segments come straight from the URL. That makes path traversal the thing to
// get right: UPLOAD_DIR sits on the restaurant PC alongside everything else.

const ROOT = "/var/lib/masadan/uploads";
let saved: NodeJS.ProcessEnv;

beforeEach(() => {
  saved = { ...process.env };
  process.env.DEPLOY_TARGET = "onprem";
  process.env.AUTH_SECRET = "a".repeat(32);
  process.env.CRON_SECRET = "b".repeat(24);
  process.env.DATABASE_URL = "postgres://u:p@localhost/masadan";
  process.env.NEXT_PUBLIC_BASE_URL = "https://pos.example.com";
  process.env.UPLOAD_DIR = ROOT;
  resetEnvCache();
});
afterEach(() => {
  process.env = saved;
  resetEnvCache();
});

describe("resolveUploadPath", () => {
  it("resolves a normal key inside the upload directory", () => {
    expect(resolveUploadPath("menu/venue_1/abc123.jpg")).toBe(
      path.join(ROOT, "menu/venue_1/abc123.jpg")
    );
  });

  it("refuses a key that climbs out of the upload directory", () => {
    expect(() => resolveUploadPath("../../etc/passwd")).toThrow(/escapes UPLOAD_DIR/);
    expect(() => resolveUploadPath("menu/../../../../etc/shadow")).toThrow(/escapes UPLOAD_DIR/);
  });

  it("refuses an absolute key", () => {
    expect(() => resolveUploadPath("/etc/passwd")).toThrow(/escapes UPLOAD_DIR/);
  });

  it("refuses a sibling directory that merely shares the prefix", () => {
    // "/var/lib/masadan/uploads-backup" starts with the root string but is not
    // inside it — a prefix check without the separator would let this through.
    expect(() => resolveUploadPath("../uploads-backup/secret.jpg")).toThrow(/escapes UPLOAD_DIR/);
  });
});

describe("readStored", () => {
  it("serves nothing for a file type the upload route never accepts", async () => {
    // Even if something else wrote it there, it must not come back as active
    // content from a URL customers can reach.
    expect(await readStored("menu/venue_1/payload.html")).toBeNull();
    expect(await readStored("menu/venue_1/script.js")).toBeNull();
    expect(await readStored("menu/venue_1/no-extension")).toBeNull();
  });

  it("returns null rather than throwing for a missing image", async () => {
    expect(await readStored("menu/venue_1/does-not-exist.jpg")).toBeNull();
  });

  it("returns null rather than throwing for a traversal attempt", async () => {
    expect(await readStored("../../etc/passwd.png")).toBeNull();
  });
});
