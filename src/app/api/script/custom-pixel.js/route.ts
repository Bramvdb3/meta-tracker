/**
 * GET /api/script/custom-pixel.js?store_id=<uuid>
 *
 * Serves the Shopify Custom Pixel source with __STORE_ID__ and __API_BASE__
 * placeholders substituted. The output is meant to be copy-pasted into:
 *   Shopify Admin → Settings → Customer events → Add custom pixel → Code editor.
 *
 * Without a valid store_id the route returns the source with placeholders intact
 * (for inspection / manual replacement).
 */

import { readFileSync } from 'fs';
import { join } from 'path';
import { NextRequest, NextResponse } from 'next/server';

export const runtime = 'nodejs';

const SCRIPT_PATH = join(process.cwd(), 'public', 'custom-pixel.js');

let cached: string | null = null;
function loadScript(): string {
  if (cached !== null) return cached;
  cached = readFileSync(SCRIPT_PATH, 'utf8');
  return cached;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Public base URL of this app.
 *
 * IMPORTANT: do NOT derive this from `req.url`. Behind a reverse proxy
 * (Railway, Vercel, Fly, …) the Node server sees the *internal* address —
 * on Railway that is literally `localhost:8080` — which would be baked into
 * the Custom Pixel and make every checkout event POST to localhost and
 * silently vanish.
 *
 * Order of preference:
 *   1. APP_BASE_URL env var (explicit, set at deploy time)
 *   2. x-forwarded-proto / x-forwarded-host headers set by the proxy
 *   3. req.url host as a last resort (correct for local `next dev`)
 */
function resolveApiBase(req: NextRequest): string {
  const fromEnv = process.env.APP_BASE_URL?.trim();
  if (fromEnv) return fromEnv.replace(/\/+$/, '');

  const fwdHost = req.headers.get('x-forwarded-host');
  if (fwdHost) {
    const fwdProto = req.headers.get('x-forwarded-proto') || 'https';
    return `${fwdProto}://${fwdHost}`.replace(/\/+$/, '');
  }

  const url = new URL(req.url);
  return `${url.protocol}//${url.host}`;
}

export async function GET(req: NextRequest): Promise<NextResponse> {
  const source = loadScript();
  const url = new URL(req.url);
  const storeId = url.searchParams.get('store_id');
  const apiBase = resolveApiBase(req);

  let body = source;
  if (storeId) {
    if (!UUID_RE.test(storeId)) {
      return new NextResponse('Invalid store_id', { status: 400 });
    }
    body = body
      .split('__STORE_ID__')
      .join(storeId)
      .split('__API_BASE__')
      .join(apiBase);
  }

  return new NextResponse(body, {
    status: 200,
    headers: {
      'Content-Type': 'application/javascript; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}
