import { createHmac, timingSafeEqual, randomBytes } from 'node:crypto';

/**
 * Short-TTL signed URLs for vendor documents.
 *
 * Quote documents are commercially sensitive and are never served from a
 * public path. Access needs a token minted server-side that expires in
 * minutes, so a link pasted into a chat stops working shortly afterwards.
 */

const TTL_MS = 5 * 60 * 1000;

// Regenerated per process. A restart invalidates outstanding links, which for
// five-minute tokens is the correct tradeoff.
const KEY = process.env.CLEARLINE_SIGNING_KEY ?? randomBytes(32).toString('hex');

export function signDocToken(docId: string): string {
  const exp = Date.now() + TTL_MS;
  const mac = createHmac('sha256', KEY).update(`${docId}.${exp}`).digest('hex');
  return `${exp}.${mac}`;
}

export function verifyDocToken(docId: string, token: string | null): boolean {
  if (!token) return false;
  const [expRaw, mac] = token.split('.');
  const exp = Number(expRaw);
  if (!Number.isFinite(exp) || exp < Date.now() || !mac) return false;
  const expected = createHmac('sha256', KEY).update(`${docId}.${exp}`).digest('hex');
  if (mac.length !== expected.length) return false;
  return timingSafeEqual(Buffer.from(mac), Buffer.from(expected));
}
