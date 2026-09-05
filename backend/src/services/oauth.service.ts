// =============================================================================
// Social authentication — Google, Microsoft and Apple (OAuth 2.0 / OIDC).
//
// Flow (authorization-code, server-side exchange):
//   1. GET  /api/auth/oauth/:provider          → 302 to the provider's consent
//                                                 screen (state cookie set)
//   2. GET|POST /api/auth/oauth/:provider/callback
//                                              → code exchanged server-to-server,
//                                                 identity claims extracted from
//                                                 the id_token, account resolved
//                                                 (link/create — never duplicate),
//                                                 session issued, 302 back to the
//                                                 frontend with the access token.
//
// Duplicate-account prevention:
//   • (provider, providerAccountId) is globally unique — the same provider
//     subject always resolves to the same linked row;
//   • an unknown subject whose email matches an EXISTING account LINKS to it
//     instead of creating a second user;
//   • only a truly new email creates a user row (passwordHash stays NULL —
//     social accounts never carry a local password).
//
// The frontend receives only the access token + profile-completeness flag.
// Client ids / secrets never leave the server.
// =============================================================================
import crypto from 'node:crypto';
import { env } from '../lib/env';
import { prisma } from '../lib/prisma';
import { ApiError, badRequest, forbidden } from '../lib/errors';
import { hashToken, newOpaqueToken, signAccessToken } from '../lib/tokens';
import { audit } from '../lib/security';
import type { RequestContext } from './auth.service';

export type OAuthProviderId = 'google' | 'microsoft' | 'apple';

const PROVIDER_STORAGE: Record<OAuthProviderId, 'GOOGLE' | 'MICROSOFT' | 'APPLE'> = {
  google: 'GOOGLE',
  microsoft: 'MICROSOFT',
  apple: 'APPLE',
};

interface ProviderConfig {
  id: OAuthProviderId;
  label: string;
  authorizeUrl: string;
  tokenUrl: string;
  scopes: string[];
  /// Apple posts the callback (response_mode=form_post); the others redirect.
  responseMode?: 'form_post';
}

function providerConfig(id: OAuthProviderId): ProviderConfig {
  switch (id) {
    case 'google':
      return {
        id, label: 'Google',
        authorizeUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
        tokenUrl: 'https://oauth2.googleapis.com/token',
        scopes: ['openid', 'email', 'profile'],
      };
    case 'microsoft': {
      const tenant = env.MICROSOFT_TENANT_ID || 'common';
      return {
        id, label: 'Microsoft',
        authorizeUrl: `https://login.microsoftonline.com/${tenant}/oauth2/v2.0/authorize`,
        tokenUrl: `https://login.microsoftonline.com/${tenant}/oauth2/v2.0/token`,
        scopes: ['openid', 'email', 'profile'],
      };
    }
    case 'apple':
      return {
        id, label: 'Apple',
        authorizeUrl: 'https://appleid.apple.com/auth/authorize',
        tokenUrl: 'https://appleid.apple.com/auth/token',
        scopes: ['name', 'email'],
        responseMode: 'form_post',
      };
  }
}

export function isProviderConfigured(id: OAuthProviderId): boolean {
  switch (id) {
    case 'google': return Boolean(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET);
    case 'microsoft': return Boolean(env.MICROSOFT_CLIENT_ID && env.MICROSOFT_CLIENT_SECRET);
    case 'apple':
      return Boolean(env.APPLE_CLIENT_ID && env.APPLE_TEAM_ID && env.APPLE_KEY_ID && env.APPLE_PRIVATE_KEY);
  }
}

/** Which social buttons the login page should render (never more than work). */
export function oauthProviders() {
  const all: OAuthProviderId[] = ['google', 'microsoft', 'apple'];
  return all
    .filter(isProviderConfigured)
    .map((id) => ({ id, label: providerConfig(id).label }));
}

/** The URL registered with the provider for this deployment. */
export function callbackUrlFor(id: OAuthProviderId): string {
  const base = env.OAUTH_REDIRECT_BASE ?? `${env.PUBLIC_URL.replace(/\/$/, '')}/api/backend/auth/oauth`;
  return `${base.replace(/\/$/, '')}/${id}/callback`;
}

const OAUTH_STATE_TTL_MS = 10 * 60_000;

export function newOAuthState(): { state: string; expiresAt: Date } {
  return { state: crypto.randomBytes(24).toString('base64url'), expiresAt: new Date(Date.now() + OAUTH_STATE_TTL_MS) };
}

