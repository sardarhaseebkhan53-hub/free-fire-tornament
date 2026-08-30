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
// CREDENTIALS COME FROM THE ENVIRONMENT ONLY — never from source. Set:
//   SEED_ADMIN_EMAIL, SEED_ADMIN_PASSWORD, SEED_ADMIN_USERNAME
//
// In production SEED_ADMIN_PASSWORD is REQUIRED: without it this script skips
// (exit 0, so the deploy still boots) instead of baking a source-controlled
// password into the owner account. In development a throwaway default is used
// so a fresh clone is still one command away from an admin login.
// =============================================================================
import 'dotenv/config';
import bcrypt from 'bcryptjs';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../generated/prisma';

// --- Admin identity (environment-driven) -------------------------------------
const IS_PRODUCTION = process.env.NODE_ENV === 'production';
/** Dev-only fallback. Never used when NODE_ENV=production. */
const DEV_FALLBACK_PASSWORD = 'ChangeMe@Dev123';

const ADMIN_EMAIL = (process.env.SEED_ADMIN_EMAIL ?? 'admin@clutchnex.local').toLowerCase().trim();
const ADMIN_USERNAME = (process.env.SEED_ADMIN_USERNAME ?? 'clutchnexadmin').toLowerCase().trim();
const ADMIN_FULL_NAME = process.env.SEED_ADMIN_NAME ?? 'Platform Owner';
const ADMIN_PASSWORD = process.env.SEED_ADMIN_PASSWORD ?? (IS_PRODUCTION ? '' : DEV_FALLBACK_PASSWORD);

const BCRYPT_ROUNDS = 12; // matches the auth service's production cost

async function main() {
  const connectionString =
    process.env.DATABASE_URL ??
    'postgresql://postgres:postgres@127.0.0.1:5432/postgres?connection_limit=1';

  if (!ADMIN_PASSWORD) {
    // Production without an explicit password: do NOT invent one and do NOT
    // fail the deploy — an already-provisioned admin must keep working.
    console.warn(
      '⚠️  SEED_ADMIN_PASSWORD is not set — skipping the super-admin seed. ' +
        'Set SEED_ADMIN_EMAIL / SEED_ADMIN_PASSWORD to provision or reset the owner account.',
    );
    return;
  }
  if (ADMIN_PASSWORD.length < 12) {
    console.error('❌ SEED_ADMIN_PASSWORD must be at least 12 characters.');
    process.exitCode = 1;
    return;
  }

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
          profile: existing.profile ? undefined : { create: { fullName: ADMIN_FULL_NAME } },
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
          profile: { create: { fullName: ADMIN_FULL_NAME } },
          wallet: { create: {} },
        },
      });
      console.log(`✅ Super-admin created: ${ADMIN_EMAIL} (SUPER_ADMIN / ACTIVE)`);
      console.log(`   username: ${ADMIN_USERNAME}`);
    }

    console.log('   password: (from SEED_ADMIN_PASSWORD — never printed)');
    console.log('   Login: POST /api/auth/login { "identifier": "<email|username>", "password": "…" }');
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  console.error('❌ Admin seed failed:', e);
  process.exitCode = 1;
});
