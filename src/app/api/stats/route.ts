/**
 * GET /api/stats?store_id=&days=14
 *
 * Dashboard aggregates:
 *   - event counts per event name (in window)
 *   - revenue + order count (in window, only SUCCESS-flagged orders)
 *   - CAPI status breakdown
 *   - match source breakdown
 *   - by-day breakdown of events
 */

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { Prisma } from '@prisma/client';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';

export const runtime = 'nodejs';

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const url = new URL(req.url);
  const storeId = url.searchParams.get('store_id') || undefined;
  const daysRaw = Number(url.searchParams.get('days') ?? '14');
  const days = Number.isFinite(daysRaw) && daysRaw > 0 ? Math.min(daysRaw, 365) : 14;
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

  const eventWhere = {
    ...(storeId ? { storeId } : {}),
    eventTime: { gte: since },
  };
  const orderWhere = {
    ...(storeId ? { storeId } : {}),
    placedAt: { gte: since },
  };

  const [eventCounts, revenue, capiBreakdown, matchSourceBreakdown, dayStats] =
    await Promise.all([
      prisma.event.groupBy({
        by: ['eventName'],
        where: eventWhere,
        _count: { _all: true },
      }),
      prisma.order.aggregate({
        where: { ...orderWhere, capiStatus: 'SUCCESS' },
        _sum: { totalPrice: true },
        _count: { _all: true },
      }),
      prisma.order.groupBy({
        by: ['capiStatus'],
        where: orderWhere,
        _count: { _all: true },
      }),
      prisma.order.groupBy({
        by: ['matchSource'],
        where: orderWhere,
        _count: { _all: true },
      }),
      prisma.$queryRaw<{ day: Date; event_name: string; count: bigint }[]>`
        SELECT date_trunc('day', "eventTime") AS day,
               "eventName"::text AS event_name,
               count(*) AS count
        FROM "Event"
        WHERE "eventTime" >= ${since}
          ${storeId ? Prisma.sql`AND "storeId" = ${storeId}` : Prisma.empty}
        GROUP BY day, "eventName"
        ORDER BY day DESC
      `,
    ]);

  return NextResponse.json({
    window_days: days,
    event_counts: eventCounts.map((r) => ({
      event_name: r.eventName,
      count: r._count._all,
    })),
    revenue: {
      total: revenue._sum.totalPrice?.toString() ?? '0',
      orders: revenue._count._all,
    },
    capi_breakdown: capiBreakdown.map((r) => ({
      status: r.capiStatus,
      count: r._count._all,
    })),
    match_source_breakdown: matchSourceBreakdown.map((r) => ({
      source: r.matchSource,
      count: r._count._all,
    })),
    by_day: dayStats.map((r) => ({
      day: r.day,
      event_name: r.event_name,
      count: Number(r.count),
    })),
  });
}
