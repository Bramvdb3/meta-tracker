import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getServerSession } from 'next-auth';
import { prisma } from '@/lib/prisma';
import { authOptions } from '@/lib/auth';

export const dynamic = 'force-dynamic';

export default async function StoresPage() {
  const session = await getServerSession(authOptions);
  const userId = (session?.user as { id?: string } | undefined)?.id;
  if (!userId) redirect('/login');

  const stores = await prisma.store.findMany({
    where: { userId },
    orderBy: { createdAt: 'desc' },
    select: {
      id: true,
      name: true,
      domain: true,
      currency: true,
      metaPixelId: true,
      active: true,
    },
  });

  return (
    <div>
      <div className="flex justify-between items-center mb-6">
        <h1 className="text-2xl font-semibold">Stores</h1>
        <Link
          href="/stores/new"
          className="bg-gray-900 hover:bg-gray-800 text-white text-sm font-medium px-4 py-2 rounded"
        >
          Add store
        </Link>
      </div>

      <div className="bg-white rounded-lg shadow-sm border border-gray-200 overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-left text-gray-700 text-xs uppercase">
            <tr>
              <th className="px-4 py-3 font-medium">Name</th>
              <th className="px-4 py-3 font-medium">Domain</th>
              <th className="px-4 py-3 font-medium">Currency</th>
              <th className="px-4 py-3 font-medium">Pixel ID</th>
              <th className="px-4 py-3 font-medium">Status</th>
              <th className="px-4 py-3"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-200">
            {stores.map((s) => (
              <tr key={s.id} className="hover:bg-gray-50">
                <td className="px-4 py-3 font-medium">{s.name}</td>
                <td className="px-4 py-3 text-gray-700">{s.domain}</td>
                <td className="px-4 py-3">{s.currency}</td>
                <td className="px-4 py-3 font-mono text-xs text-gray-600">
                  {s.metaPixelId}
                </td>
                <td className="px-4 py-3">
                  {s.active ? (
                    <span className="inline-block px-2 py-0.5 rounded text-xs bg-green-100 text-green-800">
                      Active
                    </span>
                  ) : (
                    <span className="inline-block px-2 py-0.5 rounded text-xs bg-gray-100 text-gray-600">
                      Inactive
                    </span>
                  )}
                </td>
                <td className="px-4 py-3 text-right space-x-4 whitespace-nowrap">
                  <Link
                    href={`/stores/${s.id}/install`}
                    className="text-blue-600 hover:underline text-sm"
                  >
                    Install
                  </Link>
                  <Link
                    href={`/stores/${s.id}`}
                    className="text-blue-600 hover:underline text-sm"
                  >
                    Edit
                  </Link>
                </td>
              </tr>
            ))}
            {stores.length === 0 && (
              <tr>
                <td
                  colSpan={6}
                  className="px-4 py-12 text-center text-gray-500"
                >
                  Nog geen stores. Klik &quot;Add store&quot; om er een toe te
                  voegen.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
