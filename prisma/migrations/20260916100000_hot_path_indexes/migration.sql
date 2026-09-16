-- Prisma does not create indexes for foreign keys on Postgres, and orders are
-- never pruned, so the joins and range scans every screen relies on were
-- heading for sequential scans as the venue's history grew.

CREATE INDEX "TableSession_tableId_idx" ON "TableSession"("tableId");
CREATE INDEX "Order_venueId_createdAt_idx" ON "Order"("venueId", "createdAt");
CREATE INDEX "Order_tableId_status_idx" ON "Order"("tableId", "status");
CREATE INDEX "OrderItem_orderId_idx" ON "OrderItem"("orderId");
CREATE INDEX "PosDelivery_orderId_idx" ON "PosDelivery"("orderId");
CREATE INDEX "MenuItem_categoryId_idx" ON "MenuItem"("categoryId");
