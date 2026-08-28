/* eslint-disable no-console */
// =============================================================================
// CLUTCHNEX — permanent super-admin seed (PRODUCTION-SAFE, idempotent)
//
//   npm run db:seed:admin
//
// Unlike prisma/seed.ts (development demo data — truncates tables and REFUSES
// to run in production), this script exists to guarantee that the platform
// owner can always log in:
//
//   • It NEVER deletes or overwrites anything except the admin's own row.
//   • It is safe to run on every deploy — Railway does exactly that
//     (railway.yaml: db:migrate → db:seed:admin → npm start).
//   • It always re-bakes the password hash from the PERMANENT credentials
//     below / SEED_ADMIN_*, so changing .env can never desync the stored hash
//     (the classic "login fails after .env update" bcrypt mismatch).
//
// PERMANENT credentials (also the defaults in .env.example — do not casually
// rotate; if you ever must, change them here AND in the environment together):
//   email     sardarghaseeb777@gmail.com
//   password  sardar9003202@
//   username  sardarghaseeb
// =============================================================================
import 'dotenv/config';
import bcrypt from 'bcryptjs';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../generated/prisma';

// --- PERMANENT admin identity ------------------------------------------------
const ADMIN_EMAIL = (process.env.SEED_ADMIN_EMAIL ?? 'sardarghaseeb777@gmail.com').toLowerCase().trim();
const ADMIN_PASSWORD = process.env.SEED_ADMIN_PASSWORD ?? 'sardar9003202@';
const ADMIN_USERNAME = (process.env.SEED_ADMIN_USERNAME ?? 'sardarghaseeb').toLowerCase().trim();

const BCRYPT_ROUNDS = 12; // matches the auth service's production cost

async function main() {
  const connectionString =
    process.env.DATABASE_URL ??
    'postgresql://postgres:postgres@127.0.0.1:5432/postgres?connection_limit=1';
  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });

  try {
    const passwordHash = bcrypt.hashSync(ADMIN_PASSWORD, BCRYPT_ROUNDS);

    const existing = await prisma.user.findUnique({
      where: { email: ADMIN_EMAIL },
      include: { profile: true, wallet: true },
    });

    if (existing) {
      // The username is permanent for this admin, but never steal it from
      // another account — warn loudly instead.
      const usernameHolder = await prisma.user.findUnique({ where: { username: ADMIN_USERNAME } });
      const usernameFree = !usernameHolder || usernameHolder.id === existing.id;

      await prisma.user.update({
        where: { id: existing.id },
        data: {
          ...(usernameFree ? { username: ADMIN_USERNAME } : {}),
          passwordHash, // ALWAYS resynced — hash drift after .env edits ends here
          role: 'SUPER_ADMIN',
          status: 'ACTIVE',
          isVerified: true,
          verifiedAt: existing.verifiedAt ?? new Date(),
          bannedAt: null,
          banReason: null,
          profile: existing.profile ? undefined : { create: { fullName: 'Sardar Ghaseeb' } },
          wallet: existing.wallet ? undefined : { create: {} },
        },
      });

      console.log(`✅ Super-admin ensured: ${ADMIN_EMAIL} (SUPER_ADMIN / ACTIVE)`);
      console.log(`   username: ${usernameFree ? ADMIN_USERNAME : `${ADMIN_USERNAME} (taken by another account — login with the email)`}`);
      if (existing.status === 'BANNED' || existing.status === 'SUSPENDED') {
        console.log('   note: account was BANNED/SUSPENDED and has been restored to ACTIVE.');
      }
    } else {
      const usernameHolder = await prisma.user.findUnique({ where: { username: ADMIN_USERNAME } });
      if (usernameHolder) {
        console.error(
          `❌ Cannot create the super-admin: username "${ADMIN_USERNAME}" is held by ` +
            `${usernameHolder.email}. Free it up (or change SEED_ADMIN_USERNAME) and re-run.`,
        );
        process.exitCode = 1;
        return;
      }

      await prisma.user.create({
        data: {
          username: ADMIN_USERNAME,
          email: ADMIN_EMAIL,
          passwordHash,
          role: 'SUPER_ADMIN',
          status: 'ACTIVE',
          isVerified: true,
          verifiedAt: new Date(),
          profile: { create: { fullName: 'Sardar Ghaseeb' } },
          wallet: { create: {} },
        },
      });
      console.log(`✅ Super-admin created: ${ADMIN_EMAIL} (SUPER_ADMIN / ACTIVE)`);
      console.log(`   username: ${ADMIN_USERNAME}`);
    }

    console.log('   password: (from SEED_ADMIN_PASSWORD — permanent credentials)');
    console.log('   Login: POST /api/auth/login { "identifier": "<email|username>", "password": "…" }');
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  console.error('❌ Admin seed failed:', e);
  process.exitCode = 1;
});
