import { getEnabledEndpoints, markHealthy, markUnhealthy } from './db';

const HEALTH_CHECK_INTERVAL = 30000;
const COOLDOWN_PERIOD = 60000;
const CHECK_TIMEOUT = 10000;

let healthCheckTimer: ReturnType<typeof setInterval> | null = null;

async function checkEndpointHealth(endpoint: { id: string; url: string; api_key: string; last_check: number }): Promise<boolean> {
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), CHECK_TIMEOUT);

    const response = await fetch(`${endpoint.url}/models`, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${endpoint.api_key}`,
      },
      signal: controller.signal,
    });

    clearTimeout(timeoutId);
    return response.status !== 500;
  } catch {
    return false;
  }
}

async function runHealthCheck() {
  const endpoints = await getEnabledEndpoints();
  const now = Date.now();

  for (const endpoint of endpoints) {
    if (!endpoint.healthy && (now - endpoint.last_check * 1000) < COOLDOWN_PERIOD) {
      continue;
    }

    const isHealthy = await checkEndpointHealth(endpoint);

    if (isHealthy) {
      await markHealthy(endpoint.id);
    } else {
      await markUnhealthy(endpoint.id);
    }
  }
}

export function startHealthCheck() {
  if (healthCheckTimer) return;

  console.log('[HealthCheck] Starting health check service');
  setTimeout(runHealthCheck, 5000);
  healthCheckTimer = setInterval(runHealthCheck, HEALTH_CHECK_INTERVAL);
}

export function stopHealthCheck() {
  if (healthCheckTimer) {
    clearInterval(healthCheckTimer);
    healthCheckTimer = null;
    console.log('[HealthCheck] Stopped health check service');
  }
}

if (typeof window === 'undefined') {
  startHealthCheck();
}
