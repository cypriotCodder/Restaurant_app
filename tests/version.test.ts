import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// buildVersion() caches per process and reads relative to cwd, so each case
// gets a fresh module registry and its own directory to read from.
async function loadIn(dir: string) {
  vi.resetModules();
  const spy = vi.spyOn(process, "cwd").mockReturnValue(dir);
  const mod = await import("../src/lib/version");
  return { mod, spy };
}

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), "version-"));
});

afterEach(() => {
  vi.restoreAllMocks();
  rmSync(dir, { recursive: true, force: true });
});

describe("buildVersion", () => {
  it("reads a stamped bundle", async () => {
    writeFileSync(
      path.join(dir, "version.json"),
      JSON.stringify({
        version: "0.1.0",
        commit: "a1b2c3",
        dirty: false,
        builtAt: "2026-09-15T10:00:00.000Z",
      })
    );
    const { mod } = await loadIn(dir);
    expect(mod.buildVersion().version).toBe("0.1.0");
    expect(mod.buildVersion().commit).toBe("a1b2c3");
    expect(mod.versionLabel()).toBe("0.1.0+a1b2c3");
  });

  it("reports dev when there is no stamp", async () => {
    // A development server: nothing has been packaged, so there is no file.
    const { mod } = await loadIn(dir);
    expect(mod.buildVersion().version).toBe("dev");
    expect(mod.versionLabel()).toBe("dev");
  });

  it("marks a dirty build in the label", async () => {
    // update.ps1 warns on this: a venue running it cannot be traced to a commit.
    writeFileSync(
      path.join(dir, "version.json"),
      JSON.stringify({ version: "0.1.0", commit: "a1b2c3", dirty: true, builtAt: "x" })
    );
    const { mod } = await loadIn(dir);
    expect(mod.versionLabel()).toBe("0.1.0+a1b2c3-dirty");
  });

  it("survives a corrupt stamp rather than taking down the health endpoint", async () => {
    // /api/health is the one route that must answer when things are wrong, so a
    // malformed stamp must degrade to "unknown", not throw.
    writeFileSync(path.join(dir, "version.json"), "{not json");
    const { mod } = await loadIn(dir);
    expect(mod.buildVersion().version).toBe("dev");
  });

  it("treats a stamp with no version as unknown", async () => {
    writeFileSync(path.join(dir, "version.json"), JSON.stringify({ commit: "a1b2c3" }));
    const { mod } = await loadIn(dir);
    expect(mod.buildVersion().version).toBe("unknown");
  });

  it("reads the file once per process", async () => {
    writeFileSync(
      path.join(dir, "version.json"),
      JSON.stringify({ version: "0.1.0", commit: null, dirty: false, builtAt: "x" })
    );
    const { mod, spy } = await loadIn(dir);
    mod.buildVersion();
    const afterFirst = spy.mock.calls.length;
    mod.buildVersion();
    mod.buildVersion();
    // Monitoring hits health every minute; re-reading would be pure syscalls.
    expect(spy.mock.calls.length).toBe(afterFirst);
  });
});
