// Shared helper for the `verify:*` scripts.
//
// The verification scripts used to sign admin JWTs for a HARDCODED e-mail
// (`admin@clutchnex.gg`) or even for a subject id that exists in no database
// at all. `requireAuth` correctly re-reads the account on every request and
// rejects tokens whose subject is missing or not ACTIVE, so those scripts
// failed against any correctly-seeded database. Resolve real staff rows here
// instead, and create one on demand when the database has none.
import bcrypt from 'bcryptjs';
import type pg from 'pg';

export interface StaffActor {
  id: string;
  username: string;
  role: string;
}

/**
 * Return an ACTIVE account with at least ADMIN privileges, creating a
 * throwaway one if the database has none. Never used in production code.
 */
export async function ensureAdmin(db: pg.Client, username = 'verify_admin'): Promise<StaffActor> {
  const existing = await db.query<StaffActor>(
    `SELECT id, username, role FROM users
     WHERE role IN ('ADMIN','SUPER_ADMIN') AND status = 'ACTIVE' AND "deletedAt" IS NULL
     ORDER BY CASE role WHEN 'SUPER_ADMIN' THEN 0 ELSE 1 END, "createdAt"
     LIMIT 1`,
  );
  if (existing.rows[0]) return existing.rows[0];

  const created = await db.query<StaffActor>(
    `INSERT INTO users (id, username, email, "passwordHash", role, status, "isVerified", "referralCode", "createdAt", "updatedAt")
     VALUES (gen_random_uuid()::text, $1, $1 || '@example.com', $2, 'ADMIN', 'ACTIVE', true, 'VRF-' || substr(md5($1),1,5), now(), now())
     ON CONFLICT (username) DO UPDATE SET role = 'ADMIN', status = 'ACTIVE'
     RETURNING id, username, role`,
    [username, bcrypt.hashSync('VerifyAdmin@12345', 10)],
  );
  const admin = created.rows[0]!;
  await db.query(
    `INSERT INTO wallets (id, "userId", "cashBalance", "winningBalance", "createdAt", "updatedAt")
     VALUES (gen_random_uuid()::text, $1, 0, 0, now(), now())
     ON CONFLICT ("userId") DO NOTHING`,
    [admin.id],
  );
  return admin;
}

/** Return an ACTIVE plain USER account, creating one if needed. */
export async function ensureUser(db: pg.Client, username = 'verify_user'): Promise<StaffActor> {
  const created = await db.query<StaffActor>(
    `INSERT INTO users (id, username, email, "passwordHash", role, status, "isVerified", "referralCode", "createdAt", "updatedAt")
     VALUES (gen_random_uuid()::text, $1, $1 || '@example.com', $2, 'USER', 'ACTIVE', true, 'VRF-' || substr(md5($1),1,5), now(), now())
     ON CONFLICT (username) DO UPDATE SET role = 'USER', status = 'ACTIVE'
     RETURNING id, username, role`,
    [username, bcrypt.hashSync('VerifyUser@12345', 10)],
  );
  const user = created.rows[0]!;
  await db.query(
    `INSERT INTO wallets (id, "userId", "cashBalance", "winningBalance", "createdAt", "updatedAt")
     VALUES (gen_random_uuid()::text, $1, 0, 0, now(), now())
     ON CONFLICT ("userId") DO NOTHING`,
    [user.id],
  );
  return user;
}
