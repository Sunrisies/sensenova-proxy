import { NextRequest, NextResponse } from 'next/server';
import { getAllEndpoints, createEndpoint, type CreateEndpointInput } from '@/lib/db';
import { encryptQuotaInput, getQuotaAuthorization } from '@/lib/quota';

export async function GET() {
  const endpoints = getAllEndpoints();
  // Mask API keys in response
  const masked = endpoints.map(e => ({
    id: e.id,
    name: e.name,
    url: e.url,
    api_key: e.api_key.slice(0, 6) + '***' + e.api_key.slice(-4),
    priority: e.priority,
    weight: e.weight,
    enabled: e.enabled,
    healthy: e.healthy,
    error_count: e.error_count,
    ...getQuotaAuthorization(e),
  }));
  return NextResponse.json(masked);
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json() as CreateEndpointInput;

    if (!body.name || !body.url || !body.api_key) {
      return NextResponse.json({ error: 'name, url, api_key are required' }, { status: 400 });
    }

    const quotaInput = encryptQuotaInput(body);
    const endpoint = createEndpoint({ ...body, ...quotaInput });
    return NextResponse.json({ id: endpoint.id, ...getQuotaAuthorization(endpoint) }, { status: 201 });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Invalid request body' }, { status: 400 });
  }
}
