import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getServerSession } from 'next-auth';
import { EventName, EventSource, Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { authOptions } from '@/lib/auth';
import { EventsFilters } from '@/components/EventsFilters';

export const dynamic = 'force-dynamic';

interface SearchParams {
  store_id?: string;
  event_name?: string;
  source?: string;
  success?: string;
  from?: string;
  to?: string;
  page?: string;
}

const PAGE_SIZE = 50;

export default async function EventsPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const session = await getServerSession(authOptions);
  const userId = (session?.user as { id?: string } | undefined)?.id;
  if (!userId) redirect('/login');

  const stores = await prisma.store.findMany({
    where: { userId },
    select: { id: true, name: true },
    orderBy: { name: 'asc' },
  });

  const where: Prisma.EventWhereInput = { store: { userId } };
  if (searchParams.store_id) where.storeId = searchParams.store_id;
  if (
    searchParams.event_name &&
    (Object.values(EventName) as string[]).includes(searchParams.event_name)
  ) {
    where.eventName = searchParams.event_name as EventName;
  }
  if (
    searchParams.source &&
    (Object.values(EventSource) as string[]).includes(searchParams.source)
  ) {
    where.source = searchParams.source as EventSource;
  }
  if (searchParams.from || searchParams.to) {
    const range: Prisma.DateTimeFilter = {};
    if (searchParams.from) range.gte = new Date(searchParams.from);
    if (searchParams.to) {
      const end = new Date(searchParams.to);
      end.setHours(23, 59, 59, 999);
      range.lte = end;
    }
    where.eventTime = range;
  }

  const page = Math.max(parseInt(searchParams.page || '1', 10) || 1, 1);

  const events = await prisma.event.findMany({
    where,
    include: {
      store: { select: { name: true } },
      metaLogs: {
        orderBy: { sentAt: 'desc' },
        take: 1,
        select: {
          id: true,
          success: true,
          responseStatus: true,
          fbtraceId: true,
          errorMessage: true,
          deadLettered: true,
        },
      },
    },
    orderBy: { eventTime: 'desc' },
    take: PAGE_SIZE,
    skip: (page - 1) * PAGE_SIZE,
  });

  // Client-side state filter on CAPI status (depends on latest log + skip reason)
  const filtered = events.filter((e) => {
    const log = e.metaLogs[0];
    const filter = searchParams.success;
    if (!filter) return true;
    if (filter === 'skipped') return !!e.capiForwardingSkippedReason;
    if (filter === 'pending') return !e.capiForwardingSkippedReason && !log;
    if (filter === 'true') return !!log && log.success;
    if (filter === 'false') return !!log && !log.success;
    return true;
  });

  const qsBase = (overrides: Partial<SearchParams>): string => {
    const params = new URLSearchParams();
    const all = { ...searchParams, ...overrides };
    for (const [k, v] of Object.entries(all)) {
      if (v) params.set(k, String(v));
    }
    return params.toString();
  };

  return (
    <div>
      <h1 className="text-2xl font-semibold mb-6">Events</h1>

      <EventsFilters stores={stores} initial={searchParams} />

      <div className="bg-white rounded-lg shadow-sm border border-gray-200 overflow-x-auto mt-4">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-left text-gray-700 text-xs uppercase">
            <tr>
              <th className="px-3 py-2 font-medium">Time</th>
              <th className="px-3 py-2 font-medium">Store</th>
              <th className="px-3 py-2 font-medium">Event</th>
              <th className="px-3 py-2 font-medium">Source</th>
              <th className="px-3 py-2 font-medium">Event ID</th>
              <th className="px-3 py-2 font-medium">Forwarded</th>
              <th className="px-3 py-2 font-medium">Skip reason</th>
              <th className="px-3 py-2 font-medium">Status</th>
              <th className="px-3 py-2 font-medium">FBTrace</th>
              <th className="px-3 py-2 font-medium">Error</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-200">
            {filtered.map((e) => {
              const log = e.metaLogs[0];
              const skipped = !!e.capiForwardingSkippedReason;
              const forwarded = !skipped && !!log;
              return (
                <tr key={e.id} className="hover:bg-gray-50">
                  <td className="px-3 py-2 text-xs whitespace-nowrap text-gray-700">
                    {fmtDate(e.eventTime)}
                  </td>
                  <td className="px-3 py-2 whitespace-nowrap">{e.store.name}</td>
                  <td className="px-3 py-2 font-medium whitespace-nowrap">
                    {e.eventName}
                  </td>
                  <td className="px-3 py-2 text-xs text-gray-600">{e.source}</td>
                  <td
                    className="px-3 py-2 font-mono text-xs text-gray-600 max-w-[160px] truncate"
                    title={e.eventId}
                  >
                    {e.eventId}
                  </td>
                  <td className="px-3 py-2 text-xs">
                    {skipped ? (
                      <span className="text-gray-500">No</span>
                    ) : forwarded ? (
                      <span className="text-green-700">Yes</span>
                    ) : (
                      <span className="text-gray-400">Pending</span>
                    )}
                  </td>
                  <td
                    className="px-3 py-2 text-xs text-gray-600 max-w-[180px] truncate"
                    title={e.capiForwardingSkippedReason ?? ''}
                  >
                    {e.capiForwardingSkippedReason ?? '—'}
                  </td>
                  <td className="px-3 py-2">
                    {skipped ? (
                      <Badge tone="blue">Skipped</Badge>
                    ) : log ? (
                      log.success ? (
                        <Badge tone="green">
                          {log.responseStatus ?? 'OK'}
                        </Badge>
                      ) : log.deadLettered ? (
                        <Badge tone="red">Dead</Badge>
                      ) : (
                        <Badge tone="amber">Failed</Badge>
                      )
                    ) : (
                      <Badge tone="gray">—</Badge>
                    )}
                  </td>
                  <td
                    className="px-3 py-2 text-xs font-mono text-gray-600 max-w-[140px] truncate"
                    title={log?.fbtraceId ?? ''}
                  >
                    {log?.fbtraceId ?? '—'}
                  </td>
                  <td
                    className="px-3 py-2 text-xs text-red-600 max-w-[240px] truncate"
                    title={log?.errorMessage ?? ''}
                  >
                    {log?.errorMessage ?? '—'}
                  </td>
                </tr>
              );
            })}
            {filtered.length === 0 && (
              <tr>
                <td
                  colSpan={10}
                  className="px-3 py-12 text-center text-gray-500"
                >
                  Geen events matchen deze filters.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="flex justify-between items-center mt-4 text-sm">
        {page > 1 ? (
          <Link
            href={`/events?${qsBase({ page: String(page - 1) })}`}
            className="px-3 py-1 rounded border border-gray-300 hover:bg-gray-100"
          >
            ← Previous
          </Link>
        ) : (
          <span className="px-3 py-1 text-gray-300">← Previous</span>
        )}
        <span className="text-gray-500">Page {page}</span>
        {events.length === PAGE_SIZE ? (
          <Link
            href={`/events?${qsBase({ page: String(page + 1) })}`}
            className="px-3 py-1 rounded border border-gray-300 hover:bg-gray-100"
          >
            Next →
          </Link>
        ) : (
          <span className="px-3 py-1 text-gray-300">Next →</span>
        )}
      </div>
    </div>
  );
}

function Badge({
  children,
  tone,
}: {
  children: React.ReactNode;
  tone: 'green' | 'amber' | 'red' | 'blue' | 'gray';
}) {
  const map: Record<typeof tone, string> = {
    green: 'bg-green-100 text-green-800',
    amber: 'bg-amber-100 text-amber-800',
    red: 'bg-red-100 text-red-800',
    blue: 'bg-blue-50 text-blue-700',
    gray: 'bg-gray-100 text-gray-600',
  };
  return (
    <span
      className={`inline-block px-1.5 py-0.5 rounded text-xs ${map[tone]}`}
    >
      {children}
    </span>
  );
}

function fmtDate(d: Date): string {
  return d.toISOString().replace('T', ' ').slice(0, 19);
}
