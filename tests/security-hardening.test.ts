import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { NextRequest } from 'next/server';
import { describe, expect, test } from 'vitest';
import nextConfig from '../next.config.mjs';
import { proxy } from '../proxy';

function apiRequest(
  url: string,
  init: { method?: string; host?: string; origin?: string; fetchSite?: string } = {},
) {
  const headers = new Headers();
  if (init.host) headers.set('host', init.host);
  if (init.origin) headers.set('origin', init.origin);
  if (init.fetchSite) headers.set('sec-fetch-site', init.fetchSite);
  return new NextRequest(url, { method: init.method ?? 'GET', headers });
}

describe('local FounderOS request boundary', () => {
  test('accepts loopback reads and same-origin writes', () => {
    expect(
      proxy(apiRequest('http://127.0.0.1:4100/api/keys', { host: '127.0.0.1:4100' })).status,
    ).toBe(200);
    expect(
      proxy(
        apiRequest('http://127.0.0.1:4100/api/keys', {
          method: 'POST',
          host: '127.0.0.1:4100',
          origin: 'http://127.0.0.1:4100',
          fetchSite: 'same-origin',
        }),
      ).status,
    ).toBe(200);
  });

  test('accepts tokenized local workers that do not send browser origin headers', () => {
    expect(
      proxy(
        apiRequest('http://localhost:4100/api/notion/drafts', {
          method: 'POST',
          host: 'localhost:4100',
        }),
      ).status,
    ).toBe(200);
  });

  test('rejects DNS-rebinding and non-loopback Host headers before an API route runs', async () => {
    const response = proxy(
      apiRequest('http://attacker.example/api/keys', {
        host: 'attacker.example',
      }),
    );
    expect(response.status).toBe(421);
    expect(await response.json()).toEqual({ error: 'local host required' });
  });

  test('rejects cross-site browser writes to loopback APIs', async () => {
    const response = proxy(
      apiRequest('http://127.0.0.1:4100/api/comms/reply', {
        method: 'POST',
        host: '127.0.0.1:4100',
        origin: 'https://attacker.example',
        fetchSite: 'cross-site',
      }),
    );
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: 'same-origin request required' });
  });
});

describe('browser and process hardening', () => {
  test('production and development servers bind explicitly to IPv4 loopback', () => {
    const pkg = JSON.parse(readFileSync(join(process.cwd(), 'package.json'), 'utf8')) as {
      scripts: Record<string, string>;
    };
    expect(pkg.scripts.start).toContain('-H 127.0.0.1');
    expect(pkg.scripts.dev).toContain('-H 127.0.0.1');
  });

  test('global responses carry clickjacking, MIME, referrer, feature, and CSP defenses', async () => {
    const rules = await nextConfig.headers?.();
    const global = rules?.find((rule) => rule.source === '/:path*');
    const headers = Object.fromEntries((global?.headers ?? []).map(({ key, value }) => [key, value]));

    expect(headers['X-Content-Type-Options']).toBe('nosniff');
    expect(headers['X-Frame-Options']).toBe('DENY');
    expect(headers['Referrer-Policy']).toBe('no-referrer');
    expect(headers['Permissions-Policy']).toContain('camera=()');
    expect(headers['Content-Security-Policy']).toContain("frame-ancestors 'none'");
    expect(headers['Content-Security-Policy']).toContain("object-src 'none'");
    expect(headers['Content-Security-Policy']).not.toContain('default-src *');
    expect(nextConfig.poweredByHeader).toBe(false);
  });

  test('API responses are explicitly non-cacheable', async () => {
    const rules = await nextConfig.headers?.();
    const api = rules?.find((rule) => rule.source === '/api/:path*');
    const headers = Object.fromEntries((api?.headers ?? []).map(({ key, value }) => [key, value]));
    expect(headers['Cache-Control']).toBe('no-store, max-age=0');
  });
});
