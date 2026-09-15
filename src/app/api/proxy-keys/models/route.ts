import { NextRequest, NextResponse } from 'next/server';
import { getEnabledEndpoints } from '@/lib/db';

export const dynamic = 'force-dynamic';

interface UpstreamModel { id?: unknown; name?: unknown; }

export async function GET(request: NextRequest) {
  const endpointGroup = request.nextUrl.searchParams.get('endpoint_group')?.trim() || 'default';
  const endpoints = (await getEnabledEndpoints()).filter(endpoint => endpoint.endpoint_group === endpointGroup);
  const modelIds = new Set<string>();
  const failures: string[] = [];

  await Promise.all(endpoints.map(async endpoint => {
    try {
      const response = await fetch(`${endpoint.url}/models`, { headers: { Authorization: `Bearer ${endpoint.api_key}` }, signal: AbortSignal.timeout(10_000) });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const payload = await response.json() as { data?: UpstreamModel[] } | UpstreamModel[];
      const models = Array.isArray(payload) ? payload : payload.data ?? [];
      for (const model of models) {
        const id = typeof model.id === 'string' ? model.id : typeof model.name === 'string' ? model.name : '';
        if (id) modelIds.add(id);
      }
    } catch (error) {
      failures.push(`${endpoint.name}: ${error instanceof Error ? error.message : '读取失败'}`);
    }
  }));

  return NextResponse.json({ data: [...modelIds].sort((a, b) => a.localeCompare(b)), endpoint_group: endpointGroup, endpoint_count: endpoints.length, failures });
}
