// =============================================================================
// One-off backfill: recompute `tournaments.prizePool` from each tournament's
// prize rows.
//
// Why this exists
// ---------------
// `createTournament()` never wrote `prizePool`, and the column defaults to 0.
// Every tournament created before that fix therefore advertises "PKR 0" in the
// admin table and on the public cards, even though its TournamentPrize rows
// hold the real amounts. This script repairs those existing rows.
//
// Safety
// ------
//   • Idempotent — running it twice changes nothing the second time.
//   • Only touches rows whose stored pool actually differs from the computed
//     sum, so untouched tournaments keep their updatedAt.
//   • Never widens a pool that an admin deliberately set higher than the sum of
//     prizes unless --force is passed; by default it only fixes zeros.
//
// Usage
//   npx tsx prisma/backfill-prize-pool.ts           # dry run (prints a plan)
//   npx tsx prisma/backfill-prize-pool.ts --apply   # fix pools currently at 0
//   npx tsx prisma/backfill-prize-pool.ts --apply --force  # resync every row
// =============================================================================
import { Prisma } from '../generated/prisma';
import { prisma } from '../src/lib/prisma';

const APPLY = process.argv.includes('--apply');
const FORCE = process.argv.includes('--force');

async function main(): Promise<void> {
  const tournaments = await prisma.tournament.findMany({
    where: { deletedAt: null },
    select: {
      id: true,
      slug: true,
      title: true,
      prizePool: true,
      prizes: { select: { amount: true } },
    },
  });

  const planned: Array<{ slug: string; title: string; from: number; to: number }> = [];

  for (const t of tournaments) {
    const computed = t.prizes.reduce((sum, p) => sum + Number(p.amount), 0);
    const current = Number(t.prizePool);
    if (computed === current) continue;
    // Default mode repairs only the "never written" case (pool sitting at 0).
    // --force resyncs any drift.
    if (!FORCE && current !== 0) continue;
    planned.push({ slug: t.slug, title: t.title, from: current, to: computed });
  }

  if (planned.length === 0) {
    console.log('Nothing to backfill — every prize pool already matches its prizes.');
    return;
  }

  console.log(`${planned.length} tournament(s) ${APPLY ? 'will be' : 'would be'} updated:`);
  for (const p of planned) {
    console.log(`  ${p.slug.padEnd(34)} ${String(p.from).padStart(8)} -> ${p.to}  (${p.title})`);
  }

  if (!APPLY) {
    console.log('\nDry run. Re-run with --apply to write these changes.');
    return;
  }

  await prisma.$transaction(
    planned.map((p) =>
      prisma.tournament.update({
        where: { slug: p.slug },
        data: { prizePool: new Prisma.Decimal(p.to) },
      }),
    ),
  );
  console.log(`\nDone — ${planned.length} prize pool(s) repaired.`);
}

main()
  .catch((e) => {
    console.error('Backfill failed:', e);
    process.exitCode = 1;
  })
  .finally(() => void prisma.$disconnect());
