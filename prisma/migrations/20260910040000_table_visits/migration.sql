-- A party's stay at a table: the unit a bill covers.
--
-- A table seats several phones, each with its own TableSession, so a bill
-- cannot be scoped per session. TableVisit groups every session and order
-- belonging to one party, and is what staff settle at the till.

CREATE TABLE "TableVisit" (
    "id" TEXT NOT NULL,
    "venueId" TEXT NOT NULL,
    "tableId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'open',
    "openedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "billRequestedAt" TIMESTAMP(3),
    "closedAt" TIMESTAMP(3),
    "closedReason" TEXT,
    "totalKurus" INTEGER,
    "paymentMethod" TEXT,
    "paidAmountKurus" INTEGER,
    "closedByStaffId" TEXT,
    CONSTRAINT "TableVisit_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "TableVisit_tableId_status_idx" ON "TableVisit"("tableId", "status");
CREATE INDEX "TableVisit_venueId_status_idx" ON "TableVisit"("venueId", "status");

ALTER TABLE "TableVisit" ADD CONSTRAINT "TableVisit_venueId_fkey"
    FOREIGN KEY ("venueId") REFERENCES "Venue"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "TableVisit" ADD CONSTRAINT "TableVisit_tableId_fkey"
    FOREIGN KEY ("tableId") REFERENCES "Table"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Nullable on both sides: rows created before visits existed keep working, and
-- are simply not part of any bill.
ALTER TABLE "TableSession" ADD COLUMN "visitId" TEXT;
ALTER TABLE "Order" ADD COLUMN "visitId" TEXT;

CREATE INDEX "Order_visitId_idx" ON "Order"("visitId");

ALTER TABLE "TableSession" ADD CONSTRAINT "TableSession_visitId_fkey"
    FOREIGN KEY ("visitId") REFERENCES "TableVisit"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Order" ADD CONSTRAINT "Order_visitId_fkey"
    FOREIGN KEY ("visitId") REFERENCES "TableVisit"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Adopt any table that currently has live sessions into an open visit, so a
-- party mid-meal when this deploys can still be billed rather than being
-- stranded with orders that belong to no visit.
INSERT INTO "TableVisit" ("id", "venueId", "tableId", "status", "openedAt")
SELECT
    'visit_migrated_' || t."id",
    t."venueId",
    t."id",
    'open',
    COALESCE(MIN(s."createdAt"), CURRENT_TIMESTAMP)
FROM "Table" t
JOIN "TableSession" s ON s."tableId" = t."id"
WHERE s."revokedAt" IS NULL AND s."expiresAt" > CURRENT_TIMESTAMP
GROUP BY t."id", t."venueId";

UPDATE "TableSession" s
SET "visitId" = v."id"
FROM "TableVisit" v
WHERE v."tableId" = s."tableId"
  AND v."status" = 'open'
  AND s."revokedAt" IS NULL
  AND s."expiresAt" > CURRENT_TIMESTAMP;

UPDATE "Order" o
SET "visitId" = s."visitId"
FROM "TableSession" s
WHERE s."id" = o."sessionId"
  AND s."visitId" IS NOT NULL
  AND o."status" NOT IN ('served', 'rejected');
