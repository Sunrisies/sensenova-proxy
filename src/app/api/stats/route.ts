import { NextRequest, NextResponse } from 'next/server';
import { getAllEndpoints, getLoggedModels, getUsageStats } from '@/lib/db';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const range = params.get('range') ?? '24h';
  const now = Math.floor(Date.now() / 1000);
  const since = range === 'all' ? undefined : range === 'today'
    ? Math.floor(new Date().setHours(0, 0, 0, 0) / 1000)
    : now - (range === '7d' ? 7 : range === '30d' ? 30 : 1) * 86400;
  const endpointId = params.get('endpoint_id') || undefined;
  const model = params.get('model') || undefined;
  const endpoints = (await getAllEndpoints()).map(endpoint => ({
    id: endpoint.id,
    name: endpoint.name,
    api_key: endpoint.api_key.slice(0, 6) + '***' + endpoint.api_key.slice(-4),
  }));
  return NextResponse.json({ range, since, endpoints, models: await getLoggedModels(), stats: await getUsageStats({ since, endpointId, model }) });
}
