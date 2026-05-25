/**
 * Determines the MatchSource for a Shopify order based on what tracking
 * data is available. The match source drives both the dashboard quality
 * indicator and the fallback chain for the event_id.
 *
 *   CART_ATTRIBUTES        — _mt_purchase_eid (or _mt_cid/_fbp/_fbc) in note_attributes
 *   SHOPIFY_CLIENT_DETAILS — no cart attrs, but client_details.browser_ip / user_agent present
 *   CUSTOMER_DATA_ONLY     — only customer fields (email/phone/name) available
 *   FALLBACK_ORDER_ID      — last resort, only order_id usable
 */

import { MatchSource } from '@prisma/client';
import type { ParsedMtAttributes } from './cart-attributes';

interface ShopifyClientDetails {
  browser_ip?: string | null;
  user_agent?: string | null;
}

interface ShopifyCustomerSummary {
  email?: string | null;
  phone?: string | null;
  first_name?: string | null;
  last_name?: string | null;
}

export interface MatchInput {
  mt: ParsedMtAttributes;
  clientDetails?: ShopifyClientDetails | null;
  customer?: ShopifyCustomerSummary | null;
}

export function determineMatchSource(input: MatchInput): MatchSource {
  if (
    input.mt.purchaseEventId ||
    input.mt.clientId ||
    input.mt.fbp ||
    input.mt.fbc
  ) {
    return MatchSource.CART_ATTRIBUTES;
  }
  if (
    input.clientDetails &&
    (input.clientDetails.browser_ip || input.clientDetails.user_agent)
  ) {
    return MatchSource.SHOPIFY_CLIENT_DETAILS;
  }
  if (
    input.customer &&
    (input.customer.email ||
      input.customer.phone ||
      input.customer.first_name ||
      input.customer.last_name)
  ) {
    return MatchSource.CUSTOMER_DATA_ONLY;
  }
  return MatchSource.FALLBACK_ORDER_ID;
}
