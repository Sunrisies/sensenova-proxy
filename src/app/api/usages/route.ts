import { NextResponse } from 'next/server';
import { getEnabledEndpoints } from '@/lib/db';
import { getEndpointQuota } from '@/lib/quota';

export const dynamic = 'force-dynamic';

export async function GET() {
  const endpoints = getEnabledEndpoints();
  return NextResponse.json({ endpoints: await Promise.all(endpoints.map(getEndpointQuota)) });
}
