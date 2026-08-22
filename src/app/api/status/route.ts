import { NextResponse } from 'next/server';
import { getAllEndpoints } from '@/lib/db';

export const dynamic = 'force-dynamic';

export async function GET() {
  const endpoints = await getAllEndpoints();
  const status = endpoints.map(e => ({
    id: e.id,
    name: e.name,
    url: e.url,
    enabled: e.enabled,
    healthy: e.healthy,
    priority: e.priority,
    weight: e.weight,
    error_count: e.error_count,
    last_check: e.last_check,
  }));

  return NextResponse.json({
    total: status.length,
    healthy: status.filter(s => s.healthy).length,
    unhealthy: status.filter(s => !s.healthy).length,
    endpoints: status,
  });
}
