import { NextRequest, NextResponse } from 'next/server';
import { getEndpoint, markHealthy, markUnhealthy } from '@/lib/db';

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const endpoint = await getEndpoint(id);

  if (!endpoint) {
    return NextResponse.json({ error: 'Endpoint not found' }, { status: 404 });
  }

  try {
    const response = await fetch(`${endpoint.url}/models`, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${endpoint.api_key}`,
      },
    });

    if (!response.ok) {
      const text = await response.text();
      if (response.status === 500) {
        await markUnhealthy(endpoint.id);
      } else {
        await markHealthy(endpoint.id);
      }
      return NextResponse.json({ error: `HTTP ${response.status}: ${text}` }, { status: response.status });
    }

    const data = await response.json();
    await markHealthy(endpoint.id);
    return NextResponse.json(data);
  } catch (error) {
    await markUnhealthy(endpoint.id);
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
