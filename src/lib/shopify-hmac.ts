import { createHmac, timingSafeEqual } from 'crypto';

/**
 * Verifies the X-Shopify-Hmac-Sha256 header against the raw request body.
 * The webhook secret per store is decrypted from Store.shopifyWebhookSecretEnc.
 */
export function verifyShopifyHmac(
  rawBody: string,
  hmacHeader: string | null,
  secret: string
): boolean {
  if (!hmacHeader || !secret) return false;
  const computed = createHmac('sha256', secret).update(rawBody, 'utf8').digest('base64');
  const a = Buffer.from(computed);
  const b = Buffer.from(hmacHeader);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}
