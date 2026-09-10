import { formatKurus } from "../money";
import type { Ticket } from "./types";

/** Plain-text kitchen ticket, 32-col thermal-printer layout. */
export function renderTicketText(ticket: Ticket): string {
  const W = 32;
  const sep = "-".repeat(W);
  const lines: string[] = [];
  lines.push(center(ticket.venueName.toUpperCase(), W));
  lines.push(center(`*** ${ticket.tableName} ***`, W));
  lines.push(
    `Siparis #${ticket.orderNumber}`.padEnd(W - 5) +
      ticket.createdAt.toLocaleTimeString("tr-TR", { hour: "2-digit", minute: "2-digit" })
  );
  lines.push(sep);
  for (const l of ticket.lines) {
    lines.push(`${l.qty} x ${l.name}`);
    for (const m of l.modifiers) lines.push(`   + ${m}`);
    if (l.note) lines.push(`   ! ${l.note}`);
  }
  lines.push(sep);
  lines.push(`TOPLAM: ${formatKurus(ticket.totalKurus)}`.padStart(W));
  lines.push(center("Odeme kasada / Pay at till", W));
  return lines.join("\n");
}

function center(s: string, w: number): string {
  if (s.length >= w) return s;
  return " ".repeat(Math.floor((w - s.length) / 2)) + s;
}

/**
 * Turkish text for a thermal printer, encoded as PC857 (Multilingual Latin 5)
 * — the code page essentially every ESC/POS printer sold in Turkey ships with,
 * and the one AKINSOFT installs already print through.
 *
 * Encoding as "ascii" (as this did originally) silently mangled every Turkish
 * character on the ticket: "Şiş Köfte" printed as "^i^ K.fte".
 */
const PC857: Record<string, number> = {
  "ç": 0x87, "Ç": 0x80,
  "ü": 0x81, "Ü": 0x9a,
  "ö": 0x94, "Ö": 0x99,
  "ı": 0x8d, "İ": 0x98,
  "ş": 0x9f, "Ş": 0x9e,
  "ğ": 0xa7, "Ğ": 0xa6,
  "â": 0x83, "Â": 0xb6,
  "î": 0x8c, "Î": 0xd7,
  "û": 0x96, "Û": 0xea,
};

/** ASCII fallbacks for anything PC857 cannot represent. */
const ASCII_FALLBACK: Record<string, string> = {
  "₺": "TL",
  "’": "'", "‘": "'", "“": '"', "”": '"', "–": "-", "—": "-", "…": "...",
};

export function encodePc857(text: string): Buffer {
  const out: number[] = [];
  for (const ch of text) {
    const fallback = ASCII_FALLBACK[ch];
    if (fallback !== undefined) {
      for (const f of fallback) out.push(f.charCodeAt(0));
      continue;
    }
    const mapped = PC857[ch];
    if (mapped !== undefined) {
      out.push(mapped);
      continue;
    }
    const code = ch.charCodeAt(0);
    // Printable ASCII passes through; anything else becomes "?" rather than
    // an arbitrary byte the printer might read as a control code.
    out.push(code >= 0x20 && code <= 0x7e ? code : 0x3f);
  }
  return Buffer.from(out);
}

/**
 * Raw ESC/POS byte stream (base64) for network thermal printers (port 9100)
 * — the same printers an AKINSOFT install already prints kitchen tickets to.
 */
export function renderEscPos(ticket: Ticket): string {
  const parts: Buffer[] = [];
  parts.push(Buffer.from([0x1b, 0x40])); // init
  // Select code page 13 (PC857 / Turkish). Must come after init, which resets
  // the printer to its default page.
  parts.push(Buffer.from([0x1b, 0x74, 0x0d]));
  parts.push(Buffer.from([0x1b, 0x61, 0x01])); // center
  parts.push(Buffer.from([0x1d, 0x21, 0x11])); // double size
  parts.push(encodePc857(ticket.tableName + "\n"));
  parts.push(Buffer.from([0x1d, 0x21, 0x00])); // normal size
  parts.push(encodePc857(ticket.venueName + "\n"));
  parts.push(Buffer.from([0x1b, 0x61, 0x00])); // left
  parts.push(encodePc857(renderTicketText(ticket) + "\n\n"));
  parts.push(Buffer.from([0x1d, 0x56, 0x42, 0x03])); // partial cut
  return Buffer.concat(parts).toString("base64");
}
