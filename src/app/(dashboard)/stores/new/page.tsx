import Link from 'next/link';
import { StoreForm } from '@/components/StoreForm';

export default function NewStorePage() {
  return (
    <div>
      <div className="mb-6">
        <Link href="/stores" className="text-sm text-gray-500 hover:text-gray-900">
          ← Stores
        </Link>
        <h1 className="text-2xl font-semibold mt-1">Add store</h1>
      </div>
      <StoreForm />
    </div>
  );
}
