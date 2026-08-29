-- Optional client idempotency key for withdrawal retries. The composite
-- uniqueness remains compatible with existing NULL request IDs.
ALTER TABLE "withdrawals"
  ADD COLUMN "requestId" TEXT;

CREATE UNIQUE INDEX "withdrawals_userId_requestId_key"
  ON "withdrawals" ("userId", "requestId");
