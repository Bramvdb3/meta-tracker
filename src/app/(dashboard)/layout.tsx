import { redirect } from 'next/navigation';
import { getServerSession } from 'next-auth';
import Link from 'next/link';
import { authOptions } from '@/lib/auth';
import { SignOutButton } from '@/components/SignOutButton';

const NAV = [
  { href: '/dashboard', label: 'Dashboard' },
  { href: '/stores', label: 'Stores' },
  { href: '/events', label: 'Events' },
  { href: '/orders', label: 'Orders' },
  { href: '/failed', label: 'Failed' },
];

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await getServerSession(authOptions);
  if (!session) redirect('/login');

  return (
    <div className="min-h-screen flex bg-gray-50">
      <aside className="w-56 bg-white border-r border-gray-200 flex flex-col">
        <div className="px-4 py-5 border-b border-gray-200">
          <Link href="/dashboard" className="text-lg font-semibold">
            Meta Tracker
          </Link>
        </div>
        <nav className="flex-1 px-2 py-4 space-y-1">
          {NAV.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className="block px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-100 rounded"
            >
              {item.label}
            </Link>
          ))}
        </nav>
        <div className="border-t border-gray-200 px-4 py-3">
          <div className="text-xs text-gray-500 mb-2 truncate">
            {session.user?.email}
          </div>
          <SignOutButton />
        </div>
      </aside>
      <main className="flex-1 min-w-0">
        <div className="max-w-7xl mx-auto px-6 py-8">{children}</div>
      </main>
    </div>
  );
}
