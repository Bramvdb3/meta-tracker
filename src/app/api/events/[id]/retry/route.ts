/**
 * POST /api/events/:id/retry
 *
 * Manually retry a failed MetaEventLog row from the dashboard.
 * Creates a new MetaEventLog with attempt = previous + 1.
 */

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { CapiStatus } from '@prisma/client';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { decrypt } from '@/lib/crypto';
import { sendToMetaCapi, type CapiEvent } from '@/lib/meta-capi';

export const runtime = 'nodejs';

export async function POST(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  const session = await getServerSession(authOptions);
  if (!session) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const log = await prisma.metaEventLog.findUnique({
    where: { id: params.id },
    include: { store: true },
  });
  if (!log) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 });
  }

  const accessToken = decrypt(log.store.metaAccessTokenEnc);
  const payload = log.requestPayload as unknown as CapiEvent | CapiEvent[];
  const events: CapiEvent[] = Array.isArray(payload) ? payload : [payload];

  const res = await sendToMetaCapi({
    pixelId: log.store.metaPixelId,
    accessToken,
    testEventCode: log.store.metaTestEventCode,
    events,
  });

  const success = res.ok && (res.eventsReceived ?? 0) > 0;
  const newAttempt = log.attempt + 1;

  const newLog = await prisma.metaEventLog.create({
    data: {
      storeId: log.storeId,
      eventId: log.eventId,
      eventName: log.eventName,
      relatedEventId: log.relatedEventId,
      relatedOrderId: log.relatedOrderId,
      requestPayload: log.requestPayload as object,
      responseStatus: res.status,
      responseBody: (res.body ?? undefined) as object | undefined,
      eventsReceived: res.eventsReceived,
      fbtraceId: res.fbtraceId,
      errorMessage: res.errorMessage,
      attempt: newAttempt,
      success,
      testMode: log.testMode,
    },
  });

  // If the original was dead-lettered and the retry succeeded, un-dead-letter
  if (success && log.deadLettered) {
    await prisma.metaEventLog.update({
      where: { id: log.id },
      data: { deadLettered: false },
    });
  }

  if (log.relatedOrderId && success) {
    await prisma.order.update({
      where: { id: log.relatedOrderId },
      data: {
        capiStatus: CapiStatus.SUCCESS,
        capiEventIdUsed: log.eventId,
      },
    });
  }

  return NextResponse.json(
    {
      ok: true,
      success,
      log_id: newLog.id,
      events_received: res.eventsReceived,
      fbtrace_id: res.fbtraceId,
      error: res.errorMessage,
    },
    { status: 200 }
  );
}
