// =============================================================================
// Phase 11 — NEXA, the rule-based assistant.
//
// NEXA ANSWERS QUESTIONS. Full stop. It has no capability to do anything else:
//   • it can never approve payments or deposits,
//   • it can never change balances or move money,
//   • it can never reveal room IDs or passwords (those live behind the timed
//     release in /api/matches/my, and NEXA has no access to them),
//   • it writes NOTHING to the database — it is a pure function over the
//     question + whitelisted public settings.
//
// Swapping in a real AI later: implement the NexaEngine interface below and
// register it in nexa.routes.ts — the endpoint, rate limits and UI stay
// unchanged. Whatever engine is installed, the GUARDRAIL answers below must
// keep precedence for the sensitive intents (or the engine must be wrapped
// with the same refusals).
// =============================================================================
import { getSetting } from './settings.service';

export interface NexaReply {
  intent: string;
  reply: string;
  quickReplies: string[];
  /** true when the answer came from a hard-limit refusal rule */
  guarded: boolean;
}

export interface NexaEngine {
  name: string;
  answer(question: string, ctx: NexaContext): Promise<NexaReply>;
}

export interface NexaContext {
  whatsappNumber: string;
  supportEmail: string;
  ticketsPath: string;
}

interface Rule {
  intent: string;
  patterns: RegExp[];
  answer: (ctx: NexaContext) => string;
  quickReplies?: string[];
  guarded?: boolean;
}

const LIMIT_NOTICE =
  'I answer questions only — I can never approve payments, change balances or share room IDs.';

