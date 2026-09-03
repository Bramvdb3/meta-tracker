# WooCommerce installatie

De tracker werkt ook voor WooCommerce-stores. Zelfde dashboard, zelfde events, zelfde CAPI-flow.

| Onderdeel | Plek | Events |
|---|---|---|
| `tracker-woo.js` | `<head>` van het WordPress-thema | PageView, ViewContent, AddToCart, InitiateCheckout (klik + checkoutpagina), Purchase op de bedankpagina (alleen opgeslagen, niet naar CAPI) |
| Order-webhook | WordPress → `POST /api/webhooks/woocommerce/orders` | **Purchase via Meta CAPI — enige autoritatieve bron** |

## Store aanmaken

Maak de store aan met `domain` = de hostname van de site (bijv. `laurentide-ca.com`, zonder `myshopify.com`), een webhook secret (vrij te kiezen, bijv. `openssl rand -hex 32`), Pixel ID en CAPI-token. De install-pagina van de store toont dan automatisch de WooCommerce-instructies.

## WordPress-kant

Het Laurentide-thema heeft dit ingebouwd (`inc/tracker.php`). Instellingen → Laurentide → *Meta Tracker*: tracker-URL, store-id en webhook secret invullen. Het thema:

1. laadt `tracker-woo.js` in de `<head>`;
2. zet `window._mt_product` (productpagina), `window._mt_cart` (checkout) en `window._mt_order` (bedankpagina);
3. stuurt `document` event `mt:addtocart` na een geslaagde add-to-cart;
4. bewaart bij het aanmaken van de order de cookies `_mt_cid`, `_fbp`, `_fbc`, `_mt_purchase_eid`, `_mt_landing_url` + IP/user-agent als order-meta;
5. POST bij betaling (`woocommerce_payment_complete` / status processing of completed) de order in Shopify-vorm naar de webhook, met `note_attributes` (`_mt_*`) en `client_details`, gesigneerd met HMAC-SHA256 (base64) in `X-MT-Hmac-Sha256` en het domein in `X-MT-Shop-Domain`.

Dedup: `event_id` van de Purchase = `_mt_purchase_eid` uit de cookie (zelfde id als de bedankpagina naar `/api/collect` stuurt); zonder cookie valt hij terug op `purchase_<order_id>`.

## Andere WooCommerce-stores

Zonder het Laurentide-thema: neem `inc/tracker.php` uit dat thema over als mu-plugin en vul de drie opties (`lt_mt_base_url`, `lt_mt_store_id`, `lt_mt_secret`) in.
