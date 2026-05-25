/**
 * POST /api/cron/retry-failed-events
 *
 * Called by Railway cron every ~5 minutes (header: x-cron-secret).
 * Picks up MetaEventLog rows where success=false, deadLettered=false,
 * nextRetryAt <= now() and attempt < MAX_ATTEMPTS. Reposts the saved
 * requestPayload to Meta. Exponential backoff between attempts.
 */

import { NextRequest, NextResponse } from 'next/server';
import { CapiStatus } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { decrypt } from '@/lib/crypto';
import { sendToMetaCapi, type CapiEvent } from '@/lib/meta-capi';

export const runtime = 'nodejs';

const RETRY_BACKOFF_MS = [
  1 * 60 * 1000, // attempt 2 → 1m
  5 * 60 * 1000, // attempt 3 → 5m
  30 * 60 * 1000, // attempt 4 → 30m
  2 * 60 * 60 * 1000, // attempt 5 → 2h
  12 * 60 * 60 * 1000, // attempt 6 → 12h
  24 * 60 * 60 * 1000, // attempt 7 → 24h (only reached via manual retry past MAX)
];

const MAX_ATTEMPTS = 6;
const BATCH_SIZE = 50;

export async function POST(req: NextRequest) {
  const provided = req.headers.get('x-cron-secret');
  if (!provided || provided !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const candidates = await prisma.metaEventLog.findMany({
    where: {
      success: false,
      deadLettered: false,
      nextRetryAt: { lte: new Date() },
      attempt: { lt: MAX_ATTEMPTS },
    },
    include: { store: true },
    take: BATCH_SIZE,
    orderBy: { sentAt: 'asc' },
  });

  let processed = 0;
  let successes = 0;

  for (const log of candidates) {
    processed += 1;
    const store = log.store;
    const accessToken = decrypt(store.metaAccessTokenEnc);

    const payload = log.requestPayload as CapiEvent | CapiEvent[];
    const events: CapiEvent[] = Array.isArray(payload) ? payload : [payload];

    const res = await sendToMetaCapi({
      pixelId: store.metaPixelId,
      accessToken,
      testEventCode: store.metaTestEventCode,
      events,
    });

    const success = res.ok && (res.eventsReceived ?? 0) > 0;
    if (success) successes += 1;

    const newAttempt = log.attempt + 1;
    const isLast = newAttempt >= MAX_ATTEMPTS;
    const backoff =
      RETRY_BACKOFF_MS[Math.min(newAttempt - 1, RETRY_BACKOFF_MS.length - 1)];

    await prisma.metaEventLog.create({
      data: {
        storeId: store.id,
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
        nextRetryAt: success ? null : isLast ? null : new Date(Date.now() + backoff),
        deadLettered: !success && isLast,
      },
    });

    // Clear nextRetryAt on the previous row so we don't repick it
    await prisma.metaEventLog.update({
      where: { id: log.id },
      data: {
        nextRetryAt: null,
        deadLettered: log.deadLettered || (!success && isLast),
      },
    });

    if (log.relatedOrderId) {
      await prisma.order.update({
        where: { id: log.relatedOrderId },
        data: {
          capiStatus: success
            ? CapiStatus.SUCCESS
            : isLast
              ? CapiStatus.DEAD_LETTERED
              : CapiStatus.FAILED,
          ...(success ? { capiEventIdUsed: log.eventId } : {}),
        },
      });
    }
  }

  return NextResponse.json(
    { processed, successes, failed: processed - successes },
    { status: 200 }
  );
}
