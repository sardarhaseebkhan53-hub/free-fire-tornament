// /api/wallet + /api/admin payment review validation — the server never trusts
// client amounts, transaction IDs are unique per DB constraint, screenshots are
// validated by multer (MIME + size) before these schemas even run.
import { z } from 'zod';

export const PAYMENT_METHODS = ['JAZZCASH', 'EASYPAISA', 'BANK_TRANSFER'] as const;

export const depositSchema = z.object({
  amount: z.coerce
    .number()
    .int('Amount must be a whole number of PKR')
    .positive('Amount must be positive')
    .max(1_000_000),
  method: z.enum(PAYMENT_METHODS),
  transactionId: z
    .string()
    .trim()
    .min(4, 'Transaction ID looks too short')
    .max(64)
    .regex(/^[A-Za-z0-9_-]+$/, 'Only letters, numbers, - and _ allowed'),
  senderName: z.string().trim().min(2, 'Sender name is required').max(80),
  senderAccount: z.string().trim().max(40).optional().default(''),
});

export const withdrawalSchema = z.object({
  amount: z.coerce
    .number()
    .int('Amount must be a whole number of PKR')
    .positive('Amount must be positive')
    .max(1_000_000),
  method: z.enum(PAYMENT_METHODS),
  accountName: z.string().trim().min(2, 'Account holder name is required').max(80),
  accountNumber: z.string().trim().min(5, 'Account number looks too short').max(34),
  accountDetails: z.string().trim().max(120).optional().default(''),
});

export const convertCoinsSchema = z.object({
  amount: z.coerce.number().int().positive().max(1_000_000),
});

export const transferSchema = z.object({
  recipientUsername: z.string().trim().min(3, 'Username looks too short').max(30),
  amount: z.coerce.number().positive('Amount must be positive').max(1_000_000),
  note: z.string().trim().max(140).optional().default(''),
  // Idempotency key (uuid v4) — replays return the original transfer.
  requestId: z.string().min(8).max(64),
});

export const transferListQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(5).max(100).default(20),
});

const TX_TYPES = [
  'DEPOSIT', 'ENTRY_FEE', 'ENTRY_REFUND', 'WINNING', 'WITHDRAWAL',
  'WITHDRAWAL_REVERSAL', 'BONUS_CREDIT', 'BONUS_DEBIT', 'REFERRAL_REWARD',
  'COIN_CONVERSION', 'ADMIN_CREDIT', 'ADMIN_DEBIT',
] as const;

export const transactionsQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(5).max(100).default(10),
  type: z.string().max(240).optional(), // comma-separated WalletTxType values
  direction: z.enum(['CREDIT', 'DEBIT']).optional(),
  bucket: z.enum(['CASH', 'COINS', 'WINNING', 'BONUS']).optional(),
  search: z.string().trim().max(64).optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
  format: z.enum(['json', 'csv']).default('json'),
});

export const depositListQuerySchema = z.object({
  status: z.enum(['PENDING', 'APPROVED', 'REJECTED']).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(5).max(100).default(20),
});

export const withdrawalListQuerySchema = z.object({
  status: z.enum(['PENDING', 'APPROVED', 'PROCESSING', 'PAID', 'REJECTED', 'CANCELLED']).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(5).max(100).default(20),
});

export const depositReviewSchema = z.object({
  action: z.enum(['APPROVE', 'REJECT']),
  note: z.string().trim().max(300).optional().default(''),
});

export const withdrawalReviewSchema = z.object({
  action: z.enum(['APPROVE', 'PROCESS', 'PAID', 'REJECT']),
  note: z.string().trim().max(300).optional().default(''),
  paidReference: z.string().trim().max(64).optional().default(''),
});
