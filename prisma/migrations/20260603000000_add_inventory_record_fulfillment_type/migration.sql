-- Add fulfillmentType (판매방식: 로켓그로스 | 판매자배송) to InventoryRecord for VENDOR_ITEM_METRICS rows
ALTER TABLE "InventoryRecord" ADD COLUMN "fulfillmentType" TEXT;
