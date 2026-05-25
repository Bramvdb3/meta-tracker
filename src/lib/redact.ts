/**
 * Redacts PII from a Shopify webhook order payload before persisting it
 * to the database. Replaces sensitive keys with "[REDACTED]" everywhere
 * in the tree, regardless of nesting.
 *
 * Country/state codes (country_code, province_code) are kept for analytics.
 */

const REDACT_VALUE = '[REDACTED]';

const REDACT_KEYS = new Set<string>([
  'email',
  'contact_email',
  'phone',
  'name',
  'first_name',
  'last_name',
  'address1',
  'address2',
  'street',
  'company',
  'city',
  'zip',
  'postal_code',
  'latitude',
  'longitude',
]);

export function redactShopifyOrderPayload(payload: unknown): unknown {
  return redact(payload);
}

function redact(value: unknown): unknown {
  if (value === null || value === undefined) return value;
  if (Array.isArray(value)) return value.map(redact);
  if (typeof value !== 'object') return value;

  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    if (REDACT_KEYS.has(k) && v != null && (typeof v === 'string' || typeof v === 'number')) {
      out[k] = REDACT_VALUE;
    } else {
      out[k] = redact(v);
    }
  }
  return out;
}
