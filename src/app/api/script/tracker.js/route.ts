/**
 * GET /api/script/tracker.js?store_id=<uuid>
 *
 * Serves the Shopify front-end tracker as application/javascript with a
 * 5-minute cache header. The script itself reads the store_id from its own
 * src URL at runtime, so the same bytes are returned for every store.
 *
 * Source lives at public/tracker.js so it can also be inspected directly
 * as a static asset during development.
 */

import { readFileSync } from 'fs';
import { join } from 'path';
import { NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const dynamic = 'force-static';

const SCRIPT_PATH = join(process.cwd(), 'public', 'tracker.js');

let cached: string | null = null;
function loadScript(): string {
  if (cached !== null) return cached;
  cached = readFileSync(SCRIPT_PATH, 'utf8');
  return cached;
}

export async function GET(): Promise<NextResponse> {
  const body = loadScript();
  return new NextResponse(body, {
    status: 200,
    headers: {
      'Content-Type': 'application/javascript; charset=utf-8',
      'Cache-Control': 'public, max-age=300, s-maxage=300',
      'X-Content-Type-Options': 'nosniff',
      // The <script> tag itself is not subject to CORS, but allow it anyway
      'Access-Control-Allow-Origin': '*',
    },
  });
}
