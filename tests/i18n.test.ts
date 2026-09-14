import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { t, statusLabel, locales } from "@/lib/i18n";

// Customers see this app in Turkish by default and staff switch it to English
// to help a tourist. A key present in one dictionary and missing from the other
// silently degrades to the Turkish string mid-sentence, which reads as a bug.

const source = readFileSync(path.join(process.cwd(), "src/lib/i18n.ts"), "utf8");

function keysOf(locale: "tr" | "en"): string[] {
  const block = new RegExp(`  ${locale}: \\{([\\s\\S]*?)\\n  \\},`).exec(source);
  if (!block) throw new Error(`could not find the ${locale} dictionary`);
  return [...block[1].matchAll(/^\s{4}(\w+):/gm)].map((m) => m[1]);
}

describe("dictionary parity", () => {
  it("defines the same keys in both languages", () => {
    const tr = keysOf("tr");
    const en = keysOf("en");
    expect([...en].sort()).toEqual([...tr].sort());
  });

  it("has no duplicate keys within a dictionary", () => {
    for (const locale of ["tr", "en"] as const) {
      const keys = keysOf(locale);
      expect(new Set(keys).size, `${locale} has duplicates`).toBe(keys.length);
    }
  });

  it("leaves no key with an empty translation", () => {
    for (const locale of locales) {
      for (const key of keysOf("tr")) {
        expect(t(locale, key as Parameters<typeof t>[1]).length, `${locale}.${key}`).toBeGreaterThan(0);
      }
    }
  });
});

describe("statusLabel", () => {
  it("translates every status the desk can set", () => {
    // These are the values in the transition table in the desk route; an
    // untranslated one would surface as a raw English enum on a customer phone.
    for (const status of ["received", "accepted", "preparing", "ready", "served", "rejected"]) {
      for (const locale of locales) {
        expect(statusLabel(locale, status)).not.toBe(status);
      }
    }
  });

  it("falls back to the raw value for an unknown status rather than throwing", () => {
    expect(statusLabel("tr", "something_new")).toBe("something_new");
  });
});

describe("bill vocabulary", () => {
  it("is present in both languages", () => {
    for (const locale of locales) {
      for (const key of ["requestBill", "tableTotal", "yourShare", "visitClosedTitle"] as const) {
        expect(t(locale, key)).toBeTruthy();
      }
    }
  });
});
