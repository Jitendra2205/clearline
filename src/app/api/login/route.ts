import { NextResponse } from 'next/server';
import { checkPassword, issueToken, SESSION_COOKIE, authEnabled } from '@/lib/security/auth';

export const runtime = 'nodejs';

export async function POST(req: Request) {
  if (!authEnabled()) {
    return NextResponse.json({ ok: true, note: 'No password configured; the gate is off.' });
  }
  const { password } = (await req.json()) as { password?: string };
  if (typeof password !== 'string' || !checkPassword(password)) {
    // Constant-ish delay so the endpoint is not a cheap oracle.
    await new Promise((r) => setTimeout(r, 400));
    return NextResponse.json({ error: 'Incorrect password.' }, { status: 401 });
  }
  const token = issueToken();
  const res = NextResponse.json({ ok: true });
  res.cookies.set(SESSION_COOKIE, token.value, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: token.maxAge,
  });
  return res;
}
