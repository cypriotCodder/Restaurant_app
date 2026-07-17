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
 * Raw ESC/POS byte stream (base64) for network thermal printers (port 9100)
 * — the same printers an AKINSOFT install already prints kitchen tickets to.
 */
export function renderEscPos(ticket: Ticket): string {
  const enc = (s: string) => Buffer.from(s.replaceAll("₺", "TL"), "ascii");
  const parts: Buffer[] = [];
  parts.push(Buffer.from([0x1b, 0x40])); // init
  parts.push(Buffer.from([0x1b, 0x61, 0x01])); // center
  parts.push(Buffer.from([0x1d, 0x21, 0x11])); // double size
  parts.push(enc(ticket.tableName + "\n"));
  parts.push(Buffer.from([0x1d, 0x21, 0x00])); // normal size
  parts.push(enc(ticket.venueName + "\n"));
  parts.push(Buffer.from([0x1b, 0x61, 0x00])); // left
  parts.push(enc(renderTicketText(ticket) + "\n\n"));
  parts.push(Buffer.from([0x1d, 0x56, 0x42, 0x03])); // partial cut
  return Buffer.concat(parts).toString("base64");
}
