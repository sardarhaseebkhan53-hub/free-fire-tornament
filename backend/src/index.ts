// API entrypoint — future Flutter/web clients consume the same REST surface.
import { createApp } from './app';
import { env } from './lib/env';
import { prisma } from './lib/prisma';

const app = createApp();

app.listen(env.PORT, '0.0.0.0', () => {
  console.log(`⚡ CLUTCHNEX API listening on :${env.PORT} (${env.NODE_ENV})`);
});

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, async () => {
    console.log(`\n${signal} — shutting down…`);
    await prisma.$disconnect();
    process.exit(0);
  });
}
