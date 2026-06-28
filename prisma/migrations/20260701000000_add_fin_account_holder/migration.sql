-- Add nullable account holder name for finance account management.
ALTER TABLE "FinAccount" ADD COLUMN "holder" TEXT;
