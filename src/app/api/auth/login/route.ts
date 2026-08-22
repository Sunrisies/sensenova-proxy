import { NextRequest, NextResponse } from 'next/server';
import { createAdminSession, getAdminCookieName, SESSION_MAX_AGE } from '@/lib/auth';

export async function POST(request: NextRequest) {
  const { username, password } = await request.json().catch(() => ({}));
  if (!process.env.ADMIN_USERNAME || !process.env.ADMIN_PASSWORD) {
    return NextResponse.json({ error: 'Admin credentials are not configured' }, { status: 503 });
  }
  if (username !== process.env.ADMIN_USERNAME || password !== process.env.ADMIN_PASSWORD) {
    return NextResponse.json({ error: 'Invalid credentials' }, { status: 401 });
  }
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
