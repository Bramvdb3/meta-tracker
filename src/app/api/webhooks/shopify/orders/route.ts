/**
 * POST /api/webhooks/shopify/orders
 *
 * Receives Shopify "orders/create" and "orders/paid" webhooks.
 *
 * Flow:
 *   1. HMAC verify with the store's webhook secret
 *   2. DEDUP gate: skip if Order already exists with capiStatus = SUCCESS
 *   3. Hash PII (email, phone, name, city, state, zip, country)
 *   4. Redact PII from raw payload before persisting
 *   5. Determine matchSource (CART_ATTRIBUTES > SHOPIFY_CLIENT_DETAILS > CUSTOMER_DATA_ONLY > FALLBACK_ORDER_ID)
 *   6. Pick purchase event_id: _mt_purchase_eid from note_attributes, or fallback to `purchase_<shopify_order_id>`
 *   7. Send Purchase event to Meta CAPI, log result, mark Order status
 */

import { NextRequest, NextResponse } from 'next/server';
import { CapiStatus, EventName, type MatchSource } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { verifyShopifyHmac } from '@/lib/shopify-hmac';
import { redactShopifyOrderPayload } from '@/lib/redact';
import { decrypt } from '@/lib/crypto';
import { parseNoteAttributes } from '@/lib/cart-attributes';
import { determineMatchSource } from '@/lib/match-source';
import { cleanUserData, sendToMetaCapi, type CapiEvent } from '@/lib/meta-capi';
import {
  hashEmail,
  hashPhone,
  hashName,
  hashCity,
  hashState,
  hashZip,
  hashCountry,
} from '@/lib/hash';

export const runtime = 'nodejs';

interface ShopifyAddress {
  first_name?: string | null;
  last_name?: string | null;
  phone?: string | null;
  city?: string | null;
  province?: string | null;
  province_code?: string | null;
  zip?: string | null;
  country?: string | null;
  country_code?: string | null;
}

interface ShopifyLineItem {
  product_id?: number | string | null;
  quantity?: number | null;
}

interface ShopifyOrder {
  id: number | string;
  name?: string | null;
  email?: string | null;
  phone?: string | null;
  total_price?: string | number | null;
  current_total_price?: string | number | null;
  subtotal_price?: string | number | null;
  currency?: string | null;
  financial_status?: string | null;
  fulfillment_status?: string | null;
  created_at?: string | null;
  note_attributes?: { name: string; value: string | null }[] | null;
  customer?: {
    email?: string | null;
    phone?: string | null;
    first_name?: string | null;
    last_name?: string | null;
  } | null;
  billing_address?: ShopifyAddress | null;
  shipping_address?: ShopifyAddress | null;
  line_items?: ShopifyLineItem[] | null;
  client_details?: { browser_ip?: string | null; user_agent?: string | null } | null;
}

