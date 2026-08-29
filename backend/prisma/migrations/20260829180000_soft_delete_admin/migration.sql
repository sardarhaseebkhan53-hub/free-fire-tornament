-- Admin soft-delete / archive for users, tournaments and matches.
-- Deleted rows keep every wallet/ledger/winner record so financial history is
-- never destroyed; they are simply hidden from admin lists and public surfaces.

ALTER TABLE "users" ADD COLUMN "deletedAt" TIMESTAMP(3);
ALTER TABLE "tournaments" ADD COLUMN "deletedAt" TIMESTAMP(3);
ALTER TABLE "matches" ADD COLUMN "deletedAt" TIMESTAMP(3);

CREATE INDEX "users_deletedAt_idx" ON "users"("deletedAt");
CREATE INDEX "tournaments_deletedAt_idx" ON "tournaments"("deletedAt");
CREATE INDEX "matches_deletedAt_idx" ON "matches"("deletedAt");
