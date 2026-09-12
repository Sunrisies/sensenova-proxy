import { NextRequest } from 'next/server';
import { addLog, getEndpoint, markHealthy, markUnhealthy } from '@/lib/db';
import { emitLog } from '@/lib/proxy';
import { estimatePromptTokens, usageWithFallback, type TokenUsage } from '@/lib/tokens';

const REQUEST_TIMEOUT = Number(process.env.PROXY_REQUEST_TIMEOUT_MS || 120000);
const TEST_MESSAGE = 'Hi, reply with one sentence.';

function testLog(endpoint: NonNullable<Awaited<ReturnType<typeof getEndpoint>>>, values: Record<string, unknown>) {
  return {
    endpoint_id: endpoint.id, endpoint_name: endpoint.name,
    method: 'POST', path: 'chat/completions', switched: false,
    model: values.model, stream: values.stream, is_test: true, ...values,
  };
}

async function saveTestLog(log: Record<string, unknown>) {
  await addLog(log as Parameters<typeof addLog>[0]);
  emitLog({ ...log, created_at: Math.floor(Date.now() / 1000) });
}

export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return Response.json({
    error: 'This endpoint requires POST',
    message: '请使用 POST，并传入 { model: string, stream?: boolean }',
    endpoint_id: id,
  }, { status: 405, headers: { Allow: 'POST' } });
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const endpoint = await getEndpoint(id);
  if (!endpoint) return Response.json({ error: `Endpoint not found: ${id}`, endpoint_id: id }, { status: 404 });

  const body = await request.json() as { model?: string; stream?: boolean };
  const model = body.model;
  const stream = body.stream === true;
  if (!model) return Response.json({ error: 'model is required' }, { status: 400 });

  const startTime = Date.now();
  const promptTokens = estimatePromptTokens([{ role: 'user', content: TEST_MESSAGE }]);

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT);
    const response = await fetch(`${endpoint.url}/chat/completions`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${endpoint.api_key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model,
        messages: [{ role: 'user', content: TEST_MESSAGE }],
        ...(stream ? { stream: true, stream_options: { include_usage: true } } : { max_tokens: 10 }),
      }),
      signal: controller.signal,
    });
    clearTimeout(timeoutId);

    if (!response.ok) {
      const text = await response.text();
      if (response.status === 500) await markUnhealthy(endpoint.id); else await markHealthy(endpoint.id);
      const log = testLog(endpoint, { status: response.status, duration: Date.now() - startTime, success: false, error: text, model, stream });
      await saveTestLog(log);
      return Response.json({ success: false, status: response.status, duration: Date.now() - startTime, error: `HTTP ${response.status}: ${text}` }, { status: response.status });
    }

    await markHealthy(endpoint.id);
    if (!stream || !response.body) {
      const data = await response.json() as { model?: string; choices?: { message?: { content?: string } }[]; usage?: TokenUsage };
      const content = data.choices?.[0]?.message?.content ?? '';
      const usage = usageWithFallback(data.usage ?? {}, promptTokens, content);
      const duration = Date.now() - startTime;
      const log = testLog(endpoint, { status: response.status, duration, success: true, model: data.model ?? model, stream: false, ...usage });
      await saveTestLog(log);
      return Response.json({ success: true, status: response.status, duration, content, model: data.model ?? model, usage });
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let content = '';
    let firstByteMs: number | undefined;
    let usage: TokenUsage = {};
    let finalized = false;

    const parseLine = (line: string) => {
      if (!line.startsWith('data:')) return;
      const value = line.slice(5).trim();
      if (!value || value === '[DONE]') return;
      try {
        const event = JSON.parse(value) as { choices?: { delta?: { content?: string } }[]; usage?: TokenUsage };
        const delta = event.choices?.[0]?.delta?.content;
        if (typeof delta === 'string') content += delta;
        if (event.usage) usage = { ...usage, ...event.usage };
      } catch {
        // Ignore non-JSON SSE comments or partial provider events.
      }
    };

    const finalize = async (error?: string, status = error ? 502 : response.status) => {
      if (finalized) return;
      finalized = true;
      const finalUsage = usageWithFallback(usage, promptTokens, content);
      const log = testLog(endpoint, {
        status, duration: Date.now() - startTime, success: !error, error,
        model, stream: true, first_byte_ms: firstByteMs, ...finalUsage,
      });
      await saveTestLog(log);
      return finalUsage;
    };

    const output = new ReadableStream<Uint8Array>({
      async pull(streamController) {
        try {
          const { done, value } = await reader.read();
          if (done) {
            buffer += decoder.decode();
            for (const line of buffer.split('\n')) parseLine(line);
            const finalUsage = await finalize();
            streamController.enqueue(new TextEncoder().encode(`data: ${JSON.stringify({ test_result: { usage: finalUsage, duration: Date.now() - startTime, ttfb: firstByteMs, content } })}\n\n`));
            streamController.close();
            return;
          }
          const text = decoder.decode(value, { stream: true });
          if (firstByteMs === undefined && text.trim()) firstByteMs = Date.now() - startTime;
          buffer += text;
          const lines = buffer.split('\n');
          buffer = lines.pop() ?? '';
          for (const line of lines) parseLine(line);
          streamController.enqueue(value);
        } catch (error) {
          const message = error instanceof Error ? error.message : 'Stream failed';
          await finalize(message);
          streamController.error(error);
        }
      },
      async cancel(reason) {
        await finalize(`SSE stream cancelled: ${String(reason ?? 'client disconnected')}`, 499);
          try { await reader.cancel(reason); } catch { /* already closed */ }
      },
    });

    return new Response(output, { status: response.status, headers: {
      'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive',
      'Access-Control-Allow-Origin': '*',
    } });
  } catch (error) {
    await markUnhealthy(endpoint.id);
    const message = error instanceof Error ? error.message : 'Unknown error';
    const log = testLog(endpoint, { status: 0, duration: Date.now() - startTime, success: false, error: message, model, stream });
    await saveTestLog(log);
    return Response.json({ success: false, status: 0, duration: Date.now() - startTime, error: message }, { status: 500 });
  }
}
