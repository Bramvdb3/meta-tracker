import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getServerSession } from 'next-auth';
import { prisma } from '@/lib/prisma';
import { authOptions } from '@/lib/auth';
import { StoreForm } from '@/components/StoreForm';

export const dynamic = 'force-dynamic';

export default async function EditStorePage({
  params,
}: {
  params: { id: string };
}) {
  const session = await getServerSession(authOptions);
  const userId = (session?.user as { id?: string } | undefined)?.id;
  if (!userId) redirect('/login');

  const store = await prisma.store.findFirst({
    where: { id: params.id, userId },
    select: {
      id: true,
      name: true,
      domain: true,
      currency: true,
      metaPixelId: true,
      metaTestEventCode: true,
      active: true,
    },
  });
  if (!store) redirect('/stores');

  return (
    <div>
      <div className="mb-6">
        <Link
          href="/stores"
          className="text-sm text-gray-500 hover:text-gray-900"
        >
          ← Stores
        </Link>
        <div className="flex items-center justify-between mt-1">
          <div>
            <h1 className="text-2xl font-semibold">{store.name}</h1>
            <p className="text-sm text-gray-500">{store.domain}</p>
          </div>
          <Link
            href={`/stores/${store.id}/install`}
            className="text-sm text-blue-600 hover:underline"
          >
            View install instructions →
          </Link>
        </div>
      </div>
      <StoreForm store={store} />
    </div>
  );
}
