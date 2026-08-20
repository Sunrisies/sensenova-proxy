import { NextRequest, NextResponse } from 'next/server';
import { getAllEndpoints, createEndpoint, type CreateEndpointInput } from '@/lib/db';

export async function GET() {
  const endpoints = getAllEndpoints();
  // Mask API keys in response
  const masked = endpoints.map(e => ({
    ...e,
    api_key: e.api_key.slice(0, 6) + '***' + e.api_key.slice(-4),
  }));
  return NextResponse.json(masked);
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json() as CreateEndpointInput;

    if (!body.name || !body.url || !body.api_key) {
      return NextResponse.json({ error: 'name, url, api_key are required' }, { status: 400 });
    }

    const endpoint = createEndpoint(body);
    return NextResponse.json(endpoint, { status: 201 });
  } catch (error) {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
  }
}
