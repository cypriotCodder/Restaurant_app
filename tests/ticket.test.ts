import { describe, it, expect } from "vitest";
import { encodePc857, renderEscPos, renderTicketText } from "@/lib/pos/ticket";
import type { Ticket } from "@/lib/pos/types";

// Kitchen tickets are Turkish. Encoding them as "ascii" mangled every accented
// character, so these pin the PC857 mapping the printers actually expect.

const ticket: Ticket = {
  venueName: "The Heaven",
  currency: "TRY",
  tableName: "Masa 3",
  orderNumber: 42,
  createdAt: new Date("2026-09-10T12:30:00Z"),
  totalKurus: 24500,
  lines: [
    { qty: 2, name: "Şiş Köfte", modifiers: ["Acılı"], note: "soğansız", unitPriceKurus: 9000 },
    { qty: 1, name: "Türk Kahvesi", modifiers: [], note: "", unitPriceKurus: 6500 },
  ],
};

describe("encodePc857", () => {
  it("maps every Turkish-specific character to its PC857 byte", () => {
    expect([...encodePc857("çÇüÜöÖıİşŞğĞ")]).toEqual([
      0x87, 0x80, 0x81, 0x9a, 0x94, 0x99, 0x8d, 0x98, 0x9f, 0x9e, 0xa7, 0xa6,
    ]);
  });

  it("passes printable ASCII through unchanged", () => {
    expect(encodePc857("Masa 3 x2").toString("latin1")).toBe("Masa 3 x2");
  });

  it("never emits a control byte for an unmappable character", () => {
    // A stray byte below 0x20 would be read by the printer as a command.
    for (const byte of encodePc857("日本語 ✂")) {
      expect(byte === 0x0a || byte >= 0x20).toBe(true);
    }
  });

  it("spells out the lira sign, which has no PC857 glyph", () => {
    expect(encodePc857("₺120,50").toString("latin1")).toBe("TL120,50");
  });

  it("normalises typographic punctuation the menu editor may introduce", () => {
    // Smart quotes and en-dashes become their ASCII equivalents; the o-umlaut
    // in the middle stays a PC857 byte (0x94) rather than being flattened.
    expect([...encodePc857("“Köfte” – tam")]).toEqual([
      0x22, 0x4b, 0x94, 0x66, 0x74, 0x65, 0x22, 0x20, 0x2d, 0x20, 0x74, 0x61, 0x6d,
    ]);
  });
});

describe("renderEscPos", () => {
  const bytes = () => Buffer.from(renderEscPos(ticket), "base64");

  it("selects the Turkish code page after init", () => {
    // ESC @ (init) must come first, then ESC t 13 — init resets the code page,
    // so selecting it earlier would be silently undone.
    expect([...bytes().subarray(0, 5)]).toEqual([0x1b, 0x40, 0x1b, 0x74, 0x0d]);
  });

  it("encodes Turkish item names as PC857 rather than mangling them", () => {
    const out = bytes();
    expect(out.includes(Buffer.from([0x9f]))).toBe(true); // ş in "Şiş Köfte"
    expect(out.includes(Buffer.from([0x94]))).toBe(true); // ö
    // The old "ascii" path turned these into "?" (0x3f) or stripped them.
    expect(renderTicketText(ticket)).toContain("Şiş Köfte");
  });

  it("ends with the partial cut so the ticket is separated", () => {
    expect([...bytes().subarray(-4)]).toEqual([0x1d, 0x56, 0x42, 0x03]);
  });
});
