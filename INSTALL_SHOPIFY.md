# Shopify installatie & test gids

Deze gids koppelt je Shopify store aan de Meta Tracker. Aan het einde verifieer je dat `_mt_*` attributes in `note_attributes` aankomen en dat events in Meta Events Manager opduiken.

## Wat draait waar?

Shopify's checkout (en Thank-You) draait sinds **Checkout Extensibility** niet meer in `theme.liquid`. Daarom splitsen we de tracking in twee scripts:

| Script              | Plek                                        | Events                                                          |
|---------------------|---------------------------------------------|-----------------------------------------------------------------|
| `tracker.js`        | `theme.liquid` (storefront)                 | PageView, ViewContent, AddToCart, **InitiateCheckout op klik**  |
| `custom-pixel.js`   | Settings → Customer events → Custom pixel   | **InitiateCheckout** (op `checkout_started`), **Purchase** (op `checkout_completed`, alleen opgeslagen, niet naar CAPI) |
| Webhook (server)    | tracker backend                             | **Purchase via Meta Conversions API — enige autoritatieve bron**|

**Dedup hoe het werkt:**
- *Storefront events* (PV, VC, AtC) → `tracker.js` fired `/api/collect` + (best-effort) `fbq()` met **hetzelfde event_id** → Meta dedupt browser ↔ server.
- *InitiateCheckout* → `tracker.js` fired bij klik op de checkout-knop met `event_id = ic_<purchase_eid>`. Custom Pixel fired óók IC bij `checkout_started` met **hetzelfde** `ic_<purchase_eid>`. `/api/collect` weigert duplicaten op `(store_id, event_id)`.
- *Purchase* — **éénduidige regel:** alleen de `orders/paid` webhook stuurt Purchase naar Meta CAPI. De Custom Pixel Purchase wordt door `/api/collect` **wel opgeslagen** als browser-event (voor audit en latere browser-pixel reconciliatie) maar **niet doorgestuurd** naar Meta. Zo voorkomen we onnodige dubbele server-side calls. Het Event-record krijgt `capiForwardingSkippedReason = "PURCHASE_FORWARDED_BY_SHOPIFY_WEBHOOK"`.

**Beperkingen om expliciet te zijn:**
- De Shopify Custom Pixel draait sandboxed. Hij kan **geen `window.fbq`** van de storefront aanroepen → geen browser-pixel Purchase. **Geen probleem** — onze flow leunt op `/api/collect` (storefront) + de webhook → CAPI (server). `fbq()` is een optionele extra.
- Als de bezoeker direct een checkout-link opent zonder eerst storefront te raken, heeft `tracker.js` nooit kunnen draaien → cart attributes ontbreken → matchSource wordt `SHOPIFY_CLIENT_DETAILS` of lager. Webhook Purchase wordt nog steeds verstuurd, met `event_id = purchase_<shopify_order_id>`.

## Voorwaarden

1. Meta Tracker op een publiek domein (`https://tracker.jouwdomein.com`).
2. Admin login werkend (`/api/auth/signin`).
3. Per store nodig:
   - **Meta Pixel ID**
   - **Meta Conversions API Access Token** (Events Manager → pixel → Settings → "Generate Access Token")
   - *Optioneel* een **Meta Test Event Code**
   - Toegang tot Shopify Admin met rechten voor webhooks, theme code, en Customer Events

## Stap 1 — Maak de store aan in je tracker

Geen UI nog; gebruik `curl` of Postman (login eerst via `/api/auth/signin` en kopieer de `next-auth.session-token` cookie).

```bash
curl -X POST https://tracker.jouwdomein.com/api/stores \
  -H "Content-Type: application/json" \
  -H "Cookie: next-auth.session-token=<cookie>" \
  -d '{
    "name": "Mijn store",
    "domain": "mijnshop.com",
    "currency": "EUR",
    "shopify_webhook_secret": "<stap 3 webhook secret>",
    "meta_pixel_id": "1234567890",
    "meta_access_token": "EAAB...",
    "meta_test_event_code": "TEST12345"
  }'
```

