/**
 * POST /api/webhooks/woocommerce/orders
 *
 * WooCommerce orders arrive from the store's own server (the Laurentide theme
 * / plugin) in the same JSON shape as a Shopify order, signed with the store's
 * webhook secret:
 *   X-MT-Shop-Domain:  <Store.domain>          (e.g. laurentide-ca.com)
 *   X-MT-Hmac-Sha256:  base64(HMAC-SHA256(rawBody, webhook secret))
 *
 * The Shopify handler already does everything we need (dedup, hashing, CAPI
 * Purchase, logging), so this route simply reuses it. The Shopify handler
 * accepts the X-MT-* headers as aliases for the X-Shopify-* ones.
 */
export { POST } from '../../shopify/orders/route';
export const runtime = 'nodejs';
