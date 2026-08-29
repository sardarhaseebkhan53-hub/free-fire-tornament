-- Preserve the original debit/entry ledger reference when a later reversal
-- or refund is posted. These nullable columns are additive and safe for all
-- existing deposits, withdrawals, registrations, and ledger rows.
ALTER TABLE "withdrawals"
  ADD COLUMN "reversalWalletTxId" TEXT;

ALTER TABLE "tournament_registrations"
  ADD COLUMN "refundWalletTxId" TEXT;
