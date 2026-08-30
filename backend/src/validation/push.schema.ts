import { z } from 'zod';

// A push endpoint is an opaque URL from the push service (Firebase, Mozilla autopush,
// …) and the two key halves are fixed-size base64. The bounds are generous but real:
// without them this table would happily accept a megabyte per subscription from any
// signed-in account, and it is read on every notification fan-out.
export const pushSubscribeSchema = z.object({
  // https only, deliberately: `web-push` speaks TLS to the push service and has no
  // plain-HTTP mode, so accepting an http:// endpoint would store an address that can
  // never be delivered to — a silent no-op is the worst possible outcome for a user who
  // just tapped "allow" on a permission prompt.
  endpoint: z
    .string()
    .trim()
    .min(10)
    .max(2048)
    .regex(/^https:\/\//i, 'endpoint must be an https:// URL'),
  p256dh: z.string().trim().min(40).max(256),
  auth: z.string().trim().min(10).max(64),
});

export type PushSubscribeInput = z.infer<typeof pushSubscribeSchema>;
