-- Notifications + referral rewards expansion:
-- 1. ReferralReward: allow ONE reward PER QUALIFYING ACTION per referred user
--    (first login + first approved deposit are separate rewards), instead of
--    a single row per referred user. Existing rows keep their action value.
-- 2. Match.startNotifiedAt: one-time flag for the "starts in ~5 minutes"
--    reminder scheduler so restarts never double-notify.
DROP INDEX "referral_rewards_referredUserId_key";
CREATE UNIQUE INDEX "referral_rewards_referredUserId_qualifyingAction_key"
  ON "referral_rewards"("referredUserId", "qualifyingAction");
ALTER TABLE "matches" ADD COLUMN "startNotifiedAt" TIMESTAMP(3);