/** Build the provider consent-screen URL for the redirect step. */
export function authorizeUrl(id: OAuthProviderId, state: string): string {
  if (!isProviderConfigured(id)) {
    throw new ApiError(503, 'OAUTH_NOT_CONFIGURED', `${providerConfig(id).label} sign-in is not configured on this deployment.`);
  }
  const cfg = providerConfig(id);
  const clientId = id === 'google' ? env.GOOGLE_CLIENT_ID : id === 'microsoft' ? env.MICROSOFT_CLIENT_ID : env.APPLE_CLIENT_ID;
  const params = new URLSearchParams({
    client_id: clientId ?? '',
    redirect_uri: callbackUrlFor(id),
    response_type: 'code',
    scope: cfg.scopes.join(' '),
    state,
    // Google honours the exact redirect; Microsoft needs this for account choice.
    prompt: id === 'microsoft' ? 'select_account' : 'consent',
  });
  if (cfg.responseMode) params.set('response_mode', cfg.responseMode);
  return `${cfg.authorizeUrl}?${params.toString()}`;
}

// ---------------------------------------------------------------------------
// Token exchange + claims
// ---------------------------------------------------------------------------

/** Decode a JWT payload WITHOUT verification — safe here because the token
 * arrived directly from the provider's token endpoint over TLS in exchange for
 * our client secret (it is not user-supplied input). */
function decodeIdToken(idToken: string): Record<string, unknown> {
  const parts = idToken.split('.');
  if (parts.length !== 3 || !parts[1]) throw badRequest('OAUTH_FAILED', 'Provider returned a malformed identity token.');
  try {
    return JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8')) as Record<string, unknown>;
  } catch {
    throw badRequest('OAUTH_FAILED', 'Provider returned an unreadable identity token.');
  }
}

/** Apple signs the client assertion with a service key (ES256, 5-min TTL). */
function appleClientSecret(): string {
  const { APPLE_TEAM_ID, APPLE_KEY_ID, APPLE_CLIENT_ID, APPLE_PRIVATE_KEY } = env;
  if (!APPLE_TEAM_ID || !APPLE_KEY_ID || !APPLE_CLIENT_ID || !APPLE_PRIVATE_KEY) {
    throw badRequest('OAUTH_FAILED', 'Apple sign-in is not fully configured.');
  }
  const pem = APPLE_PRIVATE_KEY.replace(/\\n/g, '\n').trim();
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: 'ES256', kid: APPLE_KEY_ID, typ: 'JWT' };
  const payload = {
    iss: APPLE_TEAM_ID,
    sub: APPLE_CLIENT_ID,
    aud: 'https://appleid.apple.com',
    iat: now,
    exp: now + 300,
  };
  const signingInput = `${Buffer.from(JSON.stringify(header)).toString('base64url')}.${Buffer.from(JSON.stringify(payload)).toString('base64url')}`;
  const signature = crypto.createSign('SHA256').update(signingInput).sign(pem, 'base64url');
  return `${signingInput}.${signature}`;
}

export interface OAuthClaims {
  externalId: string;
  email: string | null;
  emailVerified: boolean;
  name: string | null;
  avatar: string | null;
}

interface TokenResponse {
  access_token?: string;
  id_token?: string;
  error?: string;
  error_description?: string;
}

/** Exchange the authorization code at the provider's token endpoint. */
export async function exchangeCode(id: OAuthProviderId, code: string): Promise<TokenResponse> {
  const cfg = providerConfig(id);
  const clientId = id === 'google' ? env.GOOGLE_CLIENT_ID : id === 'microsoft' ? env.MICROSOFT_CLIENT_ID : env.APPLE_CLIENT_ID;
  const clientSecret = id === 'apple' ? appleClientSecret()
    : id === 'google' ? env.GOOGLE_CLIENT_SECRET
    : env.MICROSOFT_CLIENT_SECRET;

  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    code,
    redirect_uri: callbackUrlFor(id),
    client_id: clientId ?? '',
    client_secret: clientSecret ?? '',
  });

  let res: Response;
  try {
    res = await fetch(cfg.tokenUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
      body: body.toString(),
      signal: AbortSignal.timeout(15_000),
    });
  } catch {
    throw new ApiError(502, 'OAUTH_UNREACHABLE', 'The sign-in provider could not be reached. Please try again.');
  }
  const json = (await res.json().catch(() => ({}))) as TokenResponse;
  if (!res.ok || json.error) {
    throw badRequest('OAUTH_FAILED', `The provider rejected the sign-in (${json.error ?? res.status}). Please try again.`);
  }
  return json;
}

