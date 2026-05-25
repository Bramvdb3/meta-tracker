'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

interface ExistingStore {
  id: string;
  name: string;
  domain: string;
  currency: string;
  metaPixelId: string;
  metaTestEventCode: string | null;
  active: boolean;
}

interface Props {
  store?: ExistingStore;
}

const inputCls =
  'block w-full border border-gray-300 rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-gray-900';

export function StoreForm({ store }: Props) {
  const router = useRouter();
  const isEdit = !!store;

  const [name, setName] = useState(store?.name ?? '');
  const [domain, setDomain] = useState(store?.domain ?? '');
  const [currency, setCurrency] = useState(store?.currency ?? 'EUR');
  const [pixelId, setPixelId] = useState(store?.metaPixelId ?? '');
  const [testEventCode, setTestEventCode] = useState(
    store?.metaTestEventCode ?? ''
  );
  const [accessToken, setAccessToken] = useState('');
  const [webhookSecret, setWebhookSecret] = useState('');
  const [active, setActive] = useState(store?.active ?? true);

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);

    const body: Record<string, unknown> = {
      name,
      domain,
      currency: currency.toUpperCase(),
      meta_pixel_id: pixelId,
    };
    // POST schema rejects null; PATCH schema accepts null to clear the field.
    if (isEdit) {
      body.meta_test_event_code = testEventCode || null;
    } else if (testEventCode) {
      body.meta_test_event_code = testEventCode;
    }
    if (accessToken) body.meta_access_token = accessToken;
    if (webhookSecret) body.shopify_webhook_secret = webhookSecret;
    if (isEdit) body.active = active;

    try {
      const res = await fetch(
        isEdit ? `/api/stores/${store!.id}` : '/api/stores',
        {
          method: isEdit ? 'PATCH' : 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        }
      );
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data?.error || 'Save failed');
        return;
      }
      router.push('/stores');
      router.refresh();
    } finally {
      setSubmitting(false);
    }
  }

  async function handleDelete() {
    if (!isEdit || !store) return;
    if (
      !window.confirm(
        'Store deactiveren? Bestaande data blijft bewaard. Active wordt op false gezet.'
      )
    ) {
      return;
    }
    const res = await fetch(`/api/stores/${store.id}`, { method: 'DELETE' });
    if (res.ok) {
      router.push('/stores');
      router.refresh();
    }
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="bg-white rounded-lg shadow-sm border border-gray-200 p-6 space-y-5 max-w-2xl"
    >
      <Field label="Store name">
        <input
          type="text"
          required
          value={name}
          onChange={(e) => setName(e.target.value)}
          className={inputCls}
        />
      </Field>

      <Field
        label="Domain"
        help="Exact zoals Shopify het stuurt in X-Shopify-Shop-Domain (meestal mystore.myshopify.com)."
      >
        <input
          type="text"
          required
          value={domain}
          onChange={(e) => setDomain(e.target.value)}
          className={inputCls}
        />
      </Field>

      <Field label="Currency">
        <input
          type="text"
          required
          maxLength={3}
          value={currency}
          onChange={(e) => setCurrency(e.target.value.toUpperCase())}
          className={`${inputCls} w-24`}
        />
      </Field>

      <Field label="Meta Pixel ID">
        <input
          type="text"
          required
          value={pixelId}
          onChange={(e) => setPixelId(e.target.value)}
          className={inputCls}
        />
      </Field>

      <Field
        label="Meta CAPI Access Token"
        help={
          isEdit
            ? 'Leeg laten om huidige (versleuteld opgeslagen) waarde te behouden.'
            : 'Genereer in Meta Events Manager → pixel → Settings → "Generate Access Token".'
        }
      >
        <input
          type="password"
          autoComplete="new-password"
          required={!isEdit}
          value={accessToken}
          onChange={(e) => setAccessToken(e.target.value)}
          placeholder={isEdit ? '••••••••••••' : ''}
          className={inputCls}
        />
      </Field>

      <Field
        label="Shopify Webhook Secret"
        help={
          isEdit
            ? 'Leeg laten om huidige (versleuteld opgeslagen) waarde te behouden.'
            : 'Shopify Admin → Settings → Notifications → Webhooks → onderaan "Webhook secret signing".'
        }
      >
        <input
          type="password"
          autoComplete="new-password"
          required={!isEdit}
          value={webhookSecret}
          onChange={(e) => setWebhookSecret(e.target.value)}
          placeholder={isEdit ? '••••••••••••' : ''}
          className={inputCls}
        />
      </Field>

      <Field
        label="Meta Test Event Code"
        help="Optioneel — bv. TEST12345 om in Events Manager → Test Events binnen te zien komen."
      >
        <input
          type="text"
          value={testEventCode}
          onChange={(e) => setTestEventCode(e.target.value)}
          className={inputCls}
        />
      </Field>

      {isEdit && (
        <Field label="Active">
          <label className="inline-flex items-center gap-2">
            <input
              type="checkbox"
              checked={active}
              onChange={(e) => setActive(e.target.checked)}
            />
            <span className="text-sm text-gray-700">
              Receive webhooks and collect events
            </span>
          </label>
        </Field>
      )}

      {error && <div className="text-sm text-red-600">{error}</div>}

      <div className="flex items-center justify-between pt-2 border-t border-gray-100">
        <button
          type="submit"
          disabled={submitting}
          className="bg-gray-900 hover:bg-gray-800 text-white text-sm font-medium px-4 py-2 rounded disabled:opacity-50"
        >
          {submitting ? 'Saving…' : isEdit ? 'Save changes' : 'Create store'}
        </button>
        {isEdit && (
          <button
            type="button"
            onClick={handleDelete}
            className="text-sm text-red-600 hover:underline"
          >
            Deactivate store
          </button>
        )}
      </div>
    </form>
  );
}

function Field({
  label,
  help,
  children,
}: {
  label: string;
  help?: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label className="block text-sm font-medium text-gray-700 mb-1">
        {label}
      </label>
      {children}
      {help && <p className="text-xs text-gray-500 mt-1">{help}</p>}
    </div>
  );
}
