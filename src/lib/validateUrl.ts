import dns from 'node:dns/promises';

const PRIVATE_IP_RANGES: Array<{ label: string; test: (ip: string) => boolean }> = [
  // IPv4 私有/保留地址段
  { label: '0.0.0.0/8', test: (ip) => /^0\./.test(ip) },
  { label: '10.0.0.0/8', test: (ip) => /^10\./.test(ip) },
  { label: '127.0.0.0/8', test: (ip) => /^127\./.test(ip) },
  { label: '169.254.0.0/16', test: (ip) => /^169\.254\./.test(ip) },
  { label: '172.16.0.0/12', test: (ip) => /^172\.(1[6-9]|2\d|3[01])\./.test(ip) },
  { label: '192.168.0.0/16', test: (ip) => /^192\.168\./.test(ip) },
  { label: '100.64.0.0/10', test: (ip) => /^100\.(6[4-9]|[7-9]\d)\./.test(ip) },
  { label: '224.0.0.0/4', test: (ip) => /^22[4-9]\./.test(ip) },
  { label: '240.0.0.0/4', test: (ip) => /^24\d\./.test(ip) },
];

function isPrivateIPv4(ip: string): boolean {
  return PRIVATE_IP_RANGES.some(({ test }) => test(ip));
}

function isPrivateIPv6(ip: string): boolean {
  const lower = ip.toLowerCase();
  if (lower === '::' || lower === '::1') return true;
  if (lower.startsWith('fc') || lower.startsWith('fd')) return true; // fc00::/7（ULA）
  if (lower.startsWith('fe8') || lower.startsWith('fe9') || lower.startsWith('fea') || lower.startsWith('feb')) return true; // fe80::/10（link-local）
  if (lower === '::ffff:127.0.0.1') return true;
  // ::ffff:a.b.c.d 形式的 IPv4 映射地址
  const v4Mapped = lower.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (v4Mapped) return isPrivateIPv4(v4Mapped[1]);
  return false;
}

function isPrivateIP(ip: string): boolean {
  if (ip.includes(':')) return isPrivateIPv6(ip);
  return isPrivateIPv4(ip);
}

async function hostIsSafe(url: URL): Promise<void> {
  const hostname = url.hostname.toLowerCase();

  if (hostname === 'localhost') {
    throw new Error('URL cannot point to localhost');
  }

  // 直接填写 IP 的情况
  if (!hostname.includes(':') && /^\d+\.\d+\.\d+\.\d+$/.test(hostname)) {
    if (isPrivateIPv4(hostname)) {
      throw new Error('URL cannot point to a private or reserved IP address');
    }
    return;
  }
  if (hostname.includes(':')) {
    if (isPrivateIPv6(hostname)) {
      throw new Error('URL cannot point to a private or reserved IP address');
    }
    return;
  }

  // 域名：解析 DNS 验证不指向内网
  const addresses = await dns.lookup(hostname, { all: true, verbatim: true }).catch((error) => {
    throw new Error(`URL hostname cannot be resolved: ${error.message}`);
  });
  if (!addresses.length) {
    throw new Error('URL hostname cannot be resolved');
  }
  for (const { address } of addresses) {
    if (isPrivateIP(address)) {
      throw new Error(`URL hostname resolves to a private address (${address})`);
    }
  }
}

export async function validateEndpointUrl(raw: unknown): Promise<string> {
  if (typeof raw !== 'string' || !raw.trim()) {
    throw new Error('url is required');
  }
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error('url is not a valid URL');
  }
  if (url.protocol !== 'https:') {
    throw new Error('url must use https:// protocol');
  }
  await hostIsSafe(url);
  return url.toString().replace(/\/$/, '');
}