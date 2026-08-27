-- Automatic account activation (spec §Account verification fix):
-- newly registered users are ACTIVE immediately — no admin approval needed.
-- Existing rows are untouched; only the column DEFAULT changes.
-- NOTE: account status and payment verification (deposits, admin-reviewed)
-- are separate systems — DepositStatus is not affected by this migration.
ALTER TABLE "users" ALTER COLUMN "status" SET DEFAULT 'ACTIVE';
