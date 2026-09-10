-- Staff sessions are stateless 12h JWTs, so until now a dismissed employee kept
-- desk/admin access for up to 12 hours. `tokenVersion` is embedded in the token
-- and re-checked on every request; bumping it invalidates all existing tokens
-- for that account. `active` is the deactivation switch.
ALTER TABLE "StaffUser" ADD COLUMN "active" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "StaffUser" ADD COLUMN "tokenVersion" INTEGER NOT NULL DEFAULT 0;
