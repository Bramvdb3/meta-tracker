/**
 * Parses Shopify webhook `note_attributes` (an array of {name, value}) into
 * a typed object containing the _mt_* tracking attributes written by the
 * front-end script via POST /cart/update.js.
 */

export interface ShopifyNoteAttribute {
  name: string;
  value: string | null;
}

export interface ParsedMtAttributes {
  clientId: string | null;
  fbp: string | null;
  fbc: string | null;
  fbclid: string | null;
  purchaseEventId: string | null;
  landingUrl: string | null;
  userAgent: string | null;
}

export function parseNoteAttributes(
  noteAttributes: ShopifyNoteAttribute[] | undefined | null
): ParsedMtAttributes {
  const map = new Map<string, string>();
  if (Array.isArray(noteAttributes)) {
    for (const attr of noteAttributes) {
      if (
        attr &&
        typeof attr.name === 'string' &&
        typeof attr.value === 'string' &&
        attr.value.length > 0
      ) {
        map.set(attr.name, attr.value);
      }
    }
  }
  return {
    clientId: map.get('_mt_cid') ?? null,
    fbp: map.get('_mt_fbp') ?? null,
    fbc: map.get('_mt_fbc') ?? null,
    fbclid: map.get('_mt_fbclid') ?? null,
    purchaseEventId: map.get('_mt_purchase_eid') ?? null,
    landingUrl: map.get('_mt_landing_url') ?? null,
    userAgent: map.get('_mt_user_agent') ?? null,
  };
}

export function hasAnyMtAttributes(parsed: ParsedMtAttributes): boolean {
  return !!(
    parsed.clientId ||
    parsed.fbp ||
    parsed.fbc ||
    parsed.purchaseEventId
  );
}
