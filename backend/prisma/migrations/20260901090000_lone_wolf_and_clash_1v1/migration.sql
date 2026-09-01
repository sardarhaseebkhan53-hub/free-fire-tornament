-- Add Lone Wolf and Clash Squad 1v1 as playable tournament modes.
-- Both are 1-player-per-seat modes (like SOLO), so no new columns are needed;
-- the enum is the only schema change. The join engine treats teamSize === 1
-- modes automatically.

ALTER TYPE "TournamentType" ADD VALUE IF NOT EXISTS 'LONE_WOLF';
ALTER TYPE "TournamentType" ADD VALUE IF NOT EXISTS 'CLASH_SQUAD_1V1';
