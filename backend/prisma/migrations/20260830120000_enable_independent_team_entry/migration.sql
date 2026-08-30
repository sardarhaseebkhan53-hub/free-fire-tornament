-- Final release registration policy: allow verified individual players to enter
-- DUO/SQUAD/CLASH_SQUAD events without an existing team. Staff pair these
-- free-agent registrations before match start; full team registration remains
-- available and is still the preferred path when a captain has an eligible team.
INSERT INTO "settings" ("id", "key", "value", "description", "updatedAt", "createdAt")
VALUES
  (md5('tournament.allowIndependentDuo'), 'tournament.allowIndependentDuo', 'true'::jsonb,
   'Allow players to register DUO without a team and get paired later by admin', now(), now()),
  (md5('tournament.allowIndependentSquad'), 'tournament.allowIndependentSquad', 'true'::jsonb,
   'Allow players to register SQUAD / Clash Squad without a team and get paired later by admin', now(), now())
ON CONFLICT ("key") DO UPDATE
SET "value" = EXCLUDED."value",
    "description" = EXCLUDED."description",
    "updatedAt" = now();
