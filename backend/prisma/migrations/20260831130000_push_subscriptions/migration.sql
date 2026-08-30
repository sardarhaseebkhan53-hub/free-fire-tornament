-- PHASE 19 — Web Push subscriptions (device endpoints), so time-critical events
-- (MATCH_STARTING, ROOM_CREDENTIALS) can reach a player whose tab is closed.
--
-- The table is a DEVICE list, not a user setting: one player can have a phone and a
-- laptop. `endpoint` is unique because that is what the push service hands out and
-- what a re-subscribe must not duplicate. `failCount` exists so a permanently failing
-- endpoint can be pruned instead of being hammered forever.
--
-- No money, no ledger, no entitlement lives here: losing every row only costs
-- delivery, which is exactly why writes to it are allowed to fail silently.
CREATE TABLE IF NOT EXISTS "push_subscriptions" (
  "id"         TEXT NOT NULL,
  "userId"     TEXT NOT NULL,
  "endpoint"   TEXT NOT NULL,
  "p256dh"     TEXT NOT NULL,
  "auth"       TEXT NOT NULL,
  "userAgent"  TEXT,
  "failCount"  INTEGER NOT NULL DEFAULT 0,
  "createdAt"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "push_subscriptions_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "push_subscriptions_endpoint_key" ON "push_subscriptions"("endpoint");
CREATE INDEX IF NOT EXISTS "push_subscriptions_userId_idx" ON "push_subscriptions"("userId");

ALTER TABLE "push_subscriptions"
  ADD CONSTRAINT "push_subscriptions_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
