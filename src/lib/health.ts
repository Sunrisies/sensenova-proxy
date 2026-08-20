import { getEnabledEndpoints, markHealthy, markUnhealthy } from './db';

const HEALTH_CHECK_INTERVAL = 30000; // 30 seconds
const COOLDOWN_PERIOD = 60000; // 60 seconds
const CHECK_TIMEOUT = 10000; // 10 seconds

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
    // SenseNova uses application-level errors for normal, reachable states.
    // Only an HTTP 500 response means the endpoint itself is unhealthy.
    return response.status !== 500;
  } catch {
    return false;
  }
}

async function runHealthCheck() {
  const endpoints = getEnabledEndpoints();
  const now = Date.now();

  for (const endpoint of endpoints) {
    // Skip if in cooldown period (for unhealthy endpoints)
    if (!endpoint.healthy && (now - endpoint.last_check * 1000) < COOLDOWN_PERIOD) {
      continue;
    }

    const isHealthy = await checkEndpointHealth(endpoint);

    if (isHealthy) {
      markHealthy(endpoint.id);
    } else {
      markUnhealthy(endpoint.id);
    }
  }
}

export function startHealthCheck() {
  if (healthCheckTimer) return;

  console.log('[HealthCheck] Starting health check service');
  // Initial check after 5 seconds
  setTimeout(runHealthCheck, 5000);
  // Then every 30 seconds
  healthCheckTimer = setInterval(runHealthCheck, HEALTH_CHECK_INTERVAL);
}

export function stopHealthCheck() {
  if (healthCheckTimer) {
    clearInterval(healthCheckTimer);
    healthCheckTimer = null;
    console.log('[HealthCheck] Stopped health check service');
  }
}

// Auto-start on import (server-side only)
if (typeof window === 'undefined') {
  startHealthCheck();
}
