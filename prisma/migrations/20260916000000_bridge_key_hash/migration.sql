-- Bridge keys were stored in plaintext, so a database dump or a backup on a
-- shared drive handed out the credential that drains the kitchen outbox.
-- Only a SHA-256 is kept from here on; the plaintext is shown once at creation.
--
-- Existing keys are hashed in place, so agents already configured keep
-- working without being re-issued.

ALTER TABLE "BridgeKey" ADD COLUMN "keyHash" TEXT;
ALTER TABLE "BridgeKey" ADD COLUMN "hint" TEXT NOT NULL DEFAULT '';

UPDATE "BridgeKey"
SET "keyHash" = encode(sha256(convert_to("key", 'UTF8')), 'hex'),
    "hint" = right("key", 6);

ALTER TABLE "BridgeKey" ALTER COLUMN "keyHash" SET NOT NULL;

DROP INDEX IF EXISTS "BridgeKey_key_key";
ALTER TABLE "BridgeKey" DROP COLUMN "key";

CREATE UNIQUE INDEX "BridgeKey_keyHash_key" ON "BridgeKey"("keyHash");
