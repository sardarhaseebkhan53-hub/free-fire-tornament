/* eslint-disable no-console */
// =============================================================================
// CLUTCHNEX — development seed (Phase 2)
//
// Creates a believable demo universe: staff accounts, players, wallets with a
// fully consistent immutable ledger, tournaments in every lifecycle state,
// teams, matches, results, winners with prize crediting, manual deposits and
// withdrawals in every review state, coupons, referrals, tickets, blog, pages,
// settings and audit logs.
//
//   ⚠️  DEVELOPMENT ONLY — never run against production.
//   All financial figures are PKR (the admin-configurable default currency).
// =============================================================================
import 'dotenv/config';
import bcrypt from 'bcryptjs';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient, Prisma } from '../generated/prisma';

if (process.env.NODE_ENV === 'production') {
  throw new Error('Refusing to seed in production (NODE_ENV=production).');
}

const connectionString =
  process.env.DATABASE_URL ??
  'postgresql://postgres:postgres@127.0.0.1:5432/postgres?connection_limit=1';

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });

// ---------------------------------------------------------------------------
// Time helpers (relative so demo data always looks alive)
// ---------------------------------------------------------------------------
const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const NOW = Date.now();
const inHours = (h: number) => new Date(NOW + h * HOUR);
const daysAgo = (d: number) => new Date(NOW - d * DAY);
const hoursAgo = (h: number) => new Date(NOW - h * HOUR);

// ---------------------------------------------------------------------------
// In-memory wallet mirror — guarantees ledger consistency by construction.
// ---------------------------------------------------------------------------
type Bucket = 'CASH' | 'COINS' | 'WINNING' | 'BONUS';
type Direction = 'CREDIT' | 'DEBIT';
const balances = new Map<string, Record<Bucket, number>>();

function walletOf(userId: string): Record<Bucket, number> {
  if (!balances.has(userId)) {
    balances.set(userId, { CASH: 0, COINS: 0, WINNING: 0, BONUS: 0 });
  }
  return balances.get(userId)!;
}

async function ledger(
  userId: string,
  bucket: Bucket,
  direction: Direction,
  amount: number,
  type:
    | 'DEPOSIT' | 'ENTRY_FEE' | 'ENTRY_REFUND' | 'WINNING' | 'WITHDRAWAL'
    | 'WITHDRAWAL_REVERSAL' | 'BONUS_CREDIT' | 'BONUS_DEBIT' | 'REFERRAL_REWARD'
    | 'COIN_CONVERSION' | 'ADMIN_CREDIT' | 'ADMIN_DEBIT',
  meta: {
    entityType?: string;
    entityId?: string;
    reference?: string;
    description?: string;
    createdById?: string;
  } = {},
) {
  const b = walletOf(userId);
  const before = b[bucket];
  const after = direction === 'CREDIT' ? before + amount : before - amount;
  if (after < -0.001) {
    throw new Error(`Ledger overdraw blocked: user=${userId} ${bucket} ${before} - ${amount}`);
  }
  b[bucket] = Math.round(after * 100) / 100;
  return prisma.walletTransaction.create({
    data: {
      userId,
      bucket,
      type,
      direction,
      amount,
      currency: 'PKR',
      balanceBefore: before,
      balanceAfter: b[bucket],
      entityType: meta.entityType,
      entityId: meta.entityId,
      reference: meta.reference,
      description: meta.description,
      createdById: meta.createdById,
    },
  });
}

async function flushWallets() {
  for (const [userId, b] of balances) {
    await prisma.wallet.update({
      where: { userId },
      data: {
        cashBalance: new Prisma.Decimal(b.CASH),
        coinBalance: new Prisma.Decimal(b.COINS),
        winningBalance: new Prisma.Decimal(b.WINNING),
        bonusBalance: new Prisma.Decimal(b.BONUS),
      },
    });
  }
}

// ---------------------------------------------------------------------------
// Player stats accumulator for completed events
// ---------------------------------------------------------------------------
type StatAcc = { matches: number; wins: number; kills: number; points: number; earnings: number; last: Date };
const stats = new Map<string, StatAcc>();
function stat(userId: string): StatAcc {
  if (!stats.has(userId)) {
    stats.set(userId, { matches: 0, wins: 0, kills: 0, points: 0, earnings: 0, last: daysAgo(2) });
  }
  return stats.get(userId)!;
}

// ---------------------------------------------------------------------------
// Wipe (TRUNCATE CASCADE handles FK ordering in one statement)
// ---------------------------------------------------------------------------
async function wipe() {
  const tables = [
    'expenses', 'fraud_alerts', 'audit_logs', 'player_stats', 'seo_configs', 'advertisements',
    'payment_accounts', 'settings', 'faqs', 'static_pages', 'blog_posts',
    'notifications', 'disputes', 'support_messages', 'support_tickets',
    'coupon_redemptions', 'coupons', 'referral_rewards', 'winners', 'prizes',
    'result_submissions', 'match_participants', 'matches', 'team_invites',
    'team_members', 'teams', 'tournament_registrations', 'tournaments',
    'withdrawals', 'deposits', 'wallet_transactions', 'wallets', 'auth_tokens',
    'user_profiles', 'users',
  ].map((t) => `"${t}"`).join(', ');
  await prisma.$executeRawUnsafe(`TRUNCATE ${tables} CASCADE`);
}

