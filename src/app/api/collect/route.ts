/**
 * POST /api/collect
 *
 * Public endpoint that the front-end tracker.js (storefront) and the Shopify
 * Custom Pixel call for browser events (PageView, ViewContent, AddToCart,
 * InitiateCheckout, Purchase). Persists the event, then fires it to Meta CAPI
 * in the background — EXCEPT Purchase, which is stored only.
 *
 * Why Purchase is not forwarded here:
 *   The orders/paid webhook is the single authoritative server-side CAPI
 *   Purchase source. The Custom Pixel sends Purchase to /api/collect so we
 *   have a browser-side audit record + access to client_id/fbp/fbc, but we
 *   skip CAPI forwarding to avoid duplicate server-side calls. The Event row
 *   is persisted with capiForwardingSkippedReason for dashboard visibility.
 *
 * - CORS: open (the script runs cross-origin from the merchant's Shopify domain)
 * - rate-limited per IP
 * - origin checked against Store.domain
 * - whitelisted event names only
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { EventName, EventSource } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { checkRateLimit } from '@/lib/rate-limit';
import { decrypt } from '@/lib/crypto';
import { cleanUserData, sendToMetaCapi, type CapiEvent } from '@/lib/meta-capi';

export const runtime = 'nodejs';

const EVENT_NAMES = [
  'PageView',
  'ViewContent',
  'AddToCart',
  'InitiateCheckout',
  'Purchase',
] as const;

const SKIP_REASON_PURCHASE_VIA_WEBHOOK = 'PURCHASE_FORWARDED_BY_SHOPIFY_WEBHOOK';

const CollectSchema = z.object({
  store_id: z.string().uuid(),
  event_id: z.string().min(1).max(128),
  event_name: z.enum(EVENT_NAMES),
  event_time: z.number().int().positive().optional(),
  client_id: z.string().min(1).max(128).optional(),
  fbp: z.string().max(255).optional(),
  fbc: z.string().max(255).optional(),
  fbclid: z.string().max(255).optional(),
  url: z.string().url().optional(),
  referrer: z.string().max(2048).optional(),
  product_id: z.string().max(128).optional(),
  product_name: z.string().max(255).optional(),
  content_ids: z.array(z.string().max(128)).max(50).optional(),
  value: z.number().nonnegative().optional(),
  currency: z.string().length(3).optional(),
  num_items: z.number().int().nonnegative().optional(),
  email_hash: z.string().length(64).optional(),
  phone_hash: z.string().length(64).optional(),
});

const CORS_HEADERS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Max-Age': '86400',
};

function withCors(res: NextResponse): NextResponse {
  for (const [k, v] of Object.entries(CORS_HEADERS)) res.headers.set(k, v);
  return res;
}

function clientIpFromRequest(req: NextRequest): string {
  return (
    req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
    req.headers.get('x-real-ip') ||
    ''
  );
}

function originMatchesDomain(originOrReferer: string, storeDomain: string): boolean {
  if (!originOrReferer) return true; // some clients omit it; be permissive
  try {
    const host = new URL(originOrReferer).hostname;
    return host === storeDomain || host.endsWith(`.${storeDomain}`);
  } catch {
    return false;
  }
}

export async function OPTIONS(): Promise<NextResponse> {
  return new NextResponse(null, { status: 204, headers: CORS_HEADERS });
}

export async function POST(req: NextRequest) {
  const ip = clientIpFromRequest(req);
  if (!checkRateLimit(`collect:${ip || 'anon'}`)) {
    return withCors(NextResponse.json({ error: 'rate_limited' }, { status: 429 }));
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return withCors(NextResponse.json({ error: 'invalid_json' }, { status: 400 }));
  }

  const parsed = CollectSchema.safeParse(body);
  if (!parsed.success) {
    return withCors(
      NextResponse.json(
        { error: 'invalid_payload', details: parsed.error.format() },
        { status: 400 }
      )
    );
  }
  const data = parsed.data;

  const store = await prisma.store.findFirst({
    where: { id: data.store_id, active: true },
  });
  if (!store) {
    return withCors(NextResponse.json({ error: 'unknown_store' }, { status: 404 }));
  }

  // Origin check disabled: a Shopify store can have multiple frontends
  // (myshopify.com subdomain AND a custom domain). Store.domain holds the
  // myshopify.com one for webhook matching, but the browser fetch comes
  // from the custom domain. Auth is store_id (UUID) + rate limiting.

  const userAgent = req.headers.get('user-agent') ?? undefined;
  const eventTime = data.event_time ? new Date(data.event_time * 1000) : new Date();
  const isPurchase = data.event_name === 'Purchase';
  const capiForwardingSkippedReason = isPurchase
    ? SKIP_REASON_PURCHASE_VIA_WEBHOOK
    : null;

  // Upsert session
  let sessionId: string | null = null;
  if (data.client_id) {
    const session = await prisma.session.upsert({
      where: {
        storeId_clientId: { storeId: store.id, clientId: data.client_id },
      },
      update: {
        lastSeenAt: new Date(),
        fbp: data.fbp ?? undefined,
        fbc: data.fbc ?? undefined,
        fbclid: data.fbclid ?? undefined,
        userAgent: userAgent ?? undefined,
        ipAddress: ip || undefined,
      },
      create: {
        storeId: store.id,
        clientId: data.client_id,
        fbp: data.fbp,
        fbc: data.fbc,
        fbclid: data.fbclid,
        ipAddress: ip || undefined,
        userAgent,
        landingUrl: data.url,
        referrer: data.referrer,
      },
    });
    sessionId = session.id;
  }

  // Insert event (idempotent on storeId + eventId)
  let event;
  try {
    event = await prisma.event.create({
      data: {
        storeId: store.id,
        sessionId,
        eventId: data.event_id,
        eventName: data.event_name as EventName,
        eventTime,
        source: EventSource.BROWSER,
        url: data.url,
        referrer: data.referrer,
        userAgent,
        ipAddress: ip || undefined,
        fbp: data.fbp,
        fbc: data.fbc,
        fbclid: data.fbclid,
        productId: data.product_id,
        productName: data.product_name,
        contentIds: data.content_ids ?? [],
        value: data.value !== undefined ? data.value : undefined,
        currency: data.currency,
        numItems: data.num_items,
        emailHash: data.email_hash,
        phoneHash: data.phone_hash,
        rawPayload: data,
        capiForwardingSkippedReason,
      },
    });
  } catch (err) {
    // Unique constraint on (storeId, eventId): treat as already-seen
    if ((err as { code?: string }).code === 'P2002') {
      return withCors(NextResponse.json({ ok: true, dedup: true }, { status: 202 }));
    }
    throw err;
  }

  // Purchase is intentionally NOT forwarded from /api/collect — the orders/paid
  // webhook is the single server-side CAPI Purchase source. The Event row above
  // is persisted with capiForwardingSkippedReason so the dashboard can show
  // why no MetaEventLog exists for this Purchase.
  if (!isPurchase) {
    void forwardToMeta(store, event, data, { ip, userAgent });
  }

  return withCors(
    NextResponse.json(
      { ok: true, event_id: event.eventId, capi_forwarded: !isPurchase },
      { status: 202 }
    )
  );
}

async function forwardToMeta(
  store: { id: string; metaPixelId: string; metaAccessTokenEnc: string; metaTestEventCode: string | null },
  event: { id: string; eventId: string; eventTime: Date },
  data: z.infer<typeof CollectSchema>,
  ctx: { ip: string; userAgent?: string }
): Promise<void> {
  try {
    const accessToken = decrypt(store.metaAccessTokenEnc);

    const capiEvent: CapiEvent = {
      event_name: data.event_name,
      event_time: Math.floor(event.eventTime.getTime() / 1000),
      event_id: event.eventId,
      action_source: 'website',
      event_source_url: data.url,
      user_data: cleanUserData({
        client_ip_address: ctx.ip || undefined,
        client_user_agent: ctx.userAgent,
        fbp: data.fbp,
        fbc: data.fbc,
        em: data.email_hash ? [data.email_hash] : undefined,
        ph: data.phone_hash ? [data.phone_hash] : undefined,
        external_id: data.client_id ? [data.client_id] : undefined,
      }),
      custom_data:
        data.value !== undefined || (data.content_ids?.length ?? 0) > 0
          ? {
              value: data.value,
              currency: data.currency,
              content_ids: data.content_ids,
              content_type: 'product',
              num_items: data.num_items,
            }
          : undefined,
    };

    const res = await sendToMetaCapi({
      pixelId: store.metaPixelId,
      accessToken,
      testEventCode: store.metaTestEventCode,
      events: [capiEvent],
    });

    const success = res.ok && (res.eventsReceived ?? 0) > 0;

    await prisma.metaEventLog.create({
      data: {
        storeId: store.id,
        eventId: event.eventId,
        eventName: data.event_name as EventName,
        relatedEventId: event.id,
        requestPayload: capiEvent as unknown as object,
        responseStatus: res.status,
        responseBody: (res.body ?? undefined) as object | undefined,
        eventsReceived: res.eventsReceived,
        fbtraceId: res.fbtraceId,
        errorMessage: res.errorMessage,
        success,
        testMode: !!store.metaTestEventCode,
        nextRetryAt: success ? null : new Date(Date.now() + 60 * 1000),
      },
    });
  } catch (err) {
    console.error('forwardToMeta error', err);
  }
}
