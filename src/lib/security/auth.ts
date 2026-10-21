import { createHmac, timingSafeEqual } from 'node:crypto';
import { cookies } from 'next/headers';

/**
 * A deliberately small auth gate. Switched off for the public demo; see authEnabled().
 *
 * Multi-tenant auth and SSO are explicitly out of scope (see the one-pager) —
 * but "out of scope" cannot mean "no gate at all", because the data here is
 * commercially sensitive vendor pricing. So: one shared password, an HMAC
 * session cookie, and every route behind it.
 *
 * What this is NOT: a user model, roles, or per-vendor scoping. A real build
 * needs row-level scoping by organisation so vendors can never see each other's
 * pricing. The schema carries org_id for exactly that reason; enforcing it is
 * the first thing after the demo.
 */

const COOKIE = 'clearline_session';
const TTL_MS = 12 * 60 * 60 * 1000;

function secret(): string {
  return process.env.CLEARLINE_PASSWORD ?? '';
}

/** Off for the public demo. Restore `secret().length > 0` to gate every route again. */
export function authEnabled(): boolean {
  // shortcut: no gate, so delete, upload and extract are open to anyone with the URL; restore before sharing with anyone untrusted
  return false;
}

function sign(expiry: number): string {
  return createHmac('sha256', secret()).update(String(expiry)).digest('hex');
}

export function issueToken(): { value: string; maxAge: number } {
  const expiry = Date.now() + TTL_MS;
  return { value: `${expiry}.${sign(expiry)}`, maxAge: TTL_MS / 1000 };
}

export function verifyToken(token: string | undefined): boolean {
  if (!authEnabled()) return true;
  if (!token) return false;
  const [expiryRaw, mac] = token.split('.');
  const expiry = Number(expiryRaw);
  if (!Number.isFinite(expiry) || expiry < Date.now() || !mac) return false;
  const expected = sign(expiry);
  if (mac.length !== expected.length) return false;
  return timingSafeEqual(Buffer.from(mac), Buffer.from(expected));
}

export function checkPassword(candidate: string): boolean {
  const s = secret();
  if (!s) return true;
  const a = Buffer.from(candidate);
  const b = Buffer.from(s);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

export const SESSION_COOKIE = COOKIE;

/** Guard for route handlers. Returns null when the request may proceed. */
export async function requireAuth(): Promise<Response | null> {
  if (!authEnabled()) return null;
  const jar = await cookies();
  if (verifyToken(jar.get(COOKIE)?.value)) return null;
  return Response.json({ error: 'Not authenticated' }, { status: 401 });
}

export async function isAuthed(): Promise<boolean> {
  if (!authEnabled()) return true;
  const jar = await cookies();
  return verifyToken(jar.get(COOKIE)?.value);
}