/** Pull the identity claims out of the provider's token response. */
export function claimsFrom(id: OAuthProviderId, tokens: TokenResponse, formUserJson?: string): OAuthClaims {
  const raw = tokens.id_token ? decodeIdToken(tokens.id_token) : {};
  const str = (v: unknown) => (typeof v === 'string' && v.length > 0 ? v : null);

  let email = str(raw.email) ?? str(raw.preferred_username);
  let name = str(raw.name);
  let avatar = str(raw.picture);

  // Apple sends name ONLY on the very first login, inside the form_post `user` field.
  if (id === 'apple' && formUserJson) {
    try {
      const u = JSON.parse(formUserJson) as { name?: { firstName?: string; lastName?: string }; email?: string };
      const full = [u.name?.firstName, u.name?.lastName].filter(Boolean).join(' ').trim();
      if (full) name = full;
      if (!email && u.email) email = u.email;
    } catch { /* best-effort: the id_token still carries sub + email */ }
  }
  // Microsoft may surface the signed-in principal as preferred_username when
  // the email claim is absent (personal accounts).
  if (id === 'microsoft' && !email) email = str(raw.upn);

  const externalId = str(raw.sub) ?? str(raw.oid);
  if (!externalId) throw badRequest('OAUTH_FAILED', 'The provider did not return a stable account id.');

  return {
    externalId,
    email: email ? email.toLowerCase() : null,
    emailVerified: raw.email_verified === true || raw.verified === true || raw.email_verified === 'true',
    name,
    avatar,
  };
}

// ---------------------------------------------------------------------------
// Account resolution — link, never duplicate
// ---------------------------------------------------------------------------

const USERNAME_RE = /[^a-z0-9_]+/g;

function usernameCandidates(email: string | null, name: string | null): string[] {
  const fromEmail = (email ?? '').split('@')[0]?.toLowerCase().replace(USERNAME_RE, '_').slice(0, 16) ?? '';
  const fromName = (name ?? '').toLowerCase().replace(USERNAME_RE, '_').slice(0, 16);
  const out: string[] = [];
  for (const base of [fromEmail, fromName, 'player']) {
    const cleaned = base.replace(/^_+|_+$/g, '').slice(0, 16);
    if (cleaned.length >= 3) out.push(cleaned);
  }
  return out.length > 0 ? out : ['player'];
}

export interface SocialSession {
  accessToken: string;
  refreshToken: string;
  userId: string;
  isNewUser: boolean;
  profileComplete: boolean;
}

/**
 * Resolve the provider identity to exactly one CLUTCHNEX account and issue a
 * session. Order: linked identity → same-email account (link it) → create.
 * The final authority against duplicates is the unique index on
 * (provider, providerAccountId) plus the unique email column.
 */
