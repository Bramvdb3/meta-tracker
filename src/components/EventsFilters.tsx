'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

interface Props {
  stores: { id: string; name: string }[];
  initial: {
    store_id?: string;
    event_name?: string;
    source?: string;
    success?: string;
    from?: string;
    to?: string;
  };
}

const selectCls =
  'border border-gray-300 rounded px-2 py-1.5 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-gray-900';

export function EventsFilters({ stores, initial }: Props) {
  const router = useRouter();
  const [storeId, setStoreId] = useState(initial.store_id || '');
  const [eventName, setEventName] = useState(initial.event_name || '');
  const [source, setSource] = useState(initial.source || '');
  const [success, setSuccess] = useState(initial.success || '');
  const [from, setFrom] = useState(initial.from || '');
  const [to, setTo] = useState(initial.to || '');

  function apply() {
    const params = new URLSearchParams();
    if (storeId) params.set('store_id', storeId);
    if (eventName) params.set('event_name', eventName);
    if (source) params.set('source', source);
    if (success) params.set('success', success);
    if (from) params.set('from', from);
    if (to) params.set('to', to);
    router.push(`/events${params.size ? '?' + params.toString() : ''}`);
  }

  function reset() {
    setStoreId('');
    setEventName('');
    setSource('');
    setSuccess('');
    setFrom('');
    setTo('');
    router.push('/events');
  }

  return (
    <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-4">
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
        <select
          value={storeId}
          onChange={(e) => setStoreId(e.target.value)}
          className={selectCls}
        >
          <option value="">All stores</option>
          {stores.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
        <select
          value={eventName}
          onChange={(e) => setEventName(e.target.value)}
          className={selectCls}
        >
          <option value="">All events</option>
          {['PageView', 'ViewContent', 'AddToCart', 'InitiateCheckout', 'Purchase'].map(
            (n) => (
              <option key={n} value={n}>
                {n}
              </option>
            )
          )}
        </select>
        <select
          value={source}
          onChange={(e) => setSource(e.target.value)}
          className={selectCls}
        >
          <option value="">All sources</option>
          {['BROWSER', 'WEBHOOK', 'SERVER'].map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
        <select
          value={success}
          onChange={(e) => setSuccess(e.target.value)}
          className={selectCls}
        >
          <option value="">All CAPI states</option>
          <option value="true">CAPI success</option>
          <option value="false">CAPI failed</option>
          <option value="skipped">CAPI skipped</option>
          <option value="pending">CAPI pending</option>
        </select>
        <input
          type="date"
          value={from}
          onChange={(e) => setFrom(e.target.value)}
          className={selectCls}
          placeholder="From"
        />
        <input
          type="date"
          value={to}
          onChange={(e) => setTo(e.target.value)}
          className={selectCls}
          placeholder="To"
        />
      </div>
      <div className="flex gap-3 mt-3 items-center">
        <button
          type="button"
          onClick={apply}
          className="bg-gray-900 hover:bg-gray-800 text-white text-sm font-medium px-4 py-1.5 rounded"
        >
          Apply
        </button>
        <button
          type="button"
          onClick={reset}
          className="text-sm text-gray-600 hover:text-gray-900"
        >
          Reset
        </button>
      </div>
    </div>
  );
}
