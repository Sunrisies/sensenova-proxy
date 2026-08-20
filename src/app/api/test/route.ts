import { NextRequest, NextResponse } from 'next/server';

export async function POST(request: NextRequest) {
  try {
    const { url, api_key, model } = await request.json();

    if (!url || !api_key || !model) {
      return NextResponse.json({ error: 'url, api_key, and model are required' }, { status: 400 });
    }

    const baseUrl = url.replace(/\/$/, '');
    const startTime = Date.now();

    const response = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${api_key}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model,
        messages: [{ role: 'user', content: 'Hi, reply with one word: OK' }],
        max_tokens: 10,
      }),
    });

    const duration = Date.now() - startTime;

    if (!response.ok) {
      const text = await response.text();
      return NextResponse.json({
        success: false,
        status: response.status,
        duration,
        error: `HTTP ${response.status}: ${text}`,
      });
    }

    const data = await response.json();
    const content = data.choices?.[0]?.message?.content ?? '';

    return NextResponse.json({
      success: true,
      status: response.status,
      duration,
      content,
      model: data.model,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({
      success: false,
      status: 0,
      duration: 0,
      error: message,
    });
  }
}
