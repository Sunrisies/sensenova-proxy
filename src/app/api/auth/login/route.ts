import { NextRequest, NextResponse } from 'next/server';
import { createAdminSession, getAdminCookieName, SESSION_MAX_AGE } from '@/lib/auth';
import { clearLoginAttempt, getLoginAttempt, recordLoginFailure } from '@/lib/db';
import crypto from 'node:crypto';
const MAX_FAILURES = 5;
const LOCK_SECONDS = 15 * 60;

export async function POST(request: NextRequest) {
  const { username, password } = await request.json().catch(() => ({}));
  const client = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'unknown';
  const key = `${client}:${String(username ?? '')}`;
  const attempt = await getLoginAttempt(key);
  if (attempt && attempt.locked_until > Math.floor(Date.now() / 1000)) {
    return NextResponse.json({ error: '登录失败次数过多，请稍后再试' }, { status: 429 });
  }
  if (!process.env.ADMIN_USERNAME || !process.env.ADMIN_PASSWORD_HASH) {
    return NextResponse.json({ error: 'Admin credentials are not configured' }, { status: 503 });
  }
  if (username !== process.env.ADMIN_USERNAME || !verifyPassword(String(password ?? ''), process.env.ADMIN_PASSWORD_HASH)) {
    await recordLoginFailure(key, MAX_FAILURES, LOCK_SECONDS);
    return NextResponse.json({ error: 'Invalid credentials' }, { status: 401 });
  }
  await clearLoginAttempt(key);
  const response = NextResponse.json({ success: true });
  response.cookies.set(getAdminCookieName(), await createAdminSession(), {
    httpOnly: true,
    sameSite: 'strict',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: SESSION_MAX_AGE,
  });
  return response;
}

function verifyPassword(password: string, encoded: string): boolean {
  const [algorithm, saltText, hashText] = encoded.split(':');
  if (algorithm !== 'scrypt' || !saltText || !hashText) return false;
  try {
    const salt = Buffer.from(saltText, 'base64url');
    const expected = Buffer.from(hashText, 'base64url');
    const actual = crypto.scryptSync(password, salt, expected.length, { N: 16384, r: 8, p: 1 });
    return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
  } catch {
    return false;
  }
}
