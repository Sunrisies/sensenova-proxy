import { NextRequest, NextResponse } from 'next/server';

export async function POST(request: NextRequest) {
  try {
    const { url, api_key } = await request.json();

    if (!url || !api_key) {
      return NextResponse.json({ error: 'url and api_key are required' }, { status: 400 });
    }

    const baseUrl = url.replace(/\/$/, '');
    const response = await fetch(`${baseUrl}/models`, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${api_key}`,
      },
    });

    if (!response.ok) {
      const text = await response.text();
      return NextResponse.json({ error: `HTTP ${response.status}: ${text}` }, { status: response.status });
    }

    const data = await response.json();
    return NextResponse.json(data);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
