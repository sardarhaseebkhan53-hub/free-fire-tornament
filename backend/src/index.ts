// API entrypoint — future Flutter/web clients consume the same REST surface.
import { createApp } from './app';
import { env } from './lib/env';
import { prisma } from './lib/prisma';
import { notifyUpcomingMatches } from './services/scheduler.service';

const app = createApp();

app.listen(env.PORT, '0.0.0.0', () => {
  console.log(`⚡ CLUTCHNEX API listening on :${env.PORT} (${env.NODE_ENV})`);
});

// ---------------------------------------------------------------------------
// Background reminder scheduler — every 30s, send "match starts in ~N min"
// notifications (each match is notified exactly once; see scheduler.service).
// Never started under vitest (the suites drive the tick function directly).
// ---------------------------------------------------------------------------
if (env.NODE_ENV !== 'test') {
  let ticking = false;
  setInterval(async () => {
    if (ticking) return;
    ticking = true;
    try {
      await notifyUpcomingMatches();
    } catch (e) {
      console.warn('[scheduler] match reminder tick failed:', (e as Error)?.message);
    } finally {
      ticking = false;
    }
  }, 30_000).unref();
}

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, async () => {
    console.log(`\n${signal} — shutting down…`);
    await prisma.$disconnect();
    process.exit(0);
  });
}
