// The swappable POS boundary. The app's own order flow (customer → backend →
// desk dashboard) is fully standalone; adapters are async outputs fed from
// the PosDelivery outbox and can fail without affecting the critical path.

export type TicketLine = {
  qty: number;
  name: string;
  modifiers: string[];
  note: string;
  unitPriceKurus: number;
};

export type Ticket = {
  venueName: string;
  /** ISO code; the printed total is rendered in it. */
  currency: string;
  tableName: string;
  orderNumber: number;
  createdAt: Date;
  lines: TicketLine[];
  totalKurus: number;
  /**
   * Present when staff corrected an order that had already been sent to the
   * kitchen. The ticket is then printed as an amendment: the kitchen already
   * holds paper for this order, so a second unmarked ticket would risk the
   * dish being cooked twice.
   */
  amendment?: {
    changes: { name: string; fromQty: number; toQty: number }[];
    byStaff: string;
  };
};

export interface PosAdapter {
  readonly name: string;
  /** Render the outbox payload persisted at enqueue time. */
  renderPayload(ticket: Ticket): string;
  /**
   * Push a pending delivery toward the POS world. Pull-based adapters
   * (escpos_bridge) leave the row "pending" for the on-prem agent to claim.
   */
  deliver(payload: string, ticket: Ticket): Promise<{ done: boolean; error?: string }>;
}
