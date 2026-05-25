/**
 * POST /api/test-event
 *
 * Sends a hand-crafted test event to Meta CAPI for a given store. If the
 * store has metaTestEventCode set, the event will show up in Meta Events
 * Manager → Test Events tab. Useful while configuring a new store.
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getServerSession } from 'next-auth';
import { randomUUID } from 'crypto';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { decrypt } from '@/lib/crypto';
import { sendToMetaCapi } from '@/lib/meta-capi';

export const runtime = 'nodejs';

const TestSchema = z.object({
  store_id: z.string().uuid(),
  event_name: z
    .enum(['PageView', 'ViewContent', 'AddToCart', 'InitiateCheckout', 'Purchase'])
    .default('PageView'),
});

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const body = await req.json().catch(() => null);
  const parsed = TestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'invalid_payload', details: parsed.error.format() },
      { status: 400 }
    );
  }

  const store = await prisma.store.findUnique({
    where: { id: parsed.data.store_id },
  });
  if (!store) return NextResponse.json({ error: 'not_found' }, { status: 404 });

  const accessToken = decrypt(store.metaAccessTokenEnc);
  const eventId = `test_${randomUUID()}`;

  const res = await sendToMetaCapi({
    pixelId: store.metaPixelId,
    accessToken,
    testEventCode: store.metaTestEventCode,
    events: [
      {
        event_name: parsed.data.event_name,
        event_time: Math.floor(Date.now() / 1000),
        event_id: eventId,
        action_source: 'website',
        event_source_url: `https://${store.domain}/`,
        user_data: {
          client_ip_address: '8.8.8.8',
          client_user_agent: 'meta-tracker-test/1.0',
        },
        custom_data: { test: true },
      },
    ],
  });

  return NextResponse.json({
    event_id: eventId,
    response_status: res.status,
    events_received: res.eventsReceived,
    fbtrace_id: res.fbtraceId,
    error: res.errorMessage,
    success: res.ok,
  });
}
