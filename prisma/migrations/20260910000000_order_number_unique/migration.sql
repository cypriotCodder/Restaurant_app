-- Per-venue ticket numbers must be unique. Concurrent inserts previously
-- derived `number` from max(number)+1 under READ COMMITTED and could both
-- land on the same value, printing duplicate kitchen tickets.
--
-- Renumber any existing duplicates first (keeping creation order) so the
-- index can be created on live data.
WITH ranked AS (
  SELECT id,
         "venueId",
         ROW_NUMBER() OVER (PARTITION BY "venueId" ORDER BY "createdAt", id) AS rn
  FROM "Order"
),
dupes AS (
  SELECT "venueId" FROM "Order" GROUP BY "venueId", "number" HAVING COUNT(*) > 1
)
UPDATE "Order" o
SET "number" = r.rn
FROM ranked r
WHERE o.id = r.id
  AND o."venueId" IN (SELECT "venueId" FROM dupes);

CREATE UNIQUE INDEX "Order_venueId_number_key" ON "Order"("venueId", "number");
