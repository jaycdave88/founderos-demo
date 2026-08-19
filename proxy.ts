import { NextRequest, NextResponse } from 'next/server';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);
const LOOPBACK_HOSTNAMES = new Set(['127.0.0.1', 'localhost', '[::1]', '::1']);

function hostnameFromHost(host: string | null): string {
  if (!host) return '';
  try {
    return new URL(`http://${host}`).hostname.toLowerCase();
  } catch {
    return '';
  }
}

function isSameLocalOrigin(origin: string, host: string): boolean {
  try {
    const parsed = new URL(origin);
    return (
      parsed.protocol === 'http:' &&
      LOOPBACK_HOSTNAMES.has(parsed.hostname.toLowerCase()) &&
      parsed.host.toLowerCase() === host.toLowerCase()
    );
  } catch {
    return false;
  }
}

export function proxy(request: NextRequest) {
  const host = (request.headers.get('host') ?? '').trim();
  if (!LOOPBACK_HOSTNAMES.has(hostnameFromHost(host))) {
    return NextResponse.json({ error: 'local host required' }, { status: 421 });
  }

  if (!SAFE_METHODS.has(request.method.toUpperCase())) {
    const fetchSite = request.headers.get('sec-fetch-site');
    if (fetchSite && fetchSite !== 'same-origin' && fetchSite !== 'none') {
      return NextResponse.json({ error: 'same-origin request required' }, { status: 403 });
    }

    const origin = request.headers.get('origin');
    if (origin && !isSameLocalOrigin(origin, host)) {
      return NextResponse.json({ error: 'same-origin request required' }, { status: 403 });
    }
  }

  return NextResponse.next();
}

export const config = {
  matcher: '/api/:path*',
};