export async function resolveSocialLogin(
  id: OAuthProviderId,
  claims: OAuthClaims,
  ctx: RequestContext = {},
): Promise<SocialSession> {
  const provider = PROVIDER_STORAGE[id];

  const existingLink = await prisma.oauthAccount.findUnique({
    where: { provider_providerAccountId: { provider, providerAccountId: claims.externalId } },
    select: { userId: true },
  });

  let user = existingLink
    ? await prisma.user.findUnique({ where: { id: existingLink.userId } })
    : null;
  let isNewUser = false;

  if (!user && claims.email) {
    user = await prisma.user.findUnique({ where: { email: claims.email } });
    if (user && user.deletedAt) user = null; // archived accounts never resurrect via OAuth
  }

  if (!user) {
    isNewUser = true;
    // Unique referral code, same generator behaviour as password registration.
    let referralCode = `CLUTCH-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;
    while (await prisma.user.findUnique({ where: { referralCode }, select: { id: true } })) {
      referralCode = `CLUTCH-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;
    }

    // Pick a free username deterministically, falling back to random suffixes.
    let username: string | null = null;
    for (const base of usernameCandidates(claims.email, claims.name)) {
      const candidate = base;
      if (!(await prisma.user.findUnique({ where: { username: candidate }, select: { id: true } }))) {
        username = candidate;
        break;
      }
    }
    if (!username) {
      for (let i = 0; i < 5; i++) {
        const candidate = `player_${crypto.randomBytes(2).toString('hex')}`;
        if (!(await prisma.user.findUnique({ where: { username: candidate }, select: { id: true } }))) {
          username = candidate;
          break;
        }
      }
    }
    if (!username) throw new ApiError(500, 'INTERNAL_ERROR', 'Could not allocate a username — please retry.');

    const email = claims.email ?? `${crypto.randomUUID()}@social.invalid`;
    user = await prisma.user.create({
      data: {
        username,
        email,
        // Social accounts are password-less by design — identity proof comes
        // from the linked OAuth row, never from a locally stored secret.
        passwordHash: null,
        authProvider: provider,
        status: 'ACTIVE',
        // Provider-verified emails count as verified; unverified providers
        // simply skip the badge (the optional track never gates anything).
        isVerified: claims.emailVerified,
        verifiedAt: claims.emailVerified ? new Date() : null,
        avatar: claims.avatar,
        referralCode,
        profile: { create: { fullName: claims.name || username } },
        wallet: { create: {} },
      },
    });
  } else if (user.status === 'BANNED' || user.status === 'SUSPENDED') {
    throw forbidden('This account is not active. Contact support for help.');
  } else if (user.deletedAt) {
    throw forbidden('This account is no longer available.');
  }

  // Link (or re-stamp) the provider identity on the resolved account.
  await prisma.oauthAccount.upsert({
    where: { provider_providerAccountId: { provider, providerAccountId: claims.externalId } },
    create: { userId: user.id, provider, providerAccountId: claims.externalId, email: claims.email },
    update: { lastUsedAt: new Date(), ...(claims.email ? { email: claims.email } : {}) },
  });
  if (isNewUser === false && user.avatar === null && claims.avatar) {
    await prisma.user.update({ where: { id: user.id }, data: { avatar: claims.avatar } }).catch(() => null);
  }

  await prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });

  // Session — identical machinery to password login (hashed rotating refresh
  // token + short-lived JWT). No passwords were checked or stored.
  const accessToken = signAccessToken({ sub: user.id, role: user.role, username: user.username });
  const refreshToken = newOpaqueToken();
  await prisma.authToken.create({
    data: {
      userId: user.id,
      type: 'REFRESH',
      tokenHash: hashToken(refreshToken),
      expiresAt: new Date(Date.now() + env.JWT_REFRESH_TTL_DAYS * 24 * 3_600_000),
      ip: ctx.ip,
      userAgent: ctx.userAgent,
    },
  });

  const profile = await prisma.userProfile.findUnique({
    where: { userId: user.id },
    select: { freeFireUID: true, freeFireIGN: true },
  });
  const profileComplete = isProfileComplete({
    phone: user.phone, freeFireUID: profile?.freeFireUID ?? null, freeFireIGN: profile?.freeFireIGN ?? null,
  });

  await audit({
    actorId: user.id,
    action: isNewUser ? 'OAUTH_REGISTERED' : 'OAUTH_LOGIN',
    entity: 'User',
    entityId: user.id,
    after: { provider, isNewUser, email: claims.email ?? null },
    ip: ctx.ip,
    userAgent: ctx.userAgent,
  });

  return { accessToken, refreshToken, userId: user.id, isNewUser, profileComplete };
}

// ---------------------------------------------------------------------------
// Free Fire player profile completeness (shared with auth.service)
// ---------------------------------------------------------------------------

/**
 * The mandatory Free Fire player profile: UID + in-game name + phone number.
 * Tournament registration is gated on this, server-side — the same profile is
 * required no matter which provider (or password) the account signed in with.
 */
export function isProfileComplete(p: {
  phone: string | null; freeFireUID: string | null; freeFireIGN: string | null;
}): boolean {
  const phoneOk = /^\+?\d{7,15}$/.test((p.phone ?? '').replace(/[\s-]/g, ''));
  const uidOk = /^\d{5,15}$/.test((p.freeFireUID ?? '').trim());
  const ignOk = (p.freeFireIGN ?? '').trim().length >= 2 && (p.freeFireIGN ?? '').trim().length <= 24;
  return phoneOk && uidOk && ignOk;
}

export function missingProfileFields(p: {
  phone: string | null; freeFireUID: string | null; freeFireIGN: string | null;
}): string[] {
  const out: string[] = [];
  if (!/^\d{5,15}$/.test((p.freeFireUID ?? '').trim())) out.push('freeFireUID');
  const ign = (p.freeFireIGN ?? '').trim();
  if (ign.length < 2 || ign.length > 24) out.push('freeFireIGN');
  if (!/^\+?\d{7,15}$/.test((p.phone ?? '').replace(/[\s-]/g, ''))) out.push('phone');
  return out;
}

