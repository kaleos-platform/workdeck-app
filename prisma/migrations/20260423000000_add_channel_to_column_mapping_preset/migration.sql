-- Add channelId FK to DelColumnMappingPreset so a preset can carry a default 판매채널.
ALTER TABLE "DelColumnMappingPreset"
  ADD COLUMN "channelId" TEXT;

ALTER TABLE "DelColumnMappingPreset"
  ADD CONSTRAINT "DelColumnMappingPreset_channelId_fkey"
  FOREIGN KEY ("channelId") REFERENCES "Channel"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "DelColumnMappingPreset_channelId_idx"
  ON "DelColumnMappingPreset"("channelId");