export async function POST(req: NextRequest) {
  const rawBody = await req.text();
  const hmacHeader = req.headers.get('x-shopify-hmac-sha256');
  const shopDomain = req.headers.get('x-shopify-shop-domain');
  if (!shopDomain) {
    return NextResponse.json({ error: 'missing_shop_domain' }, { status: 400 });
  }

  const store = await prisma.store.findFirst({
    where: { domain: shopDomain, active: true },
  });
  if (!store) {
    return NextResponse.json({ error: 'unknown_store' }, { status: 404 });
  }

  const webhookSecret = decrypt(store.shopifyWebhookSecretEnc);
  if (!verifyShopifyHmac(rawBody, hmacHeader, webhookSecret)) {
    return NextResponse.json({ error: 'invalid_signature' }, { status: 401 });
  }

  let order: ShopifyOrder;
  try {
    order = JSON.parse(rawBody) as ShopifyOrder;
  } catch {
    return NextResponse.json({ error: 'invalid_json' }, { status: 400 });
  }

  const shopifyOrderId = String(order.id);

  // ── DEDUP GATE ──────────────────────────────────────────────────
  const existing = await prisma.order.findUnique({
    where: {
      storeId_shopifyOrderId: { storeId: store.id, shopifyOrderId },
    },
  });
  if (existing && existing.capiStatus === CapiStatus.SUCCESS) {
    return NextResponse.json({ ok: true, dedup: true }, { status: 200 });
  }

  // ── Extract tracking metadata ───────────────────────────────────
  const mt = parseNoteAttributes(order.note_attributes);
  const clientDetails = order.client_details ?? null;
  const customer = order.customer ?? null;
  const addr = order.billing_address ?? order.shipping_address ?? null;

  const matchSource: MatchSource = determineMatchSource({
    mt,
    clientDetails,
    customer: customer
      ? {
          email: order.email ?? customer.email,
          phone: order.phone ?? customer.phone,
          first_name: customer.first_name ?? addr?.first_name,
          last_name: customer.last_name ?? addr?.last_name,
        }
      : null,
  });

  // ── Purchase event_id: prefer cart attribute, fallback to deterministic id
  const purchaseEventId =
    mt.purchaseEventId && mt.purchaseEventId.length > 0
      ? mt.purchaseEventId
      : `purchase_${shopifyOrderId}`;

  const totalPrice = Number(order.total_price ?? order.current_total_price ?? 0);
  const subtotalPrice = order.subtotal_price != null ? Number(order.subtotal_price) : null;
  const currency = order.currency || store.currency;

  // ── Hash PII for CAPI user_data ─────────────────────────────────
  const emailHash = hashEmail(order.email ?? customer?.email);
  const phoneHash = hashPhone(order.phone ?? customer?.phone ?? addr?.phone);
  const firstNameHash = hashName(customer?.first_name ?? addr?.first_name);
  const lastNameHash = hashName(customer?.last_name ?? addr?.last_name);
  const cityHash = hashCity(addr?.city);
  const stateHash = hashState(addr?.province_code ?? addr?.province);
  const zipHash = hashZip(addr?.zip);
  const countryHash = hashCountry(addr?.country_code ?? addr?.country);

  // ── Browser context: cart attrs first, client_details as fallback
  const userAgent = mt.userAgent ?? clientDetails?.user_agent ?? null;
  const ip = clientDetails?.browser_ip ?? null;

  const redactedPayload = redactShopifyOrderPayload(order) as object;

  // ── Upsert Order row ────────────────────────────────────────────
  const orderRow = await prisma.order.upsert({
    where: {
      storeId_shopifyOrderId: { storeId: store.id, shopifyOrderId },
    },
    update: {
      orderNumber: order.name ?? undefined,
      totalPrice,
      subtotalPrice: subtotalPrice ?? undefined,
      currency,
      emailHash,
      phoneHash,
      firstNameHash,
      lastNameHash,
      cityHash,
      stateHash,
      zipHash,
      countryHash,
      clientIp: ip ?? undefined,
      clientUserAgent: userAgent ?? undefined,
      fbp: mt.fbp ?? undefined,
      fbc: mt.fbc ?? undefined,
      fbclid: mt.fbclid ?? undefined,
      clientId: mt.clientId ?? undefined,
      purchaseEventId: mt.purchaseEventId ?? undefined,
      landingUrl: mt.landingUrl ?? undefined,
      financialStatus: order.financial_status ?? undefined,
      fulfillmentStatus: order.fulfillment_status ?? undefined,
      rawPayloadRedacted: redactedPayload,
      matchSource,
    },
    create: {
      storeId: store.id,
      shopifyOrderId,
      orderNumber: order.name ?? null,
      totalPrice,
      subtotalPrice,
      currency,
      emailHash,
      phoneHash,
      firstNameHash,
      lastNameHash,
      cityHash,
      stateHash,
      zipHash,
      countryHash,
      clientIp: ip,
      clientUserAgent: userAgent,
      fbp: mt.fbp,
      fbc: mt.fbc,
      fbclid: mt.fbclid,
      clientId: mt.clientId,
      purchaseEventId: mt.purchaseEventId,
      landingUrl: mt.landingUrl,
      financialStatus: order.financial_status ?? null,
      fulfillmentStatus: order.fulfillment_status ?? null,
      placedAt: order.created_at ? new Date(order.created_at) : new Date(),
      rawPayloadRedacted: redactedPayload,
      capiStatus: CapiStatus.PENDING,
      matchSource,
    },
  });

  // ── Build & send CAPI Purchase event ────────────────────────────
  const accessToken = decrypt(store.metaAccessTokenEnc);

  const contentIds: string[] = Array.isArray(order.line_items)
    ? order.line_items
        .map((li) => (li.product_id != null ? String(li.product_id) : null))
        .filter((v): v is string => v !== null)
    : [];
  const numItems: number = Array.isArray(order.line_items)
    ? order.line_items.reduce((s, li) => s + (li.quantity ?? 0), 0)
    : 0;

  const capiEvent: CapiEvent = {
    event_name: 'Purchase',
    event_time: Math.floor(
      new Date(order.created_at ?? Date.now()).getTime() / 1000
    ),
    event_id: purchaseEventId,
    action_source: 'website',
    event_source_url: mt.landingUrl ?? `https://${store.domain}/`,
    user_data: cleanUserData({
      em: emailHash ? [emailHash] : undefined,
      ph: phoneHash ? [phoneHash] : undefined,
      fn: firstNameHash ? [firstNameHash] : undefined,
      ln: lastNameHash ? [lastNameHash] : undefined,
      ct: cityHash ? [cityHash] : undefined,
      st: stateHash ? [stateHash] : undefined,
      zp: zipHash ? [zipHash] : undefined,
      country: countryHash ? [countryHash] : undefined,
      client_ip_address: ip ?? undefined,
      client_user_agent: userAgent ?? undefined,
      fbp: mt.fbp ?? undefined,
      fbc: mt.fbc ?? undefined,
      external_id: mt.clientId ? [mt.clientId] : undefined,
    }),
    custom_data: {
      value: totalPrice,
      currency,
      content_ids: contentIds,
      content_type: 'product',
      num_items: numItems,
      order_id: shopifyOrderId,
    },
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
      eventId: purchaseEventId,
      eventName: EventName.Purchase,
      relatedOrderId: orderRow.id,
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

  await prisma.order.update({
    where: { id: orderRow.id },
    data: {
      capiStatus: success ? CapiStatus.SUCCESS : CapiStatus.FAILED,
      capiEventIdUsed: purchaseEventId,
    },
  });

  return NextResponse.json({ ok: true, success, match_source: matchSource }, { status: 200 });
}