Response geeft je `store.id` (UUID). Bewaar deze.

`domain` moet **exact** matchen met `X-Shopify-Shop-Domain` uit de webhook header. Meestal `mijnshop.myshopify.com`.

## Stap 2 — Schakel Shopify's native Meta pixel uit

**Aanbevolen.** Onze `tracker.js` fired `fbq()` voor storefront events. Als Shopify's eigen integratie óók `fbq()` fired (met haar eigen event_ids), krijg je dubbele browser-events bij Meta zonder deduplicatie. Voor Purchase geldt iets vergelijkbaars: Shopify's native pixel fired een eigen Purchase die niet met onze CAPI Purchase dedupt.

Uitschakelen kan op één of meer van deze plekken:
- **Online Store → Preferences** → "Facebook Pixel" leeghalen (legacy).
- **Settings → Apps and sales channels → Facebook & Instagram** → integratie pauzeren of "Data Sharing" op Off.
- **Settings → Customer events** → eventuele bestaande Meta pixel verwijderen die je hier eerder toevoegde.

**Sanity check:** open een productpagina, DevTools → Network → filter op `facebook.com/tr`. Vóór je onze scripts installeert moet je géén calls zien. Daarna mag je alleen onze eigen `fbq()` calls zien (PV/VC/AtC/IC vanaf storefront pagina's).

**Als gevolg hiervan kan `window.fbq` afwezig zijn op de storefront** — bijvoorbeeld omdat je de Meta integratie nooit hebt gehad of compleet hebt verwijderd. **Dat is geen probleem.** Onze tracker checkt `typeof window.fbq === 'function'` voor elke aanroep en slaat 'm gewoon over als hij niet bestaat. De kern van de flow blijft werken:

```
storefront events  → /api/collect → Meta CAPI (server-side)
checkout events    → /api/collect → Meta CAPI (server-side)
orders/paid        → webhook       → Meta CAPI Purchase (autoritatief)
```

Browser-pixel calls via `fbq()` zijn een **best-effort extra signaal** voor Meta's deduplicatie van browser ↔ server matches; ze zijn niet vereist voor correcte tracking.

## Stap 3 — Webhooks

Shopify Admin → **Settings → Notifications → Webhooks**:

1. "Create webhook" → Event: **Order creation** → Format: **JSON** → URL: `https://tracker.jouwdomein.com/api/webhooks/shopify/orders` → Save.
2. Herhaal voor **Order paid**.
3. Onderaan de webhooks-pagina: kopieer het **"Webhook secret signing"** → dit is de waarde voor `shopify_webhook_secret` uit Stap 1.

## Stap 4 — Storefront script in theme.liquid

Shopify Admin → **Online Store → Themes** → **⋯ → Edit code** op het actieve thema → open `layout/theme.liquid`. Net vóór `</head>` plak:

```liquid
<script async src="https://tracker.jouwdomein.com/api/script/tracker.js?store_id=JOUW_STORE_UUID"></script>
```

Voor debug-output in de console: voeg `&debug=1` toe.

Klik **Save**. Dit script handelt PageView, ViewContent, AddToCart en de InitiateCheckout-klik af. Hij raakt de Shopify checkout-pagina's niet.

## Stap 5 — Custom Pixel voor checkout & Thank-You

Shopify Admin → **Settings → Customer events** → klik **"Add custom pixel"**.

1. Geef hem een naam, bijvoorbeeld **"Meta Tracker"**.
2. **Permission level**: laat staan op **"Customer privacy"** standaarden, of pas aan volgens je shop.
3. Open in je browser:
   ```
   https://tracker.jouwdomein.com/api/script/custom-pixel.js?store_id=JOUW_STORE_UUID
   ```
   Selecteer alles, kopieer.
4. Plak in de **Code** sectie van de Custom Pixel editor in Shopify Admin.
5. Klik **Save** → klik **Connect** (of "Activate") om de pixel live te zetten.

Wat dit script doet:
- Subscribed op `checkout_started` → fired een **InitiateCheckout** event naar `/api/collect` met `event_id = ic_<purchase_eid>`.
- Subscribed op `checkout_completed` → fired een **Purchase** event naar `/api/collect` met `event_id = <purchase_eid>` (of `purchase_<order_id>` als fallback).
- Leest `_mt_purchase_eid`, `_mt_cid`, `_mt_fbp`, `_mt_fbc` uit `event.data.checkout.attributes` — dit zijn dezelfde waarden die `tracker.js` via `/cart/update.js` in de cart heeft geschreven.

**Het script roept géén `fbq()` aan.** Shopify's Custom Pixel sandbox heeft geen toegang tot `window.fbq` van de storefront. Voor Purchase betekent dat: alleen CAPI signalen (Custom Pixel én webhook), geen browser-pixel. Dat is OK — CAPI is de betrouwbare bron.

## Stap 6 — Test storefront-tracking in je browser

1. Open je shop met `?fbclid=TESTCLICK123`.
2. DevTools → Application → **Cookies** → verifieer: `_fbp`, `_fbc` (eindigt op `TESTCLICK123`), `_mt_cid` (UUID).
3. Application → **Session Storage** → verifieer: `_mt_purchase_eid` (UUID), `_mt_landing_url`.
4. Network → filter op `/api/collect` → één POST voor PageView met status `202`.
5. Network → filter op `/cart/update` → POST naar `/cart/update.js` met `attributes` body.
6. Console:
   ```js
   fetch('/cart.js').then(r => r.json()).then(c => console.log(c.attributes));
   ```
   Alle zeven `_mt_*` velden moeten erin staan.
7. Voeg een product toe aan de cart → Network → `/api/collect` met `event_name: "AddToCart"`.

## Stap 7 — Test checkout & Purchase end-to-end

1. Plaats een testorder (Shopify Bogus Gateway via Settings → Payments → Manage → testmodus, of een echte kleine bestelling).
2. Klik **Checkout** op de cart pagina → Network → `/api/collect` met `event_name: "InitiateCheckout"` en `event_id` startend met `ic_`.
3. Op Shopify's checkout pagina (`/checkouts/...`):
   - Vul gegevens en betaal. De Custom Pixel fired `checkout_started` (= 2e IC met **hetzelfde** `ic_<purchase_eid>` → /api/collect dedupt → één rij blijft over).
4. Na betaling fired `checkout_completed` → /api/collect ontvangt **Purchase** met `event_id = <purchase_eid>`.
5. Wacht 5–10 seconden voor de Shopify webhook → de webhook handler stuurt Purchase naar Meta CAPI met **hetzelfde** `event_id` (`_mt_purchase_eid`).
6. Query je MetaEventLog:
   ```bash
   curl -H "Cookie: next-auth.session-token=<cookie>" \
     "https://tracker.jouwdomein.com/api/events?event_name=Purchase&limit=10"
   ```
   Je ziet **één** MetaEventLog rij voor de Purchase, afkomstig van de webhook (`relatedOrderId: <uuid>`, `success: true`, `events_received: 1`, een `fbtrace_id`). **Dit is de enige server-side CAPI Purchase** — `/api/collect` heeft de Custom Pixel's Purchase wel opgeslagen als Event maar bewust niet doorgestuurd. Dit voorkomt dubbele CAPI calls.

   De Custom Pixel Purchase staat in de Event-tabel:
   ```bash
   # (Voor de toekomstige dashboard UI; het Event endpoint komt nog. Voor nu via SQL:)
   psql $DATABASE_URL -c "SELECT \"eventId\", \"eventName\", \"capiForwardingSkippedReason\" FROM \"Event\" WHERE \"eventName\" = 'Purchase' ORDER BY \"createdAt\" DESC LIMIT 5;"
   ```
   Verwacht: `capiForwardingSkippedReason = PURCHASE_FORWARDED_BY_SHOPIFY_WEBHOOK`.
7. Shopify Admin → **Orders** → klik test order → scroll naar **Note attributes**. Daar moet je zien:
   ```
   _mt_cid           = <uuid>
   _mt_fbp           = fb.1...
   _mt_fbc           = fb.1...TESTCLICK123
   _mt_fbclid        = TESTCLICK123
   _mt_purchase_eid  = <uuid>
   _mt_landing_url   = https://...
   _mt_user_agent    = Mozilla/5.0 ...
   ```
8. In Meta Events Manager → **Test Events** tab → check dat PageView/VC/AtC een "Browser + Server" badge hebben en Purchase een "Server" badge (of "Server (2x)" / "Deduplicated" — terminologie wisselt per UI versie).

## Stap 8 — Verifieer match quality

```bash
curl -H "Cookie: next-auth.session-token=<cookie>" \
  "https://tracker.jouwdomein.com/api/stats?store_id=JOUW_STORE_UUID&days=1"
```

In `match_source_breakdown` zoek je voor je test-order naar `"source": "CART_ATTRIBUTES"`. Dit bevestigt dat `_mt_purchase_eid` succesvol uit `note_attributes` is gelezen.

Krijg je `SHOPIFY_CLIENT_DETAILS`, `CUSTOMER_DATA_ONLY` of `FALLBACK_ORDER_ID`? Zie troubleshooting hieronder.

## Troubleshooting

| Symptoom                                                          | Check                                                                                       |
|-------------------------------------------------------------------|---------------------------------------------------------------------------------------------|
| Webhook geeft 401 `invalid_signature`                             | `shopify_webhook_secret` in store record matched niet met Shopify Admin                     |
| Webhook geeft 404 `unknown_store`                                 | `Store.domain` matched niet met `X-Shopify-Shop-Domain` header                              |
| `/api/collect` geeft 403 `origin_not_allowed`                     | Voor storefront: storedomein klopt niet. Voor Custom Pixel: Custom Pixel's `Origin` header is meestal `cdn.shopify.com` → wordt door onze origin-check geaccepteerd zolang `origin` ontbreekt of een `*.shopify.com` subdomein is. Kan je in de logs nakijken. |
| Geen `_mt_*` in `note_attributes`                                 | `tracker.js` staat niet op alle storefront pagina's, of de klant heeft de site nooit via een storefront-pagina geopend vóór checkout (bv. directe link naar `/checkouts/...`) |
| Match quality is meestal `SHOPIFY_CLIENT_DETAILS`                 | Klanten openen vaak direct een checkout-link; storefront-tracker heeft geen kans gehad om attrs te schrijven |
| MetaEventLog `success: false`, error `Invalid OAuth access token` | Token verlopen — regenereer in Events Manager, update via `PATCH /api/stores/:id`           |
| Twee Purchase events in Meta Events Manager (niet deduped)        | Shopify's native Meta pixel staat nog aan (stap 2)                                          |
| Custom Pixel niet zichtbaar in Events Manager Test Events tab     | Custom Pixel niet geactiveerd, OR `meta_test_event_code` niet ingesteld op store record. Voor Test Events moet de CAPI payload `test_event_code` bevatten — onze backend doet dat automatisch als je dit veld op de store hebt gezet. |

## Snelle smoke test zonder Shopify

```bash
curl -X POST https://tracker.jouwdomein.com/api/test-event \
  -H "Cookie: next-auth.session-token=<cookie>" \
  -H "Content-Type: application/json" \
  -d '{"store_id":"JOUW_STORE_UUID","event_name":"PageView"}'
```

Response toont `events_received`, `fbtrace_id` en `success` — verifieert pixel ID + access token los van Shopify.
