import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getServerSession } from 'next-auth';
import { CapiStatus, Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { authOptions } from '@/lib/auth';
import { RetryButton } from '@/components/RetryButton';

export const dynamic = 'force-dynamic';

interface SearchParams {
  store_id?: string;
  status?: string;
  page?: string;
}

const PAGE_SIZE = 50;

export default async function OrdersPage({
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

  const where: Prisma.OrderWhereInput = { store: { userId } };
  if (searchParams.store_id) where.storeId = searchParams.store_id;
  if (
    searchParams.status &&
    (Object.values(CapiStatus) as string[]).includes(searchParams.status)
  ) {
    where.capiStatus = searchParams.status as CapiStatus;
  }

  const page = Math.max(parseInt(searchParams.page || '1', 10) || 1, 1);

  const orders = await prisma.order.findMany({
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
          attempt: true,
        },
      },
    },
    orderBy: { placedAt: 'desc' },
    take: PAGE_SIZE,
    skip: (page - 1) * PAGE_SIZE,
  });

  return (
    <div>
      <h1 className="text-2xl font-semibold mb-6">Orders</h1>

      <form
        method="get"
        className="bg-white rounded-lg shadow-sm border border-gray-200 p-4 mb-4 flex flex-wrap gap-3 items-end"
      >
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">
            Store
          </label>
          <select
            name="store_id"
            defaultValue={searchParams.store_id || ''}
            className="border border-gray-300 rounded px-2 py-1.5 text-sm bg-white"
          >
            <option value="">All</option>
            {stores.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">
            Status
          </label>
          <select
            name="status"
            defaultValue={searchParams.status || ''}
            className="border border-gray-300 rounded px-2 py-1.5 text-sm bg-white"
          >
            <option value="">All</option>
            {Object.values(CapiStatus).map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </div>
        <button
          type="submit"
          className="bg-gray-900 hover:bg-gray-800 text-white text-sm font-medium px-4 py-1.5 rounded"
        >
          Apply
        </button>
      </form>

      <div className="bg-white rounded-lg shadow-sm border border-gray-200 overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-left text-gray-700 text-xs uppercase">
            <tr>
              <th className="px-3 py-2 font-medium">Order #</th>
              <th className="px-3 py-2 font-medium">Shopify ID</th>
              <th className="px-3 py-2 font-medium">Total</th>
              <th className="px-3 py-2 font-medium">Placed</th>
              <th className="px-3 py-2 font-medium">Store</th>
              <th className="px-3 py-2 font-medium">CAPI</th>
              <th className="px-3 py-2 font-medium">Match</th>
              <th className="px-3 py-2 font-medium">Event ID used</th>
              <th className="px-3 py-2 font-medium">Last response</th>
              <th className="px-3 py-2 font-medium"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-200">
            {orders.map((o) => {
              const log = o.metaLogs[0];
              const canRetry =
                log &&
                !log.success &&
                (o.capiStatus === CapiStatus.FAILED ||
                  o.capiStatus === CapiStatus.DEAD_LETTERED);
              return (
                <tr key={o.id} className="hover:bg-gray-50">
                  <td className="px-3 py-2 font-medium whitespace-nowrap">
                    {o.orderNumber || '—'}
                  </td>
                  <td className="px-3 py-2 text-xs font-mono text-gray-600 whitespace-nowrap">
                    {o.shopifyOrderId}
                  </td>
                  <td className="px-3 py-2 whitespace-nowrap">
                    {o.totalPrice.toString()} {o.currency}
                  </td>
                  <td className="px-3 py-2 text-xs whitespace-nowrap">
                    {o.placedAt.toISOString().replace('T', ' ').slice(0, 16)}
                  </td>
                  <td className="px-3 py-2 whitespace-nowrap">
                    {o.store.name}
                  </td>
                  <td className="px-3 py-2">
                    <StatusBadge status={o.capiStatus} />
                  </td>
                  <td className="px-3 py-2 text-xs text-gray-700 whitespace-nowrap">
                    {o.matchSource ?? '—'}
                  </td>
                  <td
                    className="px-3 py-2 text-xs font-mono text-gray-600 max-w-[160px] truncate"
                    title={o.capiEventIdUsed ?? ''}
                  >
                    {o.capiEventIdUsed ?? '—'}
                  </td>
                  <td
                    className="px-3 py-2 text-xs max-w-[220px] truncate"
                    title={log?.errorMessage ?? log?.fbtraceId ?? ''}
                  >
                    {log
                      ? log.success
                        ? `✓ ${log.responseStatus ?? ''} ${
                            log.fbtraceId ?? ''
                          }`.trim()
                        : `✗ ${log.errorMessage ?? log.responseStatus ?? ''}`
                      : '—'}
                  </td>
                  <td className="px-3 py-2">
                    {canRetry && log ? <RetryButton logId={log.id} /> : null}
                  </td>
                </tr>
              );
            })}
            {orders.length === 0 && (
              <tr>
                <td
                  colSpan={10}
                  className="px-3 py-12 text-center text-gray-500"
                >
                  Geen orders.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="flex justify-between items-center mt-4 text-sm">
        {page > 1 ? (
          <Link
            href={paginate(searchParams, page - 1)}
            className="px-3 py-1 rounded border border-gray-300 hover:bg-gray-100"
          >
            ← Previous
          </Link>
        ) : (
          <span className="px-3 py-1 text-gray-300">← Previous</span>
        )}
        <span className="text-gray-500">Page {page}</span>
        {orders.length === PAGE_SIZE ? (
          <Link
            href={paginate(searchParams, page + 1)}
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

function paginate(sp: SearchParams, page: number): string {
  const params = new URLSearchParams();
  if (sp.store_id) params.set('store_id', sp.store_id);
  if (sp.status) params.set('status', sp.status);
  params.set('page', String(page));
  return `/orders?${params.toString()}`;
}

function StatusBadge({ status }: { status: CapiStatus }) {
  const map: Record<CapiStatus, string> = {
    PENDING: 'bg-gray-100 text-gray-700',
    SUCCESS: 'bg-green-100 text-green-800',
    FAILED: 'bg-amber-100 text-amber-800',
    DEAD_LETTERED: 'bg-red-100 text-red-800',
    SKIPPED: 'bg-blue-100 text-blue-800',
  };
  return (
    <span
      className={`inline-block px-2 py-0.5 rounded text-xs ${map[status]}`}
    >
      {status}
    </span>
  );
}