const RULES: Rule[] = [
  // --- HARD LIMITS — these refusals always win -------------------------------
  {
    intent: 'room_credentials',
    patterns: [/room\s*id/i, /room\s*password/i, /credential/i, /room\s*code/i],
    answer: () =>
      `Room IDs and passwords unlock automatically at the release time shown on your card — in My Matches for match rooms, and on the tournament's Room card for event rooms (a few minutes before start, by default 5). Only players holding a confirmed seat can see them, and they disappear the moment staff cancel a room. ${LIMIT_NOTICE} If the release time passed and nothing unlocked, open a TECHNICAL ticket and staff will check.`,
    quickReplies: ['When is my match?', 'How do I join a tournament?'],
    guarded: true,
  },
  {
    intent: 'approve_payment',
    patterns: [
      /approve\s*(my|the|this)?\s*(deposit|payment|withdraw)/i,
      /(deposit|payment|withdraw)\s*.{0,20}(approved\?|approve|credit\?|credit me)/i,
      /credit\s+(my|the)\s+(wallet|deposit|payment)/i,
      /why.{0,20}(not|isn'?t).{0,20}credited/i,
    ],
    answer: () =>
      `Deposits and withdrawals are verified by real staff, usually within 24 hours — your money is never touched by a bot. ${LIMIT_NOTICE} Track the status in Wallet → Transactions; if it stays pending past 24h, reply on your ticket or ping WhatsApp.`,
    quickReplies: ['Where is my deposit?', 'How long do withdrawals take?'],
    guarded: true,
  },
  {
    intent: 'change_balance',
    patterns: [
      /(add|give|send|top\s*up|put).{0,24}(balance|money|cash|coins|bonus|wallet)/i,
      /(change|fix|edit|increase|adjust).{0,20}(my)?\s*(balance|wallet|winnings)/i,
      /bonus\s*(kama|de|do|dena)/i,
    ],
    answer: () =>
      `I can't move money in any direction — balances only change through real flows: deposits (you + staff verification), tournament entries, and prize payouts. ${LIMIT_NOTICE} To add funds, use Wallet → Add Money.`,
    quickReplies: ['How do I add money?', 'How do prizes get paid?'],
    guarded: true,
  },
  // --- Normal intents ---------------------------------------------------------
  {
    intent: 'greeting',
    patterns: [/^(hi|hey|hello|salam|assalam|aoa|yo)\b/i, /^(good\s*(morning|evening|afternoon))/i, /kya\s*haal/i],
    answer: () =>
      'Hey! I\'m NEXA, the CLUTCHNEX assistant. Ask me about tournaments, entries, deposits, withdrawals, room unlocks or prizes.',
    quickReplies: ['How do I join a tournament?', 'Where is my deposit?', 'How do I withdraw winnings?'],
  },
  {
    intent: 'deposit_status',
    patterns: [/where.{0,12}(is|my).{0,12}deposit/i, /deposit.{0,20}(pending|status|review|kab|kahan)/i, /payment.{0,16}(pending|status|not.{0,8}show)/i, /paisa.{0,12}(nahi|aaya)/i],
    answer: () =>
      'After you submit your transaction ID + screenshot, staff verify manually — most finish within 24 hours. You can watch the state (Pending → Approved/Rejected) under Wallet → Transactions. If it has been longer than 24h, open a PAYMENT ticket with your TID and staff will chase it.',
    quickReplies: ['How do I add money?', 'Open a payment ticket'],
  },
  {
    intent: 'deposit_how',
    patterns: [/(how|kaise).{0,24}(add|deposit|load|top\s*up).{0,16}(money|cash|funds|wallet)?/i, /add\s*money/i, /payment\s*methods?/i, /(jazzcash|easypaisa)/i],
    answer: () =>
      'Open Wallet → Add Money, pick an amount, then pay via JazzCash, EasyPaisa or bank transfer to the account shown on the payment page. Submit the transaction ID + a screenshot and staff verify it manually — usually within 24h. Your single PKR wallet is credited only after approval.',
    quickReplies: ['Where is my deposit?', 'Minimum deposit?'],
  },
  {
    intent: 'withdrawal',
    patterns: [/withdraw/i, /(cash\s*out)/i, /payout/i, /winnings.{0,16}(kab|nikal|get|take)/i],
    answer: () =>
      'Winnings withdraw from Wallet → Withdraw: choose an amount and method, then staff process the chain (Approved → Processing → Paid) with a payout reference. Only your winnings are withdrawable; deposited PKR stays in your wallet for entries — that rule keeps the prize pools honest.',
    quickReplies: ['How long do withdrawals take?', 'Why only winnings?'],
  },
  {
    intent: 'transfer',
    patterns: [/(send|transfer).{0,20}(money|pkr|cash|rupees|wallet)/i, /paisa.{0,16}(bhej|send)/i, /transfer.{0,16}(to|friend|player)/i, /send.{0,16}(to|friend|player)/i],
    answer: () =>
      'Use Wallet → Send Money: enter the player\u2019s username, amount and an optional note. Transfers are instant, atomic and audited — the sender is debited and the receiver credited in one locked transaction, and transfers are final, so double-check the username.',
    quickReplies: ['How do I add money?', 'Where is my deposit?'],
  },
  {
    intent: 'seats',
    patterns: [/seat/i, /slot/i, /48/i, /capacity/i, /full/i],
    answer: () =>
      'Every tournament has its own capacity set by the format: solo events count individual players, while duo/squad/4v4 events count teams (each team seat holds 2 or 4 players). Registration takes the next free seat atomically, so two players can never get the same seat. Your seat number is on the join confirmation, in My Matches and on your dashboard. When all seats are taken the tournament shows FULL and no more entries are accepted.',
    quickReplies: ['How do I join a tournament?', 'What modes are there?'],
  },
  {
    intent: 'modes',
    patterns: [/modes?/i, /(solo|duo|squad|clash\s*squad|lone\s*wolf|1\s*[vV]\s*1)/i, /types?\s*of\s*tournament/i],
    answer: () =>
      'CLUTCHNEX runs six modes. SOLO: you play alone, no team needed. DUO: you and one partner (invite them, no 4-player squad required). SQUAD: a full 4-player team, registered by the captain. CLASH SQUAD: the configured team structure — check each tournament\\u2019s rules for its exact size and format. LONE WOLF: solo-entry rounds, no team. CLASH SQUAD 1V1: head-to-head single-player brackets, no team. For Duo, Squad and Clash Squad you can also register alone when independent entry is enabled and get paired by an admin later.',
    quickReplies: ['How do I join a tournament?', 'How do teams work?'],
  },
  {
    intent: 'join_tournament',
    patterns: [/(how|kaise).{0,24}(join|enter|register)/i, /join.{0,16}(tournament|match|game)/i, /entry\s*fee/i, /register/i],
    answer: () =>
      'Pick a tournament on the Tournaments page, check the entry fee and prize split, then Join. Solo pays from your cash balance instantly; in Duo/Squad modes the captain registers the full team and every member pays their own share. If independent entry is enabled you can also register alone and an admin pairs you later. Slots are first-come — the join is atomic, so no double charges.',
    quickReplies: ['What modes are there?', 'Can I get a refund?'],
  },
  {
    intent: 'teams',
    patterns: [/team/i, /squad/i, /duo/i, /captain/i, /invite/i, /lone\\s*wolf/i, /1\\s*[vV]\\s*1/i],
    answer: () =>
      'For DUO and SQUAD tournaments you need a team: create one under Teams, invite your partner or squadmates by username, and once everyone accepts, the captain registers the whole team. SOLO, LONE WOLF and CLASH SQUAD 1V1 tournaments need no team at all — you join directly. You can hold one duo and one squad team at a time.',
    quickReplies: ['What modes are there?', 'How do I join a tournament?'],
  },
  {
    intent: 'refund',
    patterns: [/refund/i, /cancel.{0,16}(my)?\s*(entry|join|registration)/i, /paisa\s*wapas/i],
    answer: () =>
      'You can cancel while registration is open from the tournament page — you are refunded per that tournament\'s refund percentage and the slot frees up instantly. If admins cancel a tournament, every player is refunded automatically, with a full audit trail.',
    quickReplies: ['How do I join a tournament?', 'Talk to a human'],
  },
  {
    intent: 'schedule',
    patterns: [/(when|kab).{0,24}(match|start|tournament|room)/i, /schedule/i, /timing/i],
    answer: () =>
      'Every tournament card shows its start time and the match schedule lives on its details page. Room credentials unlock on your My Matches card (match rooms) or the tournament\'s Room card (event rooms) at the release moment — watch the countdown there.',
    quickReplies: ['How do room unlocks work?', 'Join a tournament'],
  },
  {
    intent: 'prizes',
    patterns: [/prize/i, /kill\s*(point|pool|rate)/i, /reward/i, /kitna\s*milega/i, /payout\s*table/i],
    answer: () =>
      'Each tournament publishes its full prize split before you join: placement prizes, per-kill points (with caps), MVP awards and team splits. After admins verify results, prizes are credited to your winning balance automatically — and every award is one-time-guarded so nothing is paid twice.',
    quickReplies: ['How do I withdraw winnings?', 'Where are results?'],
  },
  {
    intent: 'referral',
    patterns: [/refer(ral)?/i, /invite\s*(friend|code)?/i, /bonus\s*code/i],
    answer: () =>
      'Share your referral link from the dashboard. When a referred friend qualifies, the referral reward lands in your wallet automatically. Welcome bonuses and referral amounts are set by the platform, so numbers can change over time.',
    quickReplies: ['Where is my referral link?', 'How do bonuses work?'],
  },
  {
    intent: 'account',
    patterns: [/account/i, /password/i, /verify\s*(email|account)/i, /banned|suspended/i, /username/i, /email/i],
    answer: () =>
      'For account issues — verification emails, password resets, name or FF UID changes — open an ACCOUNT ticket and staff will sort it. Password resets self-serve from the login page and revoke other sessions for safety.',
    quickReplies: ['Open an account ticket', 'Talk to a human'],
  },
  {
    intent: 'contact_human',
    patterns: [/(talk|speak|chat).{0,16}(to|with)?\s*(a\s*)?(human|person|admin|staff|agent|someone|operator)/i, /whatsapp/i, /support\s*team/i, /real\s*person/i],
    answer: (c) =>
      `Fastest routes to a human: WhatsApp ${c.whatsappNumber || 'us (number is on every page)'} or a support ticket — tickets keep the full history and get staff replies in-app. I'm here 24/7 for the quick stuff.`,
    quickReplies: ['Open a ticket', 'Where is my deposit?'],
  },
];

const FALLBACK_QUICK = ['How do I join a tournament?', 'Where is my deposit?', 'How do I withdraw winnings?'];

/** The rule engine — deterministic, stateless, no DB writes. */
export const ruleEngine: NexaEngine = {
  name: 'nexa-rules-v1',
  async answer(question, ctx) {
    const q = question.trim();
    for (const rule of RULES) {
      if (rule.patterns.some((p) => p.test(q))) {
        return {
          intent: rule.intent,
          reply: rule.answer(ctx),
          quickReplies: rule.quickReplies ?? FALLBACK_QUICK,
          guarded: rule.guarded === true,
        };
      }
    }
    return {
      intent: 'fallback',
      reply:
        `I'm not sure about that one. Try asking about tournaments, entries, deposits, withdrawals, room unlocks or prizes — or reach staff on WhatsApp ${ctx.whatsappNumber ? `(${ctx.whatsappNumber}) ` : ''}or via a support ticket.`,
      quickReplies: FALLBACK_QUICK,
      guarded: false,
    };
  },
};

/** Load only the whitelisted public settings NEXA may quote. */
export async function nexaContext(): Promise<NexaContext> {
  const [whatsappNumber, supportEmail] = await Promise.all([
    getSetting('platform.whatsappNumber', ''),
    getSetting('platform.supportEmail', ''),
  ]);
  return { whatsappNumber: String(whatsappNumber), supportEmail: String(supportEmail), ticketsPath: '/support/tickets' };
}
