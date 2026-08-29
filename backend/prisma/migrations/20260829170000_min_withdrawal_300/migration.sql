-- Raise the default minimum withdrawal to PKR 300 and make sure it is present
-- in every environment (seed + existing databases).
--
-- Existing deployments that already have the old 100 PKR minimum get the new
-- value immediately. Admins can still change it from System Settings.

INSERT INTO "settings" ("id", "key", "value", "description", "updatedAt", "createdAt")
VALUES (
  md5('wallet.minWithdrawal'), 'wallet.minWithdrawal', '300'::jsonb,
  'Minimum withdrawal (PKR)', now(), now()
)
ON CONFLICT ("key") DO UPDATE SET
  "value" = '300'::jsonb,
  "updatedAt" = now();
