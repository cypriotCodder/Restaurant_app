-- Postgres creates an index for a PRIMARY KEY but not for a FOREIGN KEY, so
-- every relation these models are read through was a sequential scan. They are
-- all on the hot path: the desk board and every bill join order lines by order,
-- and the customer menu walks category -> item -> modifier group -> option on
-- each load.

-- CreateIndex
CREATE INDEX "Category_venueId_active_idx" ON "Category"("venueId", "active");

-- CreateIndex
CREATE INDEX "MenuItem_venueId_categoryId_idx" ON "MenuItem"("venueId", "categoryId");

-- CreateIndex
CREATE INDEX "ModifierGroup_itemId_idx" ON "ModifierGroup"("itemId");

-- CreateIndex
CREATE INDEX "ModifierOption_groupId_idx" ON "ModifierOption"("groupId");

-- CreateIndex
CREATE INDEX "TableSession_visitId_idx" ON "TableSession"("visitId");

-- CreateIndex
CREATE INDEX "TableSession_tableId_idx" ON "TableSession"("tableId");

-- CreateIndex
CREATE INDEX "Order_venueId_createdAt_idx" ON "Order"("venueId", "createdAt");

-- CreateIndex
CREATE INDEX "Order_sessionId_idx" ON "Order"("sessionId");

-- CreateIndex
CREATE INDEX "Order_tableId_idx" ON "Order"("tableId");

-- CreateIndex
CREATE INDEX "OrderItem_orderId_idx" ON "OrderItem"("orderId");

-- CreateIndex
CREATE INDEX "PosDelivery_orderId_idx" ON "PosDelivery"("orderId");
