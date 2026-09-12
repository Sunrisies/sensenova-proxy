import { NextRequest, NextResponse } from 'next/server';
import { getUsageTrends } from '@/lib/db';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const range = request.nextUrl.searchParams.get('range') ?? '24h';
  const days = range === '30d' ? 30 : range === '7d' ? 7 : 1;
  const bucketSeconds = days === 1 ? 3600 : days === 7 ? 6 * 3600 : 24 * 3600;
  const now = Math.floor(Date.now() / 1000);
  const since = now - days * 86400;
  return NextResponse.json({ range, since, bucketSeconds, points: await getUsageTrends(since, bucketSeconds) });
}
