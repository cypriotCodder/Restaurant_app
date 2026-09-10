-- Track pull-based POS delivery claims so a crashed bridge agent cannot strand
-- a ticket in "claimed" forever, silently stopping the kitchen from printing.
ALTER TABLE "PosDelivery" ADD COLUMN "claimedAt" TIMESTAMP(3);
ALTER TABLE "PosDelivery" ADD COLUMN "claimId" TEXT;

CREATE INDEX "PosDelivery_status_claimedAt_idx" ON "PosDelivery"("status", "claimedAt");

-- Rows already sitting in "claimed" from before this migration have no claim
-- timestamp and would otherwise never be swept. Release them back to pending;
-- worst case a ticket prints twice, which is far better than never printing.
UPDATE "PosDelivery" SET "status" = 'pending' WHERE "status" = 'claimed';
