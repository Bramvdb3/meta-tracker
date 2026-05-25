/**
 * GET /api/events?store_id=&event_name=&success=&limit=&cursor=
 *
 * Paginated MetaEventLog list with optional filters. Returns rows for the
 * dashboard event log including response status, events_received and
 * fbtrace_id so you can see at a glance what Meta did with each call.
 */

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { EventName } from '@prisma/client';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';

export const runtime = 'nodejs';

const VALID_EVENT_NAMES = new Set<string>(Object.keys(EventName));

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const url = new URL(req.url);
  const storeId = url.searchParams.get('store_id') || undefined;
  const eventNameParam = url.searchParams.get('event_name');
  const eventName =
    eventNameParam && VALID_EVENT_NAMES.has(eventNameParam)
      ? (eventNameParam as EventName)
      : undefined;
  const successParam = url.searchParams.get('success');
  const limit = Math.min(
    Math.max(Number(url.searchParams.get('limit') ?? '50') || 50, 1),
    200
  );
  const cursor = url.searchParams.get('cursor') || undefined;

  const logs = await prisma.metaEventLog.findMany({
    where: {
      ...(storeId ? { storeId } : {}),
      ...(eventName ? { eventName } : {}),
      ...(successParam === 'true'
        ? { success: true }
        : successParam === 'false'
          ? { success: false }
          : {}),
    },
    orderBy: { sentAt: 'desc' },
    take: limit + 1,
    ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    select: {
      id: true,
      storeId: true,
      eventId: true,
      eventName: true,
      responseStatus: true,
      eventsReceived: true,
      fbtraceId: true,
      errorMessage: true,
      attempt: true,
      success: true,
      deadLettered: true,
      sentAt: true,
      nextRetryAt: true,
      relatedOrderId: true,
    },
  });

  let nextCursor: string | null = null;
  if (logs.length > limit) {
    const last = logs.pop();
    nextCursor = last ? last.id : null;
  }

  return NextResponse.json({ logs, next_cursor: nextCursor });
}
