import { redirect } from 'next/navigation';
import { getServerSession } from 'next-auth';
import { prisma } from '@/lib/prisma';
import { authOptions } from '@/lib/auth';
import { RetryButton } from '@/components/RetryButton';

export const dynamic = 'force-dynamic';

export default async function FailedEventsPage() {
  const session = await getServerSession(authOptions);
  const userId = (session?.user as { id?: string } | undefined)?.id;
  if (!userId) redirect('/login');

  const logs = await prisma.metaEventLog.findMany({
    where: {
      success: false,
      store: { userId },
    },
    include: {
      store: { select: { name: true } },
    },
    orderBy: { sentAt: 'desc' },
    take: 200,
  });

  const deadCount = logs.filter((l) => l.deadLettered).length;
  const failedCount = logs.length - deadCount;

  return (
    <div>
      <div className="flex items-baseline gap-4 mb-2">
        <h1 className="text-2xl font-semibold">Failed events</h1>
        <span className="text-sm text-gray-500">
          {failedCount} failed · {deadCount} dead-lettered
        </span>
      </div>
      <p className="text-sm text-gray-600 mb-4">
        Events die bij Meta een fout opleverden. De cron retried failed events
        met exponential backoff (1m → 24h, max 6 pogingen) — daarna worden ze
        dead-lettered. Klik Retry voor handmatige opnieuw-poging.
      </p>

      <div className="bg-white rounded-lg shadow-sm border border-gray-200 overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-left text-gray-700 text-xs uppercase">
            <tr>
              <th className="px-3 py-2 font-medium">Sent at</th>
              <th className="px-3 py-2 font-medium">Store</th>
              <th className="px-3 py-2 font-medium">Event</th>
              <th className="px-3 py-2 font-medium">Event ID</th>
              <th className="px-3 py-2 font-medium">Attempt</th>
              <th className="px-3 py-2 font-medium">Status</th>
              <th className="px-3 py-2 font-medium">Error</th>
              <th className="px-3 py-2 font-medium">Next retry</th>
              <th className="px-3 py-2"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-200">
            {logs.map((l) => (
              <tr key={l.id} className="hover:bg-gray-50">
                <td className="px-3 py-2 text-xs whitespace-nowrap">
                  {l.sentAt.toISOString().replace('T', ' ').slice(0, 19)}
                </td>
                <td className="px-3 py-2 whitespace-nowrap">{l.store.name}</td>
                <td className="px-3 py-2 font-medium whitespace-nowrap">
                  {l.eventName}
                </td>
                <td
                  className="px-3 py-2 text-xs font-mono text-gray-600 max-w-[160px] truncate"
                  title={l.eventId}
                >
                  {l.eventId}
                </td>
                <td className="px-3 py-2 text-xs">{l.attempt}</td>
                <td className="px-3 py-2">
                  {l.deadLettered ? (
                    <span className="inline-block px-2 py-0.5 rounded text-xs bg-red-100 text-red-800">
                      Dead
                    </span>
                  ) : (
                    <span className="inline-block px-2 py-0.5 rounded text-xs bg-amber-100 text-amber-800">
                      Failed
                    </span>
                  )}
                </td>
                <td
                  className="px-3 py-2 text-xs text-red-600 max-w-[280px] truncate"
                  title={l.errorMessage ?? ''}
                >
                  {l.errorMessage ?? '—'}
                </td>
                <td className="px-3 py-2 text-xs whitespace-nowrap">
                  {l.nextRetryAt
                    ? l.nextRetryAt.toISOString().replace('T', ' ').slice(0, 19)
                    : '—'}
                </td>
                <td className="px-3 py-2">
                  <RetryButton logId={l.id} />
                </td>
              </tr>
            ))}
            {logs.length === 0 && (
              <tr>
                <td
                  colSpan={9}
                  className="px-3 py-12 text-center text-gray-500"
                >
                  Geen failed events. 🎉
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
