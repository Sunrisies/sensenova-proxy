import { NextResponse, type NextRequest } from 'next/server';
import { isAdminRequest } from '@/lib/auth';

const publicPaths = ['/login', '/api/auth/login', '/api/auth/logout'];

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set('x-pathname', pathname);
  // Proxy Key verification occurs in the Node.js route so database-backed virtual Keys can be used.
  if (pathname.startsWith('/v1/')) return NextResponse.next({ request: { headers: requestHeaders } });
  if (publicPaths.includes(pathname)) return NextResponse.next({ request: { headers: requestHeaders } });
  if (await isAdminRequest(request)) return NextResponse.next({ request: { headers: requestHeaders } });
  if (pathname.startsWith('/api/')) return NextResponse.json({ error: 'Admin authentication required' }, { status: 401 });
  return NextResponse.redirect(new URL('/login', request.url));
}

export const config = { matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'] };
