// Zod schemas — the ONLY way request bodies reach services.
import { z } from 'zod';

const password = z
  .string()
  .min(8, 'Password must be at least 8 characters')
  .max(128)
  .regex(/[a-zA-Z]/, 'Password must contain a letter')
  .regex(/[0-9]/, 'Password must contain a number');

export const registerSchema = z.object({
  fullName: z.string().min(3).max(60),
  username: z
    .string()
    .min(3)
    .max(20)
    .regex(/^[a-z0-9_]+$/i, 'Username may only contain letters, numbers and _'),
  email: z.string().email().max(120),
  phone: z.string().min(7).max(20).optional(),
  password,
  confirmPassword: z.string(),
  freeFireUID: z.string().regex(/^\d{6,12}$/, 'Free Fire UID must be 6–12 digits').optional(),
  freeFireIGN: z.string().max(24).optional(),
  referralCode: z.string().max(24).optional(),
}).refine((d) => d.password === d.confirmPassword, {
  message: 'Passwords do not match',
  path: ['confirmPassword'],
});

export const loginSchema = z.object({
  identifier: z.string().min(3).max(120), // email or username
  password: z.string().min(1).max(128),
});

export const emailSchema = z.object({ email: z.string().email() });

export const verifyEmailSchema = z.object({ token: z.string().min(16) });

export const resetPasswordSchema = z.object({
  token: z.string().min(16),
  password,
  confirmPassword: z.string(),
}).refine((d) => d.password === d.confirmPassword, {
  message: 'Passwords do not match',
  path: ['confirmPassword'],
});

export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1),
  password,
  confirmPassword: z.string(),
}).refine((d) => d.password === d.confirmPassword, {
  message: 'Passwords do not match',
  path: ['confirmPassword'],
});

/** Profile edit (spec §20) — server validates FF identity, never trusts the client. */
export const updateProfileSchema = z.object({
  fullName: z.string().trim().min(2).max(60).optional(),
  freeFireUID: z.string().trim().regex(/^\d{5,15}$/, 'UID must be 5–15 digits').optional().nullable(),
  freeFireIGN: z.string().trim().min(2).max(24).optional().nullable(),
  city: z.string().trim().max(60).optional().nullable(),
  bio: z.string().trim().max(240).optional().nullable(),
  showPublicProfile: z.boolean().optional(),
});
