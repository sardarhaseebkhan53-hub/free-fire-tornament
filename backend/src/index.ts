// API entrypoint — future Flutter/web clients consume the same REST surface.
import { createApp } from './app';
import { env } from './lib/env';
import { prisma } from './lib/prisma';
import { notifyUpcomingMatches } from './services/scheduler.service';
import { markNoShows } from './services/checkin.service';

const app = createApp();

app.listen(env.PORT, '0.0.0.0', () => {
  console.log(`⚡ CLUTCHNEX API listening on :${env.PORT} (${env.NODE_ENV})`);
});

// ---------------------------------------------------------------------------
// Background ticks — every 30s: (1) "match starts in ~N min" reminders, each match
// notified exactly once (scheduler.service), and (2) the check-in no-show pass
// (checkin.service), which stamps `noShowAt` once an event's window has shut.
//
// Both are guarded by their own atomic claims, so a doubled tick, a restart
// mid-flight, or two instances running the same minute cannot double-write anything.
// Never started under vitest (the suites drive the tick functions directly).
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
    }
    // Separate try: a reminder failure must not skip the attendance pass, or vice versa.
    try {
      const marked = await markNoShows();
      if (marked.marked > 0) console.log(`[scheduler] marked ${marked.marked} no-show(s) across ${marked.tournaments} event(s)`);
    } catch (e) {
      console.warn('[scheduler] no-show pass failed:', (e as Error)?.message);
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
