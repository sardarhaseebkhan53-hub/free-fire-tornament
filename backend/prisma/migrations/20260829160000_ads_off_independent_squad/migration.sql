-- Ads + independent SQUAD registration settings.
--
-- 1. Gate public ads behind an admin-controlled master switch. It ships OFF so
--    the public site is ad-free by default; the admin panel can re-enable it.
-- 2. Allow SQUAD / Clash Squad players to register without a team and be paired
--    by an admin later (mirrors the existing independent-DUO path).
-- 3. Deactivate every existing advertisement so a deployed database also stops
--    showing ads immediately, while keeping the rows/admin controls intact.

INSERT INTO "settings" ("id", "key", "value", "description", "updatedAt", "createdAt")
VALUES (
  md5('tournament.allowIndependentSquad'), 'tournament.allowIndependentSquad', 'false'::jsonb,
  'Allow players to register SQUAD / Clash Squad without a team and get paired later by admin',
  now(), now()
)
ON CONFLICT ("key") DO NOTHING;

INSERT INTO "settings" ("id", "key", "value", "description", "updatedAt", "createdAt")
VALUES (
  md5('ads.enabled'), 'ads.enabled', 'false'::jsonb,
  'Show admin-managed advertisements across the public site (off by default)',
  now(), now()
)
ON CONFLICT ("key") DO NOTHING;

UPDATE "advertisements" SET "isActive" = false WHERE "isActive" = true;
