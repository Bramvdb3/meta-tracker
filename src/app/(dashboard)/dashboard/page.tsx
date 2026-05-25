import { CapiStatus } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';

export const dynamic = 'force-dynamic';

async function getStats(userId: string) {
  const startOfDay = new Date();
  startOfDay.setHours(0, 0, 0, 0);

  const storeIds = (
    await prisma.store.findMany({
      where: { userId },
      select: { id: true },
    })
  ).map((s) => s.id);

  if (storeIds.length === 0) {
    return {
      totalEvents: 0,
      purchases: 0,
      revenue: '0',
      failed: 0,
      successRate: null as number | null,
    };
  }

  const [totalEvents, purchases, revenueAgg, failed, totalLogs, successLogs] =
    await Promise.all([
      prisma.event.count({
        where: { storeId: { in: storeIds }, eventTime: { gte: startOfDay } },
      }),
      prisma.order.count({
        where: { storeId: { in: storeIds }, placedAt: { gte: startOfDay } },
      }),
      prisma.order.aggregate({
        _sum: { totalPrice: true },
        where: {
          storeId: { in: storeIds },
          placedAt: { gte: startOfDay },
          capiStatus: CapiStatus.SUCCESS,
        },
      }),
      prisma.metaEventLog.count({
        where: {
          storeId: { in: storeIds },
          success: false,
          sentAt: { gte: startOfDay },
        },
      }),
      prisma.metaEventLog.count({
        where: { storeId: { in: storeIds }, sentAt: { gte: startOfDay } },
      }),
      prisma.metaEventLog.count({
        where: {
          storeId: { in: storeIds },
          sentAt: { gte: startOfDay },
          success: true,
        },
      }),
    ]);

  return {
    totalEvents,
    purchases,
    revenue: revenueAgg._sum.totalPrice?.toString() ?? '0',
    failed,
    successRate: totalLogs === 0 ? null : (successLogs / totalLogs) * 100,
  };
}

export default async function DashboardHome() {
  const session = await getServerSession(authOptions);
  const userId = (session?.user as { id?: string } | undefined)?.id ?? '';
  const stats = await getStats(userId);

  return (
    <div>
      <h1 className="text-2xl font-semibold mb-1">Vandaag</h1>
      <p className="text-sm text-gray-500 mb-6">
        Statistieken sinds 00:00 lokale tijd.
      </p>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
        <StatCard label="Total events" value={stats.totalEvents.toLocaleString()} />
        <StatCard label="Purchases" value={stats.purchases.toLocaleString()} />
        <StatCard
          label="Revenue"
          value={`€${Number(stats.revenue).toFixed(2)}`}
        />
        <StatCard
          label="Failed CAPI"
          value={stats.failed.toLocaleString()}
          tone={stats.failed > 0 ? 'warn' : 'default'}
        />
        <StatCard
          label="Success rate"
          value={
            stats.successRate === null
              ? '—'
              : `${stats.successRate.toFixed(1)}%`
          }
          tone={
            stats.successRate !== null && stats.successRate < 90
              ? 'warn'
              : 'default'
          }
        />
      </div>
    </div>
  );
}

function StatCard({
  label,
  value,
  tone = 'default',
}: {
  label: string;
  value: string;
  tone?: 'default' | 'warn';
}) {
  return (
    <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-5">
      <div className="text-sm font-medium text-gray-500">{label}</div>
      <div
        className={`mt-2 text-3xl font-semibold ${
          tone === 'warn' ? 'text-amber-600' : 'text-gray-900'
        }`}
      >
        {value}
      </div>
    </div>
  );
}
