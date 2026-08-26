-- Platform expenses for gross-vs-net accounting (spec §22/§23).
-- Refunds, promotions and referral costs are derived from the wallet ledger;
-- payment costs, operational costs and taxes are admin-recorded here.
CREATE TABLE "expenses" (
    "id" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "note" TEXT,
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "expenses_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "expenses_category_occurredAt_idx" ON "expenses"("category", "occurredAt");