// ===========================================================================
async function main() {
  console.log('🌱 CLUTCHNEX seed — development data (PKR). Wiping existing rows…');
  await wipe();

  // -------------------------------------------------------------------------
  // 1. Platform settings (admin-configurable, never hard-coded in code)
  // -------------------------------------------------------------------------
  const settings: Array<[string, unknown, string]> = [
    ['platform.name', 'CLUTCHNEX', 'Public platform name'],
    ['platform.tagline', 'COMPETE. CLUTCH. CONQUER.', 'Brand tagline'],
    ['platform.currency', 'PKR', 'Default currency code'],
    ['platform.currencySymbol', 'Rs', 'Currency display symbol'],
    ['platform.whatsappNumber', '+923001234567', 'WhatsApp support destination (configurable)'],
    ['platform.supportEmail', 'support@clutchnex.gg', 'Support email'],
    ['platform.maintenanceMode', false, 'Maintenance mode switch'],
    ['platform.maintenanceMessage', 'The arena is upgrading. Back soon.', 'Maintenance banner text'],
    ['platform.registrationOpen', true, 'Allow new registrations'],
    ['wallet.minDeposit', 100, 'Minimum manual deposit (PKR)'],
    ['wallet.maxDeposit', 25000, 'Maximum manual deposit (PKR)'],
    ['wallet.minWithdrawal', 100, 'Minimum withdrawal (PKR)'],
    ['wallet.coinConversionRate', 1, 'Tournament credits per 1 PKR deposited'],
    ['wallet.welcomeBonus', 100, 'One-time bonus for new verified players (PKR)'],
    ['wallet.depositBonusPercent', 0, 'Bonus credits (coins) as % of every approved deposit'],
    ['wallet.withdrawalFeePercent', 0, 'Withdrawal processing fee (%)'],
    ['payments.processingTimeHours', 24, 'Advertised manual-payment review window'],
    ['tournament.defaultPointsPerKill', 1, 'Default points awarded per kill'],
    ['tournament.defaultRefundPercent', 100, 'Refund percentage when a tournament is cancelled'],
    ['tournament.registrationCutoffMinutes', 30, 'Registration closes N minutes before start'],
    ['tournament.roomCredentialsReleaseMinutesBeforeStart', 30, 'Room ID/password unlock window'],
    ['referral.loginReward', 20, 'Referrer bonus (PKR) when a referred player first signs in'],
    ['referral.firstDepositReward', 30, 'Referrer bonus (PKR) when a referred player\u2019s first deposit is approved'],
    ['tournament.startReminderMinutes', 5, 'Minutes before match start to send the reminder notification'],
    ['referral.maxRewardsPerUser', 50, 'Anti-abuse cap per referrer'],
    ['security.maxLoginAttempts', 5, 'Failed logins before temporary lockout'],
    ['security.lockoutMinutes', 15, 'Lockout duration'],
    // Phase 14 — security hardening (all admin-tunable at runtime)
    ['security.fraudDetectionEnabled', true, 'Master switch for automatic fraud alerts'],
    ['security.credentialStuffingThreshold', 5, 'Failed logins before a credential-stuffing alert'],
    ['security.maxUploadDimension', 4096, 'Maximum screenshot side in pixels (upload validation)'],
    ['security.minUploadDimension', 32, 'Minimum screenshot side in pixels (blocks 1x1 fakes)'],
    ['security.maxUploadsPerUserPerDay', 50, 'Per-player daily upload quota'],
    ['security.maxDepositsPerHour', 5, 'Deposit submissions per player per hour before an alert'],
    ['security.depositBurstWindowHours', 1, 'Window for the deposit-burst rule'],
    ['security.unusualDepositMultiplier', 5, 'Deposit N x the player average raises an alert'],
    ['security.maxWithdrawalsPerDay', 3, 'Withdrawal requests per player per day before an alert'],
    ['security.withdrawalChurnHours', 24, 'Deposit-then-withdraw window treated as churn'],
    ['security.newAccountWithdrawalDays', 1, 'Accounts younger than this cashing out raise an alert'],
    ['security.maxRegistrationsPerIpPerDay', 3, 'Registrations per IP before a multi-account alert'],
    ['security.registrationBurstWindowHours', 24, 'Window for the multi-account rule'],
    ['security.maxJoinFailuresPerHour', 10, 'Rejected joins per hour before an alert'],
    ['security.joinFailureWindowHours', 1, 'Window for the rejected-join rule'],
    ['security.maxCouponFailuresPerHour', 8, 'Invalid coupon attempts per hour before an alert'],
    ['security.couponAbuseWindowHours', 1, 'Window for the coupon-guessing rule'],
    ['seo.defaultTitle', 'CLUTCHNEX — Free Fire Tournaments in Pakistan', 'Default SEO title'],
    ['seo.defaultDescription', 'Join competitive Free Fire tournaments, compete with skilled players, and win rewards.', 'Default SEO description'],
    ['pricing.defaultKillRule', 'CAP', 'Kill-pool overflow rule: CAP | PRO_RATA | STOP_AT_CAP (shown in tournament rules)'],
    ['pricing.lossWarningThreshold', 0, 'Publish warning when estimated profit falls below this (PKR); admin must confirm losses explicitly'],
    // CLUTCHNEX master pricing table — default launch tiers. Admin-editable in
    // the tournament builder; never hard-coded in application code.
    ['pricing.tiers', [
      { key: 'SOLO_STARTER', type: 'SOLO', tier: 'STARTER', entryPerPlayer: 20, slots: 48, collection: 960, playerRewards: 700, platformGross: 260, prizes: [{ label: '1st', amount: 300 }, { label: '2nd', amount: 200 }, { label: '3rd', amount: 100 }, { label: 'KILL_POOL', amount: 100 }] },
      { key: 'SOLO_STANDARD', type: 'SOLO', tier: 'STANDARD', entryPerPlayer: 50, slots: 48, collection: 2400, playerRewards: 1800, platformGross: 600, prizes: [{ label: '1st', amount: 650 }, { label: '2nd', amount: 400 }, { label: '3rd', amount: 250 }, { label: 'KILL_POOL', amount: 400, perKill: 10 }, { label: 'MVP', amount: 100 }] },
      { key: 'SOLO_ELITE', type: 'SOLO', tier: 'ELITE', entryPerPlayer: 100, slots: 48, collection: 4800, playerRewards: 3600, platformGross: 1200, prizes: [{ label: '1st', amount: 1600 }, { label: '2nd', amount: 900 }, { label: '3rd', amount: 500 }, { label: 'KILL_POOL', amount: 500, perKill: 10 }, { label: 'MVP', amount: 100 }] },
      { key: 'DUO_STANDARD', type: 'DUO', tier: 'STANDARD', entryPerPlayer: 25, slots: 25, collection: 1250, playerRewards: 900, platformGross: 350, prizes: [{ label: '1st', amount: 450 }, { label: '2nd', amount: 275 }, { label: '3rd', amount: 175 }] },
      { key: 'DUO_ELITE', type: 'DUO', tier: 'ELITE', entryPerPlayer: 50, slots: 25, collection: 2500, playerRewards: 1900, platformGross: 600, prizes: [{ label: '1st', amount: 950 }, { label: '2nd', amount: 550 }, { label: '3rd', amount: 400 }] },
      { key: 'SQUAD_STANDARD', type: 'SQUAD', tier: 'STANDARD', entryPerPlayer: 50, slots: 12, collection: 2400, playerRewards: 1800, platformGross: 600, prizes: [{ label: '1st', amount: 900 }, { label: '2nd', amount: 550 }, { label: '3rd', amount: 350 }] },
      { key: 'SQUAD_ELITE', type: 'SQUAD', tier: 'ELITE', entryPerPlayer: 100, slots: 12, collection: 4800, playerRewards: 3800, platformGross: 1000, prizes: [{ label: '1st', amount: 1900 }, { label: '2nd', amount: 1150 }, { label: '3rd', amount: 750 }] },
      { key: 'CLASH_STANDARD', type: 'CLASH_SQUAD', tier: 'STANDARD', entryPerPlayer: 50, slots: 2, collection: 400, playerRewards: 300, platformGross: 100, prizes: [{ label: 'WINNING_SQUAD', amount: 250 }, { label: 'MVP', amount: 50 }] },
      { key: 'CLASH_ELITE', type: 'CLASH_SQUAD', tier: 'ELITE', entryPerPlayer: 100, slots: 2, collection: 800, playerRewards: 600, platformGross: 200, prizes: [{ label: 'WINNING_SQUAD', amount: 500 }, { label: 'MVP', amount: 100 }] },
    ], 'Master pricing table (default launch tiers) — Starter/Standard/Pro/Elite/Custom configurable'],
  ];
  for (const [key, value, description] of settings) {
    await prisma.setting.create({ data: { key, value: value as never, description } });
  }

  // -------------------------------------------------------------------------
  // 2. Manual payment destinations shown on the Add Money page
  // -------------------------------------------------------------------------
  await prisma.paymentAccount.createMany({
    data: [
      {
        method: 'JAZZCASH', label: 'JazzCash — 0300 1234567', accountName: 'CLUTCHNEX LTD',
        accountNumber: '03001234567', displayOrder: 1,
        instructions: 'Send the exact amount via JazzCash, then submit the transaction ID (TID) and a screenshot of the confirmation SMS.',
      },
      {
        method: 'EASYPAISA', label: 'EasyPaisa — 0345 7654321', accountName: 'CLUTCHNEX LTD',
        accountNumber: '03457654321', displayOrder: 2,
        instructions: 'Send the exact amount via EasyPaisa, then submit the transaction ID and a screenshot of the receipt.',
      },
      {
        method: 'BANK_TRANSFER', label: 'Meezan Bank — CLUTCHNEX LTD', accountName: 'CLUTCHNEX LTD',
        accountNumber: 'PK36MEZN0001234567890123', displayOrder: 3,
        extra: { bank: 'Meezan Bank', branch: 'Blue Area, Islamabad' },
        instructions: 'IBAN transfer only. Use your CLUTCHNEX username as the transfer reference.',
      },
    ],
  });

  // -------------------------------------------------------------------------
  // 3. Staff accounts
  // -------------------------------------------------------------------------
  const ADMIN_PASSWORD = process.env.SEED_ADMIN_PASSWORD ?? 'ChangeMe-Admin123';
  const superAdmin = await prisma.user.create({
    data: {
      username: process.env.SEED_ADMIN_USERNAME ?? 'clutchadmin',
      email: process.env.SEED_ADMIN_EMAIL ?? 'admin@clutchnex.gg',
      passwordHash: bcrypt.hashSync(ADMIN_PASSWORD, 10),
      role: 'SUPER_ADMIN', status: 'ACTIVE', isVerified: true, verifiedAt: daysAgo(60),
      referralCode: 'CLUTCH-ROOT01', lastLoginAt: hoursAgo(3),
      profile: { create: { fullName: 'Clutch Admin', country: 'Pakistan', city: 'Islamabad' } },
      wallet: { create: {} },
    },
  });
  const admin = await prisma.user.create({
    data: {
      username: 'nexaops', email: 'ops@clutchnex.gg',
      passwordHash: bcrypt.hashSync('OpsAdmin@123', 10),
      role: 'ADMIN', status: 'ACTIVE', isVerified: true, verifiedAt: daysAgo(55),
      referralCode: 'CLUTCH-OPS002', lastLoginAt: hoursAgo(7),
      profile: { create: { fullName: 'Ops Admin', country: 'Pakistan', city: 'Lahore' } },
      wallet: { create: {} },
    },
  });
  const moderator = await prisma.user.create({
    data: {
      username: 'modrex', email: 'mod@clutchnex.gg',
      passwordHash: bcrypt.hashSync('ModPass@123', 10),
      role: 'MODERATOR', status: 'ACTIVE', isVerified: true, verifiedAt: daysAgo(40),
      referralCode: 'CLUTCH-MOD003', lastLoginAt: hoursAgo(20),
      profile: { create: { fullName: 'Rex Moderator', country: 'Pakistan', city: 'Karachi' } },
      wallet: { create: {} },
    },
  });

  // -------------------------------------------------------------------------
  // 4. Players
  // -------------------------------------------------------------------------
  const playerSeed = [
    { u: 'areeb_ff', name: 'Areeb Khan', email: 'areeb.khan@example.com', phone: '+923001112201', ffUID: '5231879640', ign: 'AreebOP', city: 'Islamabad', deposit: 2000, bonus: 100, code: 'CLUTCH-AR7X2', referredBy: null },
    { u: 'hamza_sniper', name: 'Hamza Iqbal', email: 'hamza.iqbal@example.com', phone: '+923001112202', ffUID: '5840219375', ign: 'HamzaSnipes', city: 'Lahore', deposit: 1000, bonus: 100, code: 'CLUTCH-HZ9K4', referredBy: 'areeb_ff' },
    { u: 'fatima_noor', name: 'Fatima Noor', email: 'fatima.noor@example.com', phone: '+923001112203', ffUID: '6123948570', ign: 'FatimaFF', city: 'Karachi', deposit: 1500, bonus: 100, code: 'CLUTCH-FN3M8', referredBy: 'areeb_ff' },
    { u: 'bilal_rush', name: 'Bilal Ahmed', email: 'bilal.ahmed@example.com', phone: '+923001112204', ffUID: '5519283746', ign: 'BilalRush', city: 'Rawalpindi', deposit: 800, bonus: 100, code: 'CLUTCH-BL5T1', referredBy: 'hamza_sniper' },
    { u: 'zoya_headshot', name: 'Zoya Malik', email: 'zoya.malik@example.com', phone: '+923001112205', ffUID: '6637485920', ign: 'ZoyaHS', city: 'Faisalabad', deposit: 2000, bonus: 0, code: 'CLUTCH-ZY2P7', referredBy: null },
    { u: 'usman_t', name: 'Usman Tariq', email: 'usman.tariq@example.com', phone: '+923001112206', ffUID: '5948372615', ign: 'UsmanT', city: 'Multan', deposit: 500, bonus: 0, code: 'CLUTCH-UT8V3', referredBy: null },
    { u: 'ayesha_ace', name: 'Ayesha Siddiqui', email: 'ayesha.s@example.com', phone: '+923001112207', ffUID: '6284715930', ign: 'AyeshaAce', city: 'Hyderabad', deposit: 1200, bonus: 0, code: 'CLUTCH-AY6R9', referredBy: null },
    { u: 'danish_mvp', name: 'Danish Ali', email: 'danish.ali@example.com', phone: '+923001112208', ffUID: '5182739465', ign: 'DanishMVP', city: 'Peshawar', deposit: 600, bonus: 0, code: 'CLUTCH-DN4Q6', referredBy: null },
    { u: 'mahnoor_q', name: 'Mahnoor Baig', email: 'mahnoor.baig@example.com', phone: '+923001112209', ffUID: '6392857410', ign: 'MahnoorQ', city: 'Quetta', deposit: 3000, bonus: 0, code: 'CLUTCH-MH7J2', referredBy: null },
    { u: 'saad_clutch', name: 'Saad Qureshi', email: 'saad.q@example.com', phone: '+923001112210', ffUID: '5738291640', ign: 'SaadClutch', city: 'Sialkot', deposit: 900, bonus: 0, code: 'CLUTCH-SD1W5', referredBy: null },
    { u: 'ali_phantom', name: 'Ali Raza', email: 'ali.raza@example.com', phone: '+923001112211', ffUID: '6847592013', ign: 'AliPhantom', city: 'Gujranwala', deposit: 400, bonus: 0, code: 'CLUTCH-AL9E4', referredBy: null },
    { u: 'irene_viper', name: 'Iqra Javed', email: 'iqra.javed@example.com', phone: '+923001112212', ffUID: '6159384720', ign: 'IqraViper', city: 'Abbottabad', deposit: 700, bonus: 0, code: 'CLUTCH-IQ3B8', referredBy: null },
  ];

  const players: Record<string, { id: string; username: string }> = {};
  for (const p of playerSeed) {
    const referredBy = p.referredBy ? players[p.referredBy]?.id : undefined;
    const user = await prisma.user.create({
      data: {
        username: p.u, email: p.email, phone: p.phone,
        passwordHash: bcrypt.hashSync('Player@123', 10),
        role: 'USER', status: 'ACTIVE', isVerified: true, verifiedAt: daysAgo(30),
        referralCode: p.code, referredById: referredBy,
        createdAt: daysAgo(30), lastLoginAt: hoursAgo(6),
        profile: {
          create: {
            fullName: p.name, country: 'Pakistan', city: p.city,
            freeFireUID: p.ffUID, freeFireIGN: p.ign,
            bio: 'Free Fire competitive player on CLUTCHNEX.',
          },
        },
        wallet: { create: {} },
      },
    });
    players[p.u] = { id: user.id, username: p.u };
    walletOf(user.id);
  }
  const P = (u: string): string => {
    const p = players[u];
    if (!p) throw new Error(`seed: unknown player '${u}'`);
    return p.id;
  };

  // -------------------------------------------------------------------------
  // 5. Approved deposits → ledger DEPOSIT credits (+ welcome bonus)
  // -------------------------------------------------------------------------
  const depositTids: Record<string, string> = {
    areeb_ff: 'JC8492017365', hamza_sniper: 'EP7364920185', fatima_noor: 'JC9183746250',
    bilal_rush: 'JC5274839106', zoya_headshot: 'EP6382910475', usman_t: 'JC4192837465',
    ayesha_ace: 'EP8574639201', danish_mvp: 'JC3948571620', mahnoor_q: 'BT-2026082011',
    saad_clutch: 'JC7463920185', ali_phantom: 'EP2938475610', irene_viper: 'JC6172839405',
  };
  for (const p of playerSeed) {
    const uid = P(p.u);
    const tid = depositTids[p.u];
    if (!tid) throw new Error(`seed: missing TID for ${p.u}`);
    const dep = await prisma.deposit.create({
      data: {
        userId: uid, amount: p.deposit, method: p.phone.includes('345') || ['hamza_sniper', 'zoya_headshot', 'usman_t', 'ayesha_ace', 'ali_phantom'].includes(p.u) ? 'EASYPAISA' : 'JAZZCASH',
        transactionId: tid,
        screenshot: `/uploads/deposits/${p.u}-receipt.png`,
        senderName: p.name, senderAccount: p.phone,
        status: 'APPROVED', adminNote: 'Verified against sender account',
        reviewedById: admin.id, reviewedAt: daysAgo(25),
        createdAt: daysAgo(26),
      },
    });
    const tx = await ledger(uid, 'CASH', 'CREDIT', p.deposit, 'DEPOSIT', {
      entityType: 'Deposit', entityId: dep.id, reference: depositTids[p.u],
      description: `Manual ${dep.method === 'EASYPAISA' ? 'EasyPaisa' : 'JazzCash'} deposit approved`,
    });
    await prisma.deposit.update({ where: { id: dep.id }, data: { walletTxId: tx.id } });
    if (p.bonus > 0) {
      await ledger(uid, 'BONUS', 'CREDIT', p.bonus, 'BONUS_CREDIT', {
        description: 'Welcome bonus',
      });
    }
  }

  // Fresh pending deposits for the admin queue + one rejection
  await prisma.deposit.create({
    data: {
      userId: P('irene_viper'), amount: 1500, method: 'EASYPAISA',
      transactionId: 'EP9920183746', screenshot: '/uploads/deposits/irene_viper-pending.png',
      senderName: 'Iqra Javed', senderAccount: '+923001112212', status: 'PENDING',
      createdAt: hoursAgo(2),
    },
  });
  await prisma.deposit.create({
    data: {
      userId: P('ali_phantom'), amount: 750, method: 'JAZZCASH',
      transactionId: 'JC1029384756', screenshot: '/uploads/deposits/ali_phantom-pending.png',
      senderName: 'Ali Raza', senderAccount: '+923001112211', status: 'PENDING',
      createdAt: hoursAgo(5),
    },
  });
  await prisma.deposit.create({
    data: {
      userId: P('usman_t'), amount: 2000, method: 'JAZZCASH',
      transactionId: 'JC0000000001', screenshot: '/uploads/deposits/usman_t-rejected.png',
      senderName: 'Usman Tariq', senderAccount: '+923001112206', status: 'REJECTED',
      adminNote: 'Screenshot does not match the stated amount. Please re-submit with the original SMS.',
      reviewedById: admin.id, reviewedAt: daysAgo(3), createdAt: daysAgo(4),
    },
  });

  // -------------------------------------------------------------------------
  // 6. Teams
  // -------------------------------------------------------------------------
  const teamSeed = [
    { name: 'Hyderabad Hawks', tag: 'HHK', captain: 'areeb_ff', type: 'SQUAD' as const, members: ['areeb_ff', 'hamza_sniper', 'fatima_noor', 'bilal_rush'] },
    { name: 'Lahore Legends', tag: 'LGL', captain: 'zoya_headshot', type: 'SQUAD' as const, members: ['zoya_headshot', 'usman_t', 'ayesha_ace', 'danish_mvp'] },
    { name: 'Karachi Kings FF', tag: 'KKF', captain: 'mahnoor_q', type: 'SQUAD' as const, members: ['mahnoor_q', 'saad_clutch', 'ali_phantom', 'irene_viper'] },
    { name: 'Ghost Duo', tag: 'GHD', captain: 'areeb_ff', type: 'DUO' as const, members: ['areeb_ff', 'hamza_sniper'] },
    { name: 'Desi Snipers', tag: 'DSN', captain: 'zoya_headshot', type: 'DUO' as const, members: ['zoya_headshot', 'usman_t'] },
  ];
  const teams: Record<string, string> = {};
  // resolved after creation
  const T = (tag: string): string => {
    const t = teams[tag];
    if (!t) throw new Error(`seed: unknown team '${tag}'`);
    return t;
  };
  for (const t of teamSeed) {
    const team = await prisma.team.create({
      data: {
        name: t.name, tag: t.tag, captainId: P(t.captain), type: t.type, createdAt: daysAgo(20),
        members: {
          create: t.members.map((m) => ({ userId: P(m), role: m === t.captain ? 'CAPTAIN' as const : 'MEMBER' as const, joinedAt: daysAgo(19) })),
        },
      },
    });
    teams[t.tag] = team.id;
  }
  await prisma.teamInvite.create({
    data: {
      teamId: T('KKF'), inviteeId: P('danish_mvp'), invitedById: P('mahnoor_q'),
      status: 'PENDING', message: 'We need a fifth for scrims — join KKF!', createdAt: hoursAgo(30),
    },
  });

  // -------------------------------------------------------------------------
  // 7. Tournaments (every lifecycle state, PKR economics — all configurable)
  // -------------------------------------------------------------------------
  const RULES_COMMON = [
    '• Emulator play is not allowed — mobile devices only.',
    '• Room ID and password are released 30 minutes before start inside My Matches.',
    '• Screenshots of the final scoreboard are required for result verification.',
    '• Hacks, scripts, teaming or impersonation lead to permanent BAN and forfeiture.',
    '• Admin decisions on disputes are final.',
  ].join('\n');

  const tournaments = {
    soloDone: await prisma.tournament.create({
      data: {
        title: 'Friday Night Clash — Solo Showdown #8', slug: 'friday-night-clash-solo-8',
        description: 'Weekly solo battle royale on Bermuda. Fast paced, one map, one winner takes the crown.',
        type: 'SOLO', map: 'Bermuda', status: 'COMPLETED', banner: '/uploads/banners/solo-showdown.jpg',
        entryFeePerPlayer: 50, prizePool: 400, platformFee: 100, maxSlots: 48, registeredSlots: 10,
        minSlotsToStart: 8, numWinners: 3, pointsPerKill: 1,
        startTime: daysAgo(2), registrationDeadline: new Date(daysAgo(2).getTime() - 30 * 60000), endTime: daysAgo(2),
        rules: RULES_COMMON, createdAt: daysAgo(9),
        prizes: { create: [ { position: 1, amount: 200, label: '1st Place', kind: 'PLACEMENT' }, { position: 2, amount: 120, label: '2nd Place', kind: 'PLACEMENT' }, { position: 3, amount: 80, label: '3rd Place', kind: 'PLACEMENT' } ] },
      },
    }),
    squadDone: await prisma.tournament.create({
      data: {
        title: 'Bermuda Royale Monthly — August', slug: 'bermuda-royale-monthly-august',
        description: 'The flagship monthly squad championship. Four-player squads fight for the monthly title and the biggest prize pool of August.',
        type: 'SQUAD', map: 'Bermuda', status: 'COMPLETED', banner: '/uploads/banners/bermuda-royale.jpg',
        entryFeePerPlayer: 50, prizePool: 480, platformFee: 120, maxSlots: 12, registeredSlots: 3,
        minSlotsToStart: 2, numWinners: 3, pointsPerKill: 1, isFeatured: false,
        startTime: daysAgo(5), registrationDeadline: new Date(daysAgo(5).getTime() - 30 * 60000), endTime: daysAgo(5),
        rules: RULES_COMMON, createdAt: daysAgo(18),
        prizes: { create: [ { position: 1, amount: 260, label: '1st Place', kind: 'PLACEMENT' }, { position: 2, amount: 140, label: '2nd Place', kind: 'PLACEMENT' }, { position: 3, amount: 80, label: '3rd Place', kind: 'PLACEMENT' } ] },
      },
    }),
    squadOpen: await prisma.tournament.create({
      data: {
        title: 'Karachi Squad Cup Vol. 3', slug: 'karachi-squad-cup-vol-3',
        description: 'High-stakes squad cup with a verified prize pool. Bring your best four.',
        type: 'SQUAD', map: 'Purgatory', status: 'REGISTRATION_OPEN', banner: '/uploads/banners/karachi-squad-cup.jpg',
        entryFeePerPlayer: 50, prizePool: 300, platformFee: 100, maxSlots: 24, registeredSlots: 2,
        minSlotsToStart: 6, numWinners: 3, pointsPerKill: 1, isFeatured: true,
        startTime: inHours(48), registrationDeadline: inHours(42),
        rules: RULES_COMMON, createdAt: daysAgo(6),
        prizes: { create: [ { position: 1, amount: 160, label: '1st Place', kind: 'PLACEMENT' }, { position: 2, amount: 90, label: '2nd Place', kind: 'PLACEMENT' }, { position: 3, amount: 50, label: '3rd Place', kind: 'PLACEMENT' } ] },
      },
    }),
    duoOpen: await prisma.tournament.create({
      data: {
        title: 'Duo Dominators Weekly #14', slug: 'duo-dominators-weekly-14',
        description: 'Two-player weekly duel on Kalahari. Quick rounds, tight zones.',
        type: 'DUO', map: 'Kalahari', status: 'REGISTRATION_OPEN', banner: '/uploads/banners/duo-dominators.jpg',
        entryFeePerPlayer: 25, prizePool: 75, platformFee: 25, maxSlots: 24, registeredSlots: 2,
        minSlotsToStart: 4, numWinners: 2, pointsPerKill: 1,
        startTime: inHours(26), registrationDeadline: inHours(24),
        rules: RULES_COMMON, createdAt: daysAgo(4),
        prizes: { create: [ { position: 1, amount: 45, label: '1st Place', kind: 'PLACEMENT' }, { position: 2, amount: 30, label: '2nd Place', kind: 'PLACEMENT' } ] },
      },
    }),
    csOpen: await prisma.tournament.create({
      data: {
        title: 'Clash Squad Rumble #12', slug: 'clash-squad-rumble-12',
        description: 'Best-of-3 Clash Squad duel. Two squads enter, one squad clutches.',
        type: 'CLASH_SQUAD', map: 'Bermuda (CS)', status: 'REGISTRATION_OPEN', banner: '/uploads/banners/cs-rumble.jpg',
        entryFeePerPlayer: 50, prizePool: 160, platformFee: 40, maxSlots: 2, registeredSlots: 1,
        minSlotsToStart: 2, numWinners: 1, pointsPerKill: 1, isFeatured: true,
        startTime: inHours(5), registrationDeadline: inHours(4),
        rules: RULES_COMMON, createdAt: daysAgo(2),
        prizes: { create: [ { position: 1, amount: 160, label: 'Winner Takes All', kind: 'PLACEMENT' } ] },
      },
    }),
    cancelled: await prisma.tournament.create({
      data: {
        title: 'Purgatory Solo Rush', slug: 'purgatory-solo-rush',
        description: 'Cancelled: minimum player count was not reached. All entries refunded 100%.',
        type: 'SOLO', map: 'Purgatory', status: 'CANCELLED', banner: '/uploads/banners/purgatory-rush.jpg',
        entryFeePerPlayer: 100, prizePool: 400, platformFee: 100, maxSlots: 48, registeredSlots: 0,
        numWinners: 3, refundPercent: 100,
        startTime: daysAgo(1), registrationDeadline: daysAgo(1),
        rules: RULES_COMMON, createdAt: daysAgo(8),
      },
    }),
    draft: await prisma.tournament.create({
      data: {
        title: 'Winter Championship Qualifier', slug: 'winter-championship-qualifier',
        description: 'Draft — publish after prize pool approval.',
        type: 'SQUAD', map: 'Alpine', status: 'DRAFT',
        entryFeePerPlayer: 75, prizePool: 5000, platformFee: 1500, maxSlots: 48, registeredSlots: 0,
        numWinners: 3, startTime: inHours(24 * 21), registrationDeadline: inHours(24 * 20),
        rules: RULES_COMMON, createdAt: hoursAgo(20),
      },
    }),
  };

  // -------------------------------------------------------------------------
  // 8. Registrations + entry-fee ledger debits
  // -------------------------------------------------------------------------
  async function register(t: { id: string }, userId: string, entry: number, teamId?: string, discount = 0, couponId?: string) {
    const reg = await prisma.tournamentRegistration.create({
      data: { tournamentId: t.id, userId, teamId, entryAmount: entry, discount, couponId, registeredAt: daysAgo(3) },
    });
    const tx = await ledger(userId, 'CASH', 'DEBIT', entry, 'ENTRY_FEE', {
      entityType: 'TournamentRegistration', entityId: reg.id,
      description: 'Tournament entry fee',
    });
    await prisma.tournamentRegistration.update({ where: { id: reg.id }, data: { walletTxId: tx.id } });
    return reg;
  }

  // T1 solo — 10 players
  for (const u of ['areeb_ff', 'hamza_sniper', 'fatima_noor', 'bilal_rush', 'zoya_headshot', 'usman_t', 'ayesha_ace', 'danish_mvp', 'saad_clutch', 'ali_phantom']) {
    await register(tournaments.soloDone, P(u), 50);
  }
  // T2 squad — 3 full squads
  for (const squad of [['areeb_ff', 'hamza_sniper', 'fatima_noor', 'bilal_rush'], ['zoya_headshot', 'usman_t', 'ayesha_ace', 'danish_mvp'], ['mahnoor_q', 'saad_clutch', 'ali_phantom', 'irene_viper']]) {
    const tag = squad[0] === 'areeb_ff' ? 'HHK' : squad[0] === 'zoya_headshot' ? 'LGL' : 'KKF';
    for (const u of squad) await register(tournaments.squadDone, P(u), 50, T(tag));
  }
  // T3 upcoming squad — HHK + LGL
  for (const u of ['areeb_ff', 'hamza_sniper', 'fatima_noor', 'bilal_rush']) await register(tournaments.squadOpen, P(u), 50, T('HHK'));
  for (const u of ['zoya_headshot', 'usman_t', 'ayesha_ace', 'danish_mvp']) await register(tournaments.squadOpen, P(u), 50, T('LGL'));
  // T4 duo — coupon WELCOME50 gives Ghost Duo 50% off one player entry
  const couponWelcome = await prisma.coupon.create({
    data: { code: 'WELCOME50', type: 'PERCENTAGE', value: 50, maxDiscount: 100, usageLimit: 100, usedCount: 1, appliesTo: ['DUO'], expiresAt: inHours(24 * 30) },
  });
  const couponClutch = await prisma.coupon.create({
    data: { code: 'CLUTCH10', type: 'PERCENTAGE', value: 10, maxDiscount: 50, usageLimit: 500, usedCount: 0, appliesTo: [], expiresAt: inHours(24 * 60) },
  });
  await prisma.coupon.create({
    data: { code: 'LAUNCH50', type: 'FIXED', value: 50, usageLimit: 200, usedCount: 200, status: 'EXPIRED', expiresAt: daysAgo(10) },
  });
  await register(tournaments.duoOpen, P('areeb_ff'), 25, T('GHD'), 25, couponWelcome.id);
  await register(tournaments.duoOpen, P('hamza_sniper'), 25, T('GHD'));
  await register(tournaments.duoOpen, P('zoya_headshot'), 25, T('DSN'));
  await register(tournaments.duoOpen, P('usman_t'), 25, T('DSN'));
  await prisma.couponRedemption.create({
    data: { couponId: couponWelcome.id, userId: P('areeb_ff'), discountAmount: 25 },
  });
  // T5 clash squad — KKF
  for (const u of ['mahnoor_q', 'saad_clutch', 'ali_phantom', 'irene_viper']) await register(tournaments.csOpen, P(u), 50, T('KKF'));
  // T6 cancelled — refunds
  for (const u of ['usman_t', 'ayesha_ace', 'danish_mvp', 'saad_clutch', 'irene_viper']) {
    const reg = await register(tournaments.cancelled, P(u), 100);
    await ledger(P(u), 'CASH', 'CREDIT', 100, 'ENTRY_REFUND', {
      entityType: 'TournamentRegistration', entityId: reg.id,
      description: 'Refund — tournament cancelled before minimum players',
    });
    await prisma.tournamentRegistration.update({ where: { id: reg.id }, data: { status: 'REFUNDED', cancelledAt: daysAgo(1) } });
  }

  // -------------------------------------------------------------------------
  // 9. Matches, participants, results
  // -------------------------------------------------------------------------
  const PLACEMENT_POINTS = [12, 9, 8, 7, 6, 5, 4, 3, 2, 1];

  // T1 final — solo
  const t1Match = await prisma.match.create({
    data: {
      tournamentId: tournaments.soloDone.id, round: 1, matchNumber: 1, map: 'Bermuda',
      scheduledAt: daysAgo(2), status: 'COMPLETED', roomId: '5219834', roomPassword: 'CNX842',
      credentialsReleaseAt: new Date(daysAgo(2).getTime() - 30 * 60000),
      credentialsReleasedAt: new Date(daysAgo(2).getTime() - 30 * 60000),
      resultsFinalized: true, createdAt: daysAgo(8),
    },
  });
  const t1Order: Array<[string, number]> = [
    ['fatima_noor', 11], ['areeb_ff', 8], ['ayesha_ace', 9], ['zoya_headshot', 6],
    ['hamza_sniper', 5], ['danish_mvp', 4], ['usman_t', 3], ['saad_clutch', 4],
    ['bilal_rush', 2], ['ali_phantom', 1],
  ];
  for (let i = 0; i < t1Order.length; i++) {
    const entry = t1Order[i];
    if (!entry) continue;
    const [u, kills] = entry;
    const pp = PLACEMENT_POINTS[i] ?? 0;
    const placement = i + 1;
    await prisma.matchParticipant.create({
      data: {
        matchId: t1Match.id, userId: P(u), placement, kills,
        points: pp + kills, status: 'PLAYED',
      },
    });
    const s = stat(P(u));
    s.matches += 1; s.kills += kills; s.points += pp + kills;
    if (placement === 1) s.wins += 1;
    s.last = daysAgo(2);
  }
  // Result submissions for the podium + one under review
  for (const [u, placement] of [['fatima_noor', 1], ['areeb_ff', 2], ['ayesha_ace', 3]] as Array<[string, number]>) {
    await prisma.resultSubmission.create({
      data: {
        matchId: t1Match.id, submittedById: P(u),
        screenshot: `/uploads/results/t1-${u}.png`, kills: placement === 1 ? 11 : placement === 2 ? 8 : 9,
        placement, notes: 'Final scoreboard attached.', status: 'VERIFIED',
        verifiedById: moderator.id, verifiedAt: daysAgo(2), createdAt: daysAgo(2),
      },
    });
  }
  await prisma.resultSubmission.create({
    data: {
      matchId: t1Match.id, submittedById: P('zoya_headshot'),
      screenshot: '/uploads/results/t1-zoya.png', kills: 6, placement: 4,
      notes: 'Requesting placement re-check — zone closed early on our push.', status: 'UNDER_REVIEW', createdAt: daysAgo(2),
    },
  });

  // T2 final — squads
  const t2Match = await prisma.match.create({
    data: {
      tournamentId: tournaments.squadDone.id, round: 1, matchNumber: 1, map: 'Bermuda',
      scheduledAt: daysAgo(5), status: 'COMPLETED', roomId: '5830291', roomPassword: 'CNX217',
      credentialsReleaseAt: new Date(daysAgo(5).getTime() - 30 * 60000),
      credentialsReleasedAt: new Date(daysAgo(5).getTime() - 30 * 60000),
      resultsFinalized: true, createdAt: daysAgo(17),
    },
  });
  const t2Order: Array<[string, string[], number]> = [
    ['HHK', ['areeb_ff', 'hamza_sniper', 'fatima_noor', 'bilal_rush'], 9],
    ['LGL', ['zoya_headshot', 'usman_t', 'ayesha_ace', 'danish_mvp'], 7],
    ['KKF', ['mahnoor_q', 'saad_clutch', 'ali_phantom', 'irene_viper'], 5],
  ];
  for (let i = 0; i < t2Order.length; i++) {
    const entry = t2Order[i];
    if (!entry) continue;
    const [tag, members, kills] = entry;
    const pp = PLACEMENT_POINTS[i] ?? 0;
    const placement = i + 1;
    await prisma.matchParticipant.create({
      data: { matchId: t2Match.id, teamId: T(tag), placement, kills, points: pp + kills, status: 'PLAYED' },
    });
    for (const m of members) {
      const s = stat(P(m));
      s.matches += 1; s.kills += Math.round(kills / 4); s.points += pp + kills;
      if (placement === 1) s.wins += 1;
      s.last = daysAgo(5);
    }
  }
  await prisma.resultSubmission.create({
    data: {
      matchId: t2Match.id, submittedById: P('areeb_ff'),
      screenshot: '/uploads/results/t2-hhk.png', kills: 9, placement: 1,
      notes: 'Booyah! Full scoreboard attached.', status: 'VERIFIED',
      verifiedById: admin.id, verifiedAt: daysAgo(5), createdAt: daysAgo(5),
    },
  });

  // Upcoming matches (credentials hidden until release time)
  await prisma.match.create({
    data: {
      tournamentId: tournaments.squadOpen.id, round: 1, matchNumber: 1, map: 'Purgatory',
      scheduledAt: inHours(48), status: 'SCHEDULED', roomId: '6120483', roomPassword: 'CNX553',
      credentialsReleaseAt: new Date(inHours(48).getTime() - 30 * 60000), createdAt: daysAgo(6),
    },
  });
  await prisma.match.create({
    data: {
      tournamentId: tournaments.duoOpen.id, round: 1, matchNumber: 1, map: 'Kalahari',
      scheduledAt: inHours(26), status: 'SCHEDULED', roomId: '6249105', roomPassword: 'CNX318',
      credentialsReleaseAt: new Date(inHours(26).getTime() - 30 * 60000), createdAt: daysAgo(4),
    },
  });
  await prisma.match.create({
    data: {
      tournamentId: tournaments.csOpen.id, round: 1, matchNumber: 1, map: 'Bermuda (CS)',
      scheduledAt: inHours(5), status: 'SCHEDULED', roomId: '6372019', roomPassword: 'CNX902',
      credentialsReleaseAt: inHours(3), createdAt: daysAgo(2),
    },
  });

  // -------------------------------------------------------------------------
  // 10. Winners + prize crediting (immutable ledger, audited)
  // -------------------------------------------------------------------------
  // T1 solo podium
  const t1Podium: Array<[string, number, number]> = [['fatima_noor', 1, 200], ['areeb_ff', 2, 120], ['ayesha_ace', 3, 80]];
  for (const [u, position, amount] of t1Podium) {
    const winner = await prisma.winner.create({
      data: { tournamentId: tournaments.soloDone.id, position, userId: P(u), amount, status: 'CREDITED', creditedAt: daysAgo(2) },
    });
    const tx = await ledger(P(u), 'WINNING', 'CREDIT', amount, 'WINNING', {
      entityType: 'Winner', entityId: winner.id,
      description: `Prize — ${position === 1 ? '1st' : position === 2 ? '2nd' : '3rd'} place, Friday Night Clash #8`,
    });
    await prisma.winner.update({ where: { id: winner.id }, data: { walletTxId: tx.id } });
    stat(P(u)).earnings += amount;
  }
  // T2 squad podium (team total split equally across members)
  const t2Podium: Array<[string, string[], number, number]> = [
    ['HHK', ['areeb_ff', 'hamza_sniper', 'fatima_noor', 'bilal_rush'], 1, 260],
    ['LGL', ['zoya_headshot', 'usman_t', 'ayesha_ace', 'danish_mvp'], 2, 140],
    ['KKF', ['mahnoor_q', 'saad_clutch', 'ali_phantom', 'irene_viper'], 3, 80],
  ];
  for (const [tag, members, position, total] of t2Podium) {
    const winner = await prisma.winner.create({
      data: { tournamentId: tournaments.squadDone.id, position, teamId: T(tag), amount: total, status: 'CREDITED', creditedAt: daysAgo(5) },
    });
    const share = total / members.length;
    for (const m of members) {
      const tx = await ledger(P(m), 'WINNING', 'CREDIT', share, 'WINNING', {
        entityType: 'Winner', entityId: winner.id,
        description: `Prize share — ${position === 1 ? '1st' : position === 2 ? '2nd' : '3rd'} place, Bermuda Royale August`,
      });
      stat(P(m)).earnings += share;
      if (m === members[0]) await prisma.winner.update({ where: { id: winner.id }, data: { walletTxId: tx.id } });
    }
  }

  // -------------------------------------------------------------------------
  // 11. Withdrawals (every state) + admin balance adjustment (audited)
  // -------------------------------------------------------------------------
  const w1 = await prisma.withdrawal.create({
    data: {
      userId: P('areeb_ff'), amount: 100, method: 'JAZZCASH',
      accountName: 'Areeb Khan', accountNumber: '03001112201', status: 'PENDING', createdAt: hoursAgo(8),
    },
  });
  await ledger(P('areeb_ff'), 'WINNING', 'DEBIT', 100, 'WITHDRAWAL', {
    entityType: 'Withdrawal', entityId: w1.id, description: 'Withdrawal request (pending review)',
  });
  const w2 = await prisma.withdrawal.create({
    data: {
      userId: P('fatima_noor'), amount: 150, method: 'EASYPAISA',
      accountName: 'Fatima Noor', accountNumber: '03451112203', status: 'PROCESSING',
      adminNote: 'Approved — batch payout scheduled', reviewedById: admin.id, reviewedAt: hoursAgo(12), createdAt: daysAgo(1),
    },
  });
  const w2tx = await ledger(P('fatima_noor'), 'WINNING', 'DEBIT', 150, 'WITHDRAWAL', {
    entityType: 'Withdrawal', entityId: w2.id, description: 'Withdrawal request (approved)',
  });
  await prisma.withdrawal.update({ where: { id: w2.id }, data: { walletTxId: w2tx.id } });
  const w3 = await prisma.withdrawal.create({
    data: {
      userId: P('zoya_headshot'), amount: 35, method: 'BANK_TRANSFER',
      accountName: 'Zoya Malik', accountNumber: 'PK12MEZN0009876543210987',
      accountDetails: 'Meezan Bank — Faisalabad', status: 'REJECTED',
      adminNote: 'Account title does not match the verified profile. Re-submit with a matching account.',
      reviewedById: admin.id, reviewedAt: daysAgo(1), createdAt: daysAgo(2),
    },
  });
  await ledger(P('zoya_headshot'), 'WINNING', 'DEBIT', 35, 'WITHDRAWAL', {
    entityType: 'Withdrawal', entityId: w3.id, description: 'Withdrawal request',
  });
  await ledger(P('zoya_headshot'), 'WINNING', 'CREDIT', 35, 'WITHDRAWAL_REVERSAL', {
    entityType: 'Withdrawal', entityId: w3.id, description: 'Withdrawal rejected — funds returned',
  });

  // Audited admin goodwill credit
  const adjTx = await ledger(P('mahnoor_q'), 'CASH', 'CREDIT', 500, 'ADMIN_CREDIT', {
    description: 'Goodwill credit — match server issue during scrim (ticket #TK-1042)',
    createdById: superAdmin.id,
  });
  await prisma.auditLog.create({
    data: {
      actorId: superAdmin.id, action: 'BALANCE_ADJUSTED', entity: 'Wallet', entityId: adjTx.id,
      before: { cashBalance: 3000 - 150 }, after: { cashBalance: 3000 - 150 + 500, reason: 'goodwill', amount: 500 },
      ip: '127.0.0.1', userAgent: 'seed-script',
    },
  });

  // -------------------------------------------------------------------------
  // 12. Referral rewards
  // -------------------------------------------------------------------------
  await prisma.referralReward.create({
    data: {
      referrerId: P('areeb_ff'), referredUserId: P('hamza_sniper'), rewardAmount: 50,
      status: 'CREDITED', qualifyingAction: 'FIRST_DEPOSIT_APPROVED',
      qualifiedAt: daysAgo(24), creditedAt: daysAgo(24), createdAt: daysAgo(25),
    },
  });
  await ledger(P('areeb_ff'), 'BONUS', 'CREDIT', 50, 'REFERRAL_REWARD', {
    entityType: 'User', entityId: P('hamza_sniper'), description: 'Referral reward — hamza_sniper made a first deposit',
  });
  await prisma.referralReward.create({
    data: {
      referrerId: P('areeb_ff'), referredUserId: P('fatima_noor'), rewardAmount: 50,
      status: 'PENDING', qualifyingAction: 'FIRST_DEPOSIT_APPROVED', createdAt: daysAgo(22),
    },
  });
  await prisma.referralReward.create({
    data: {
      referrerId: P('hamza_sniper'), referredUserId: P('bilal_rush'), rewardAmount: 50,
      status: 'QUALIFIED', qualifyingAction: 'FIRST_DEPOSIT_APPROVED', qualifiedAt: daysAgo(10), createdAt: daysAgo(15),
    },
  });

  // -------------------------------------------------------------------------
  // 13. Support tickets
  // -------------------------------------------------------------------------
  const tk1 = await prisma.supportTicket.create({
    data: {
      userId: P('irene_viper'), category: 'PAYMENT', subject: 'Deposit not credited yet',
      priority: 'HIGH', status: 'OPEN', createdAt: hoursAgo(2),
    },
  });
  await prisma.supportMessage.createMany({
    data: [
      { ticketId: tk1.id, senderId: P('irene_viper'), isStaff: false, body: 'I sent Rs 1,500 via EasyPaisa 2 hours ago (TID EP9920183746) but my wallet is still empty.', createdAt: hoursAgo(2) },
      { ticketId: tk1.id, senderId: moderator.id, isStaff: true, body: 'Salam! Your deposit is in the verification queue — manual payments are reviewed within 24 hours. We will notify you the moment it is approved.', createdAt: hoursAgo(1) },
    ],
  });
  const tk2 = await prisma.supportTicket.create({
    data: {
      userId: P('hamza_sniper'), category: 'TOURNAMENT', subject: 'Room ID not visible for Clash Squad Rumble',
      priority: 'MEDIUM', status: 'RESOLVED', createdAt: daysAgo(1), updatedAt: daysAgo(1),
    },
  });
  await prisma.supportMessage.createMany({
    data: [
      { ticketId: tk2.id, senderId: P('hamza_sniper'), isStaff: false, body: 'The match page says room details later — when exactly?', createdAt: daysAgo(1) },
      { ticketId: tk2.id, senderId: admin.id, isStaff: true, body: 'Room credentials unlock automatically 30 minutes before the scheduled start — you will also get a notification. Good luck!', createdAt: daysAgo(1) },
    ],
  });
  const tk3 = await prisma.supportTicket.create({
    data: {
      userId: P('zoya_headshot'), category: 'WITHDRAWAL', subject: 'Withdrawal rejected — need help fixing account details',
      priority: 'URGENT', status: 'IN_PROGRESS', createdAt: daysAgo(1),
    },
  });
  await prisma.supportMessage.create({
    data: { ticketId: tk3.id, senderId: P('zoya_headshot'), isStaff: false, body: 'My bank account title uses my full legal name. Can I still withdraw there?', createdAt: daysAgo(1) },
  });

  await prisma.dispute.create({
    data: {
      userId: P('zoya_headshot'), type: 'INCORRECT_RESULT', entityType: 'Match', entityId: t1Match.id,
      subject: 'Placement dispute — Friday Night Clash #8',
      description: 'We were top-3 when the zone closed early due to a restart. Requesting placement re-check.',
      evidence: ['/uploads/disputes/t1-zone-bug-1.png', '/uploads/disputes/t1-zone-bug-2.png'],
      status: 'INVESTIGATING', createdAt: daysAgo(2),
    },
  });

  // -------------------------------------------------------------------------
  // 14. Notifications
  // -------------------------------------------------------------------------
  await prisma.notification.createMany({
    data: [
      { userId: P('irene_viper'), type: 'DEPOSIT_APPROVED', title: 'Deposit received', body: 'Your last approved deposit of Rs 700 was credited to your cash balance.', data: { bucket: 'CASH' }, createdAt: daysAgo(25) },
      { userId: P('areeb_ff'), type: 'TOURNAMENT_JOINED', title: 'You joined Karachi Squad Cup Vol. 3', body: 'Hyderabad Hawks is locked in. Entry: Rs 50 deducted from cash balance.', createdAt: daysAgo(3) },
      { userId: P('fatima_noor'), type: 'WINNING_CREDITED', title: 'Rs 200 prize credited 🏆', body: '1st place — Friday Night Clash Solo Showdown #8. Check your winning balance.', createdAt: daysAgo(2) },
      { userId: P('areeb_ff'), type: 'WINNING_CREDITED', title: 'Rs 120 prize credited', body: '2nd place — Friday Night Clash Solo Showdown #8.', createdAt: daysAgo(2) },
      { userId: P('mahnoor_q'), type: 'ROOM_CREDENTIALS', title: 'Room details releasing soon', body: 'Clash Squad Rumble #12 room ID unlocks 30 minutes before start.', createdAt: hoursAgo(4) },
      { userId: P('fatima_noor'), type: 'WITHDRAWAL_UPDATE', title: 'Withdrawal processing', body: 'Your Rs 150 withdrawal is approved and processing. Payouts land within 24h.', createdAt: hoursAgo(12) },
      { userId: P('hamza_sniper'), type: 'REFERRAL_REWARD', title: 'Referral reward earned', body: 'bilal_rush completed their first deposit — Rs 50 bonus credited.', createdAt: daysAgo(10) },
      { userId: P('usman_t'), type: 'SYSTEM', title: 'Team invite from Karachi Kings FF', body: 'mahnoor_q invited you to join KKF. Respond from Teams.', createdAt: hoursAgo(30) },
    ],
  });

  // -------------------------------------------------------------------------
  // 15. Blog, FAQs, legal pages, ads, SEO
  // -------------------------------------------------------------------------
  await prisma.blogPost.createMany({
    data: [
      {
        title: 'How CLUTCHNEX Verifies Every Manual Payment', slug: 'how-clutchnex-verifies-manual-payments',
        excerpt: 'JazzCash, EasyPaisa and bank transfers — here is exactly how deposits are reviewed before your balance is credited.',
        content: '## Why manual verification?\n\nCLUTCHNEX supports JazzCash, EasyPaisa and bank transfer. Every deposit is reviewed by a trained operator before your balance is credited — no automated crediting, no exceptions.\n\n## What we check\n\n1. The transaction ID (TID) is real and matches your screenshot.\n2. The amount matches what you submitted.\n3. The sender account belongs to you.\n4. The TID has never been used before on CLUTCHNEX.\n\n## How long does it take?\n\nMost payments are approved within a few hours. The published review window is 24 hours. You will receive a notification the moment your deposit is approved or rejected.\n\n> Tip: submit the original SMS or app receipt — edited screenshots are rejected.',
        category: 'ANNOUNCEMENTS', status: 'PUBLISHED', authorId: admin.id,
        publishedAt: daysAgo(12), coverImage: '/uploads/blog/manual-payments.jpg',
        seoTitle: 'How CLUTCHNEX Verifies Manual Payments (JazzCash & EasyPaisa)',
        seoDescription: 'A transparent look at how CLUTCHNEX reviews JazzCash, EasyPaisa and bank transfer deposits before crediting your wallet.',
      },
      {
        title: 'Squad Communication Guide: Win More Free Fire Tournaments', slug: 'squad-communication-guide',
        excerpt: 'Callouts, roles and rotation timing — the communication habits of consistently winning squads.',
        content: '## Roles first\n\nEvery strong squad has a clear IGL (in-game leader), an entry fragger, a support and a sniper/anchor. Decide roles before the match, not during it.\n\n## Callouts that matter\n\n- Direction + landmark: "Two pushing from the blue roof, east side."\n- Economy of words: short callouts beat long sentences.\n- Report damage numbers, not just "I hit him".\n\n## Rotations\n\nMove early. Squads that rotate before the third zone keeps options. Keep smokes for the final two rotations and never cross open ground without cover fire.\n\nPractice these basics in Clash Squad scrims first — the habits transfer directly to battle royale.',
        category: 'GUIDES', status: 'PUBLISHED', authorId: moderator.id,
        publishedAt: daysAgo(7), coverImage: '/uploads/blog/squad-comms.jpg',
        seoTitle: 'Free Fire Squad Communication Guide | CLUTCHNEX',
        seoDescription: 'Callouts, roles and rotation timing — communication habits of consistently winning Free Fire squads.',
      },
      {
        title: 'Clash Squad Meta: Best Characters for Competitive Play', slug: 'clash-squad-meta-characters',
        excerpt: 'The current Clash Squad meta picks on CLUTCHNEX ladders — and why utility beats raw gun skill.',
        content: '## The current meta\n\nCompetitive Clash Squad on CLUTCHNEX keeps converging on utility-first lineups. A solid four-stack pairs one aggressive entry ability with two support abilities and one anchor.\n\n## Why utility wins\n\nRound economy in Clash Squad is brutal. Characters that save HP, recover EP or grant vision let your squad re-peek without resetting — that is a free round over a season.\n\n## Practice checklist\n\n1. Run the same lineup for at least 20 ranked rounds before changing.\n2. Track which rounds you lose on utility usage, not aim.\n3. Submit your scrims — verified results build your CLUTCHNEX ranking.',
        category: 'STRATEGY', status: 'PUBLISHED', authorId: admin.id,
        publishedAt: daysAgo(3), coverImage: '/uploads/blog/cs-meta.jpg',
      },
      {
        title: 'September Tournament Calendar', slug: 'september-tournament-calendar',
        excerpt: 'Draft — full monthly calendar with prize pools.',
        content: '## Coming up\n\n- Weekly solo: every Friday, 9 PM PKT\n- Duo Dominators: every Saturday\n- Monthly squad championship: last Sunday\n\n(Draft — publish once prize pools are finalized.)',
        category: 'NEWS', status: 'DRAFT', authorId: admin.id, createdAt: hoursAgo(10),
      },
    ],
  });

  await prisma.faq.createMany({
    data: [
      { question: 'How do I join a tournament?', answer: 'Create an account, verify it, add money through JazzCash/EasyPaisa/bank transfer, then open any open tournament and press JOIN. Your entry fee is deducted from your balance instantly.', category: 'Tournaments', sortOrder: 1 },
      { question: 'How do I add money with JazzCash or EasyPaisa?', answer: 'Open Wallet → Add Money, choose the amount and method, send the payment to the displayed CLUTCHNEX account, then submit the transaction ID and screenshot. An admin verifies it — usually within a few hours.', category: 'Payments', sortOrder: 2 },
      { question: 'How fast are withdrawals?', answer: 'Withdrawal requests are reviewed by an admin, then paid out within the published processing window (currently 24 hours) to JazzCash, EasyPaisa or bank transfer.', category: 'Payments', sortOrder: 3 },
      { question: 'When do I get the room ID and password?', answer: 'Room credentials unlock automatically 30 minutes before the match start time inside My Matches. They are never shown publicly.', category: 'Tournaments', sortOrder: 4 },
      { question: 'Do I need a team to play?', answer: 'Solo tournaments need no team. Duo and Squad events require a team — you can create one and invite friends, or accept an invite from Teams.', category: 'Teams', sortOrder: 5 },
      { question: 'How do referral rewards work?', answer: 'Share your referral code. When your friend registers and their first deposit is approved, you receive the configured reward in your bonus balance.', category: 'Rewards', sortOrder: 6 },
      { question: 'What gets a player banned?', answer: 'Hacks, scripts, exploits, teabagging/team-ups where prohibited, fake results and impersonation. Bans come with evidence records and may forfeit prizes.', category: 'Fair Play', sortOrder: 7 },
      { question: 'Can I install CLUTCHNEX as an app?', answer: 'Yes — CLUTCHNEX is a PWA. Use the Install CLUTCHNEX banner or your browser menu "Add to Home Screen". It works offline for already-loaded pages.', category: 'Platform', sortOrder: 8 },
    ],
  });

  const pages: Array<[string, string, string]> = [
    ['how-it-works', 'How CLUTCHNEX Works', '## 1. Register & verify\nCreate your account and verify it. Add your Free Fire UID and IGN so results can be matched to your game profile.\n\n## 2. Add money\nDeposit through JazzCash, EasyPaisa or bank transfer. Payments are verified by our team before your balance is credited — never automatically.\n\n## 3. Join a tournament\nPick a Solo, Duo, Squad or Clash Squad event, pay the entry fee from your balance and lock your slot.\n\n## 4. Play & submit\nRoom credentials unlock 30 minutes before start. Play the match, then submit your result screenshot.\n\n## 5. Win & withdraw\nVerified winners receive prize money in their winning balance. Withdraw anytime to JazzCash, EasyPaisa or bank.'],
    ['terms-of-service', 'Terms & Conditions', 'By using CLUTCHNEX you agree to these terms. CLUTCHNEX organizes skill-based Free Fire tournaments. Entry fees fund prize pools and a transparent platform service fee. You must be eligible in your jurisdiction to participate in paid competition. Balances are platform credits redeemable through the documented withdrawal process. CLUTCHNEX may suspend accounts that violate the Fair Play Policy. Prizes are credited only after result verification. Nothing on this platform constitutes a guarantee of earnings.'],
    ['privacy-policy', 'Privacy Policy', 'We collect the minimum data needed to run tournaments: account details, your Free Fire identity, payment references and device metadata for security. Payment screenshots are used only for deposit verification. We never sell personal data. You may request account deletion, which removes personal data except records we must retain for financial compliance.'],
    ['refund-policy', 'Refund Policy', 'Entry fees are refunded according to each tournament\'s published refund percentage when CLUTCHNEX cancels the event (default: 100%). Voluntary cancellation before registration deadline may be refunded minus processed bonuses at admin discretion. Approved deposits are non-reversible once credited; disputed payments are investigated case by case.'],
    ['fair-play-policy', 'Fair Play Policy', 'No hacks, scripts, exploits, unauthorized teaming, account sharing, fake results or impersonation. Violations lead to warnings, suspension, permanent bans and prize forfeiture. Every enforcement action is logged with evidence. Suspected cheating can be reported from any match page.'],
    ['tournament-rules', 'Tournament Rules', 'Room credentials are private — sharing them publicly is a bannable offense. Results require verifiable screenshots. Points = placement points + kills × tournament points-per-kill setting. Admins resolve disputes; their decision is final. Registered players who no-show forfeit the entry fee.'],
    ['responsible-play', 'Responsible Participation', 'Compete within your means. Set personal limits on deposits. CLUTCHNEX never promises guaranteed earnings — tournaments are competitive events with uncertain outcomes. If competition stops being fun, take a break and talk to support.'],
    ['contact', 'Contact', 'Support is available through tickets in the Support Center, WhatsApp support (see the floating button), and email support@clutchnex.gg. Average first-response time is under 6 hours.'],
  ];
  for (const [slug, title, content] of pages) {
    await prisma.staticPage.create({ data: { slug, title, content, seoTitle: `${title} | CLUTCHNEX` } });
  }

  await prisma.advertisement.createMany({
    data: [
      { placement: 'HEADER', name: 'Launch banner — CLUTCHNEX merch', imageUrl: '/uploads/ads/header-banner.jpg', targetUrl: '/blog/how-clutchnex-verifies-manual-payments', isActive: true, impressions: 1240, clicks: 37 },
      { placement: 'SIDEBAR', name: 'Duo Dominators promo', imageUrl: '/uploads/ads/duo-promo.jpg', targetUrl: '/free-fire-tournaments/duo', isActive: true, impressions: 630, clicks: 19 },
      { placement: 'INTERSTITIAL', name: 'Interstitial — monthly championship', imageUrl: '/uploads/ads/interstitial.jpg', targetUrl: '/tournaments/bermuda-royale-monthly-august', isActive: false },
    ],
  });

  await prisma.seoConfig.createMany({
    data: [
      { pageSlug: 'home', title: 'CLUTCHNEX — Free Fire Tournaments in Pakistan | Compete & Win', description: 'Join competitive Free Fire tournaments — Solo, Duo, Squad and Clash Squad. Verified prize pools, manual payments, fast withdrawals.', keywords: 'free fire tournaments, free fire tournament pakistan, clash squad tournaments' },
      { pageSlug: 'tournaments', title: 'Free Fire Tournaments — Solo, Duo, Squad & Clash Squad | CLUTCHNEX', description: 'Browse open Free Fire tournaments with transparent entry fees, prize pools and start times.' },
      { pageSlug: 'leaderboard', title: 'CLUTCHNEX Leaderboard — Top Free Fire Players', description: 'Global, weekly and monthly rankings by points, kills, wins and earnings.' },
    ],
  });

  await prisma.fraudAlert.createMany({
    data: [
      { userId: P('ali_phantom'), kind: 'DEPOSIT_TID_DUPLICATE_ATTEMPT', severity: 'MEDIUM', details: { transactionId: 'JC8492017365', note: 'TID belongs to another user — blocked at submission' }, status: 'OPEN', createdAt: hoursAgo(26) },
      { userId: P('usman_t'), kind: 'MULTIPLE_FAILED_LOGINS', severity: 'LOW', details: { attempts: 5 }, status: 'DISMISSED', reviewedById: moderator.id, reviewedAt: daysAgo(4), createdAt: daysAgo(4) },
    ],
  });

  // Platform expenses (gross-vs-net accounting buckets — spec §22)
  await prisma.expense.createMany({
    data: [
      { category: 'PAYMENT_COST', amount: 180, note: 'JazzCash/EasyPaisa payout fees — August', occurredAt: daysAgo(6), createdById: admin.id },
      { category: 'OPERATIONAL', amount: 2500, note: 'Hosting + monitoring — August', occurredAt: daysAgo(10), createdById: superAdmin.id },
      { category: 'PROMOTION', amount: 400, note: 'Welcome bonuses campaign top-up', occurredAt: daysAgo(12), createdById: admin.id },
    ],
  });

  // -------------------------------------------------------------------------
  // 16. Audit trail for the seeded admin operations
  // -------------------------------------------------------------------------
  await prisma.auditLog.createMany({
    data: [
      { actorId: admin.id, action: 'DEPOSIT_APPROVED', entity: 'Deposit', entityId: null, after: { count: 12, total: 'PKR 14,600' }, ip: '127.0.0.1', userAgent: 'seed-script' },
      { actorId: admin.id, action: 'DEPOSIT_REJECTED', entity: 'Deposit', after: { transactionId: 'JC0000000001', reason: 'screenshot-mismatch' }, ip: '127.0.0.1', userAgent: 'seed-script' },
      { actorId: admin.id, action: 'TOURNAMENT_CREATED', entity: 'Tournament', entityId: tournaments.squadOpen.id, after: { title: tournaments.squadOpen.title }, ip: '127.0.0.1', userAgent: 'seed-script' },
      { actorId: admin.id, action: 'PRIZE_DISTRIBUTED', entity: 'Tournament', entityId: tournaments.squadDone.id, after: { prizePool: 480, winners: 3 }, ip: '127.0.0.1', userAgent: 'seed-script' },
      { actorId: admin.id, action: 'WITHDRAWAL_APPROVED', entity: 'Withdrawal', entityId: w2.id, after: { amount: 150 }, ip: '127.0.0.1', userAgent: 'seed-script' },
      { actorId: admin.id, action: 'WITHDRAWAL_REJECTED', entity: 'Withdrawal', entityId: w3.id, after: { amount: 35, reason: 'account-title-mismatch' }, ip: '127.0.0.1', userAgent: 'seed-script' },
      { actorId: superAdmin.id, action: 'SEED_COMPLETED', entity: 'System', after: { note: 'Development seed data written' }, ip: '127.0.0.1', userAgent: 'seed-script' },
    ],
  });

  // -------------------------------------------------------------------------
  // 17. Flush wallets + player stats
  // -------------------------------------------------------------------------
  await flushWallets();
  for (const [userId, s] of stats) {
    await prisma.playerStat.create({
      data: {
        userId, matchesPlayed: s.matches, wins: s.wins, kills: s.kills,
        totalPoints: s.points, earnings: new Prisma.Decimal(s.earnings), lastPlayedAt: s.last,
      },
    });
  }

  // Sanity report
  const users = await prisma.user.count();
  const txs = await prisma.walletTransaction.count();
  const regs = await prisma.tournamentRegistration.count();
  console.log(`✅ Seed complete: ${users} users, ${txs} ledger entries, ${regs} registrations.`);
  console.log('   Staff logins: admin@clutchnex.gg / ops@clutchnex.gg / mod@clutchnex.gg');
  console.log('   Players: username@example.com — password Player@123 (DEV ONLY)');
}

main()
  .catch((e) => {
    console.error('❌ Seed failed:', e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
