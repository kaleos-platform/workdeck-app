-- Add labelColumns JSON array to DelShippingMethod.
-- Stores which fields (DelFieldMapping keys) are active as "배송 라벨" columns for this method (max 3).
-- Default empty array keeps existing methods with no label columns selected.

ALTER TABLE "DelShippingMethod"
  ADD COLUMN "labelColumns" JSONB NOT NULL DEFAULT '[]'::jsonb;
