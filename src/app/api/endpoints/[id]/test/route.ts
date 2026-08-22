import { NextRequest, NextResponse } from 'next/server';
import { addLog, getEndpoint, markHealthy, markUnhealthy } from '@/lib/db';

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const endpoint = await getEndpoint(id);

  if (!endpoint) {
    return NextResponse.json({ error: 'Endpoint not found' }, { status: 404 });
  }

  try {
    const { model } = await request.json();

    if (!model) {
      return NextResponse.json({ error: 'model is required' }, { status: 400 });
    }

    const startTime = Date.now();

    const response = await fetch(`${endpoint.url}/chat/completions`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${endpoint.api_key}`,
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
      if (response.status === 500) {
        await markUnhealthy(endpoint.id);
      } else {
        await markHealthy(endpoint.id);
      }
      await addLog({ endpoint_id: endpoint.id, endpoint_name: endpoint.name, method: 'POST', path: 'chat/completions', status: response.status, duration, success: false, switched: false, error: text, model, stream: false, is_test: true });
      return NextResponse.json({
        success: false,
        status: response.status,
        duration,
        error: `HTTP ${response.status}: ${text}`,
      });
    }

    const data = await response.json();
    const content = data.choices?.[0]?.message?.content ?? '';
    const usage = data.usage ?? {};
    await addLog({ endpoint_id: endpoint.id, endpoint_name: endpoint.name, method: 'POST', path: 'chat/completions', status: response.status, duration, success: true, switched: false, model: data.model ?? model, stream: false, prompt_tokens: usage.prompt_tokens, completion_tokens: usage.completion_tokens, total_tokens: usage.total_tokens, is_test: true });
    await markHealthy(endpoint.id);

    return NextResponse.json({
      success: true,
      status: response.status,
      duration,
      content,
      model: data.model,
    });
  } catch (error) {
    await markUnhealthy(endpoint.id);
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({
      success: false,
      status: 0,
      duration: 0,
      error: message,
    });
  }
}
