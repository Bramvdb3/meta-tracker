'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

export function RetryButton({ logId }: { logId: string }) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [outcome, setOutcome] = useState<'idle' | 'ok' | 'fail'>('idle');

  async function retry() {
    setLoading(true);
    setOutcome('idle');
    try {
      const res = await fetch(`/api/events/${logId}/retry`, { method: 'POST' });
      const data = await res.json().catch(() => ({}));
      setOutcome(data?.success ? 'ok' : 'fail');
      router.refresh();
    } catch {
      setOutcome('fail');
    } finally {
      setLoading(false);
    }
  }

  const label = loading
    ? '…'
    : outcome === 'ok'
      ? '✓ Retried'
      : outcome === 'fail'
        ? '✗ Failed'
        : 'Retry';

  return (
    <button
      type="button"
      onClick={retry}
      disabled={loading}
      className="text-xs bg-gray-100 hover:bg-gray-200 text-gray-700 px-2 py-1 rounded disabled:opacity-50 whitespace-nowrap"
    >
      {label}
    </button>
  );
}
