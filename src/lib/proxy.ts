import { getHealthyEndpoints, getAvailableEndpoints, markUnhealthy, markHealthy, markRateLimited, addLog, addRequestAttempt, updateRequestAttempt } from './db';
import { v4 as uuidv4 } from 'uuid';

const REQUEST_TIMEOUT = 30000;
function debugLog(msg: string) {
  console.log(`[${new Date().toISOString()}] ${msg}`);
}

type LogListener = (log: unknown) => void;
const logListeners: Set<LogListener> = new Set();

export function onLog(listener: LogListener) {
  logListeners.add(listener);
  return () => logListeners.delete(listener);
}

function emitLog(log: unknown) {
  logListeners.forEach(listener => listener(log));
}

function readUsage(payload: unknown): { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number } {
  const usage = (payload as { usage?: unknown } | null)?.usage;
  if (!usage || typeof usage !== 'object') return {};
  const value = usage as Record<string, unknown>;
  return {
    prompt_tokens: typeof value.prompt_tokens === 'number' ? value.prompt_tokens : undefined,
    completion_tokens: typeof value.completion_tokens === 'number' ? value.completion_tokens : undefined,
    total_tokens: typeof value.total_tokens === 'number' ? value.total_tokens : undefined,
  };
}

export async function proxyRequest(
  request: Request,
  path: string
): Promise<Response> {
  const method = request.method;
  const startTime = Date.now();
  const requestId = uuidv4();
  const clientIp = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
    ?? request.headers.get('x-real-ip')
    ?? 'unknown';

  let body: ArrayBuffer | null = null;
  if (method !== 'GET' && method !== 'HEAD') {
    body = await request.arrayBuffer();
  }

  let requestInfo: { model?: string; stream?: boolean } = {};
  if (body) {
    try {
      const parsed = JSON.parse(Buffer.from(body).toString('utf8')) as Record<string, unknown>;
      requestInfo = {
        model: typeof parsed.model === 'string' ? parsed.model : undefined,
        stream: parsed.stream === true,
      };
    } catch {
    }
  }

  const headers = new Headers();
  request.headers.forEach((value, key) => {
    const lower = key.toLowerCase();
    if (lower !== 'host' && lower !== 'connection') {
      headers.set(key, value);
    }
  });

  const healthyEndpoints = await getHealthyEndpoints();
  const availableEndpoints = await getAvailableEndpoints();
  const endpoints = healthyEndpoints.length > 0 ? healthyEndpoints : availableEndpoints;
  debugLog(`[PROXY] method=${method} path=${path} healthyEndpoints=${healthyEndpoints.length} availableEndpoints=${availableEndpoints.length}`);

  if (endpoints.length === 0) {
    debugLog('[PROXY] No enabled endpoints configured');
    return new Response(JSON.stringify({ error: 'No enabled endpoints available' }), {
      status: 503,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  endpoints.forEach((ep, i) => {
    debugLog(`[PROXY] endpoint[${i}] id=${ep.id} name=${ep.name} url=${ep.url} healthy=${ep.healthy}`);
  });

  let lastError: string | undefined;
  let switched = false;
  const switchChain: string[] = [];

  for (let attempt = 0; attempt < endpoints.length; attempt++) {
    const endpoint = endpoints[attempt % endpoints.length];
    const cleanPath = path.replace(/^v1\//, '');
    const query = new URL(request.url).search;
    const targetUrl = `${endpoint.url}/${cleanPath}${query}`;

    debugLog(`[PROXY] attempt=${attempt} targetUrl=${targetUrl}`);

    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT);

      const requestHeaders = new Headers(headers);
      requestHeaders.set('Authorization', `Bearer ${endpoint.api_key}`);

      debugLog(`[PROXY] fetching...`);
      const response = await fetch(targetUrl, {
        method,
        headers: requestHeaders,
        body: body ? Buffer.from(body) : undefined,
        signal: controller.signal,
      });

      clearTimeout(timeoutId);
      debugLog(`[PROXY] response status=${response.status}`);
      switchChain.push(`${endpoint.name} (${response.status})`);

      if (response.status === 429 || response.status === 500) {
        const errorText = await response.text().catch(() => 'Unknown error');
        if (response.status === 500) {
          await markUnhealthy(endpoint.id);
        } else {
          await markRateLimited(endpoint.id);
        }
        lastError = `HTTP ${response.status}: ${errorText}`;
        await addRequestAttempt({ request_id: requestId, endpoint_id: endpoint.id, endpoint_name: endpoint.name, method, path, status: response.status, duration: Date.now() - startTime, success: false, error: lastError, model: requestInfo.model });
        debugLog(`[PROXY] retryable status=${response.status}; switching endpoint`);
        switched = true;
        continue;
      }

      const attemptId = await addRequestAttempt({ request_id: requestId, endpoint_id: endpoint.id, endpoint_name: endpoint.name, method, path, status: response.status, duration: Date.now() - startTime, success: response.status < 400, model: requestInfo.model });

      const duration = Date.now() - startTime;
      await markHealthy(endpoint.id);

      const baseLog = {
        endpoint_id: endpoint.id,
        request_id: requestId,
        endpoint_name: endpoint.name,
        method,
        path,
        status: response.status,
        duration,
        success: response.status < 400,
        switched,
        error: lastError,
        switch_chain: switchChain.join(' -> '),
        model: requestInfo.model,
        stream: requestInfo.stream,
        client_ip: clientIp,
      };

      const responseHeaders = new Headers(response.headers);
      responseHeaders.set('Access-Control-Allow-Origin', '*');
      responseHeaders.set('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
      responseHeaders.set('Access-Control-Allow-Headers', '*');

      if (requestInfo.stream && response.body) {
        const decoder = new TextDecoder();
        const encoder = new TextEncoder();
        let firstByteMs: number | undefined;
        let buffer = '';
        let promptTokens: number | undefined;
        let completionTokens: number | undefined;
        let totalTokens: number | undefined;
        let finalized = false;
        let downstreamCancelled = false;
        let controllerClosed = false;

        function parseSseLine(line: string) {
          if (!line.startsWith('data:')) return;
          const value = line.slice(5).trim();
          if (!value || value === '[DONE]') return;
          try {
            const event = JSON.parse(value) as Record<string, unknown>;
            const usage = event.usage as Record<string, unknown> | undefined;
            if (usage) {
              if (typeof usage.prompt_tokens === 'number') promptTokens = usage.prompt_tokens;
              if (typeof usage.completion_tokens === 'number') completionTokens = usage.completion_tokens;
              if (typeof usage.total_tokens === 'number') totalTokens = usage.total_tokens;
            }
          } catch {
          }
        }

        async function finalize(error?: string, status = error ? 502 : baseLog.status) {
          if (finalized) return;
          finalized = true;
          const completed = {
            ...baseLog,
            status,
            success: !error && baseLog.success,
            duration: Date.now() - startTime,
            error: error ?? baseLog.error,
            first_byte_ms: firstByteMs,
            prompt_tokens: promptTokens,
            completion_tokens: completionTokens,
            total_tokens: totalTokens,
          };
          await addLog(completed);
          emitLog({ ...completed, created_at: Math.floor(Date.now() / 1000) });
          if (error) await updateRequestAttempt(attemptId, { status, success: false, error, duration: completed.duration });
        }

        const reader = response.body.getReader();
        const stream = new ReadableStream<Uint8Array>({
          async pull(controller) {
            try {
              const { done, value } = await reader.read();
              if (done) {
                const finalText = decoder.decode();
                buffer += finalText;
                for (const line of buffer.split('\n')) parseSseLine(line);
                await finalize(downstreamCancelled ? 'SSE stream cancelled: client disconnected' : undefined, downstreamCancelled ? 499 : baseLog.status);
                if (!controllerClosed) {
                  controllerClosed = true;
                  controller.close();
                }
                return;
              }
              const text = decoder.decode(value, { stream: true });
              if (firstByteMs === undefined && text.trim()) firstByteMs = Date.now() - startTime;
              buffer += text;
              const lines = buffer.split('\n');
              buffer = lines.pop() ?? '';
              for (const line of lines) parseSseLine(line);
              if (!downstreamCancelled && !controllerClosed) controller.enqueue(value);
            } catch (error) {
              if (downstreamCancelled) {
                await finalize('SSE stream cancelled: client disconnected', 499);
                return;
              }
              await finalize(`SSE stream failed: ${error instanceof Error ? error.message : String(error)}`);
              if (!controllerClosed) {
                controllerClosed = true;
                controller.error(error);
              }
            }
          },
          async cancel(reason) {
            downstreamCancelled = true;
            try {
              while (true) {
                const { done, value } = await reader.read();
                if (done) break;
                const text = decoder.decode(value, { stream: true });
                buffer += text;
                const lines = buffer.split('\n');
                buffer = lines.pop() ?? '';
                for (const line of lines) parseSseLine(line);
              }
              buffer += decoder.decode();
              for (const line of buffer.split('\n')) parseSseLine(line);
              await finalize(`SSE stream cancelled: ${String(reason ?? 'client disconnected')}`, 499);
            } catch {
              await finalize(`SSE stream cancelled: client disconnected`, 499);
            }
          },
        });

        return new Response(stream, {
          status: response.status,
          statusText: response.statusText,
          headers: responseHeaders,
        });
      }

      let usage: ReturnType<typeof readUsage> = {};
      if (response.status < 400 && typeof response.clone === 'function') {
        try {
          usage = readUsage(await response.clone().json());
        } catch {
        }
      }
      const logEntry = { ...baseLog, ...usage };
      await addLog(logEntry);
      emitLog({ ...logEntry, created_at: Math.floor(Date.now() / 1000) });

      return new Response(response.body, {
        status: response.status,
        statusText: response.statusText,
        headers: responseHeaders,
      });
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      debugLog(`[PROXY] error: ${errorMessage}`);
      switchChain.push(`${endpoint.name} (network error)`);
      await markUnhealthy(endpoint.id);
      await addRequestAttempt({ request_id: requestId, endpoint_id: endpoint.id, endpoint_name: endpoint.name, method, path, status: 0, duration: Date.now() - startTime, success: false, error: errorMessage, model: requestInfo.model });
      lastError = errorMessage;
      switched = true;
      continue;
    }
  }

  const duration = Date.now() - startTime;
  const logEntry = {
    endpoint_id: endpoints[0].id,
    request_id: requestId,
    endpoint_name: endpoints[0].name,
    method,
    path,
    status: 503,
    duration,
    success: false,
    switched,
    error: `All endpoints failed: ${lastError}`,
    switch_chain: switchChain.join(' -> '),
    model: requestInfo.model,
    stream: requestInfo.stream,
  };
  await addLog(logEntry);
  emitLog({ ...logEntry, created_at: Math.floor(Date.now() / 1000) });

  return new Response(JSON.stringify({ error: 'All endpoints failed', details: lastError }), {
    status: 503,
    headers: { 'Content-Type': 'application/json' },
  });
}

export function handleCORS(): Response {
  return new Response(null, {
    status: 204,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': '*',
      'Access-Control-Max-Age': '86400',
    },
  });
}
