import { getHealthyEndpoints, getAvailableEndpoints, markUnhealthy, markHealthy, markRateLimited, addLog } from './db';
import fs from 'fs';
import path from 'path';

const REQUEST_TIMEOUT = 30000;
const DEBUG_LOG = path.join(process.cwd(), 'debug.log');

function debugLog(msg: string) {
  const line = `[${new Date().toISOString()}] ${msg}\n`;
  console.log(`DEBUG_LOG:${DEBUG_LOG}`)
  fs.appendFileSync(DEBUG_LOG, line);
  console.log(line.trim());
}

// Event emitter for real-time logs
type LogListener = (log: unknown) => void;
const logListeners: Set<LogListener> = new Set();

export function onLog(listener: LogListener) {
  logListeners.add(listener);
  return () => logListeners.delete(listener);
}

function emitLog(log: unknown) {
  logListeners.forEach(listener => listener(log));
}

export async function proxyRequest(
  request: Request,
  path: string
): Promise<Response> {
  const method = request.method;
  const startTime = Date.now();
  const clientIp = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
    ?? request.headers.get('x-real-ip')
    ?? 'unknown';

  // Get body for non-GET/HEAD requests
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
      // Non-JSON requests are still transparently proxied.
    }
  }

  // Build headers (exclude host, connection)
  const headers = new Headers();
  request.headers.forEach((value, key) => {
    const lower = key.toLowerCase();
    if (lower !== 'host' && lower !== 'connection') {
      headers.set(key, value);
    }
  });

  const healthyEndpoints = getHealthyEndpoints();
  const availableEndpoints = getAvailableEndpoints();
  // Health checks are advisory. If every key is marked unhealthy, still try
  // each enabled key so a transient /models failure cannot cause a 503.
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

  // Each configured endpoint represents one URL + API key pair. Try every
  // available pair so a 429 can fail over without changing the model.
  for (let attempt = 0; attempt < endpoints.length; attempt++) {
    // Pick endpoint: first attempt uses priority order, subsequent attempts try next
    const endpoint = endpoints[attempt % endpoints.length];
    // Strip /v1 prefix from path since endpoint URL already includes it
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

      // 429 can fail over for this request, but it does not mean the endpoint
      // is unhealthy. Only HTTP 500 marks an endpoint unhealthy.
      if (response.status === 429 || response.status === 500) {
        const errorText = await response.text().catch(() => 'Unknown error');
        if (response.status === 500) {
          markUnhealthy(endpoint.id);
        } else {
          markRateLimited(endpoint.id);
        }
        lastError = `HTTP ${response.status}: ${errorText}`;
        debugLog(`[PROXY] retryable status=${response.status}; switching endpoint`);
        switched = true;
        continue;
      }

      // Success - log and return. For SSE, collect usage and first-token timing
      // while passing every byte through unchanged.
      const duration = Date.now() - startTime;
      // 400/403/404/408 and other non-500 responses mean the endpoint was
      // reachable. Keep it healthy even when the request itself is invalid.
      markHealthy(endpoint.id);

      const baseLog = {
        endpoint_id: endpoint.id,
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

      // Return response with CORS headers
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
            // A partial SSE frame is handled on the next chunk.
          }
        }

        const stream = response.body.pipeThrough(new TransformStream<Uint8Array, Uint8Array>({
          transform(chunk, controller) {
            const text = decoder.decode(chunk, { stream: true });
            if (firstByteMs === undefined && text.trim()) firstByteMs = Date.now() - startTime;
            buffer += text;
            const lines = buffer.split('\n');
            buffer = lines.pop() ?? '';
            for (const line of lines) {
              parseSseLine(line);
            }
            controller.enqueue(encoder.encode(text));
          },
          flush(controller) {
            const finalText = decoder.decode();
            buffer += finalText;
            for (const line of buffer.split('\n')) parseSseLine(line);
            controller.enqueue(encoder.encode(finalText));
            const completed = {
              ...baseLog,
              duration: Date.now() - startTime,
              first_byte_ms: firstByteMs,
              prompt_tokens: promptTokens,
              completion_tokens: completionTokens,
              total_tokens: totalTokens,
            };
            addLog(completed);
            emitLog({ ...completed, created_at: Math.floor(Date.now() / 1000) });
          },
        }));

        return new Response(stream, {
          status: response.status,
          statusText: response.statusText,
          headers: responseHeaders,
        });
      }

      const logEntry = { ...baseLog };
      addLog(logEntry);
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
      markUnhealthy(endpoint.id);
      lastError = errorMessage;
      switched = true;
      continue;
    }
  }

  // All endpoints failed
  const duration = Date.now() - startTime;
  const logEntry = {
    endpoint_id: endpoints[0].id,
    endpoint_name: endpoints[0].name,
    method,
    path,
    status: 503,
    duration,
    success: false,
    switched,
    error: `All endpoints failed: ${lastError}`,
    switch_chain: switchChain.join(' -> '),
  };
  addLog(logEntry);
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
