-- Desk-side order corrections.
--
-- Lines are voided rather than deleted, so the record of what was originally
-- ordered survives the correction; and every edit is attributed, because an
-- edit after the kitchen ticket printed leaves the kitchen holding paper that
-- no longer matches.

ALTER TABLE "OrderItem" ADD COLUMN "voidedAt" TIMESTAMP(3);

CREATE TABLE "OrderEdit" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "staffId" TEXT NOT NULL,
    "staffName" TEXT NOT NULL,
    "changesJson" TEXT NOT NULL,
    "afterPrint" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "OrderEdit_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "OrderEdit_orderId_idx" ON "OrderEdit"("orderId");

ALTER TABLE "OrderEdit" ADD CONSTRAINT "OrderEdit_orderId_fkey"
    FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;
