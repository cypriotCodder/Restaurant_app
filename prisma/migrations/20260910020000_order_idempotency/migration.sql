-- Per-submission idempotency key, so a double-tapped "Submit Order" on a slow
-- connection cannot place the same order twice.
--
-- NULLs are distinct in a Postgres unique index, so orders placed before this
-- migration (and any future client that omits the key) are unaffected.
ALTER TABLE "Order" ADD COLUMN "idempotencyKey" TEXT;

CREATE UNIQUE INDEX "Order_sessionId_idempotencyKey_key"
  ON "Order"("sessionId", "idempotencyKey");
