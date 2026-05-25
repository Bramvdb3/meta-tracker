/*!
 * Meta Tracker — Shopify Custom Pixel
 *
 * Runs in Shopify's sandboxed Customer Events environment. Handles the
 * checkout pages and Thank-You page that the storefront tracker.js cannot
 * reach (Checkout Extensibility blocks theme.liquid scripts in checkout).
 *
 * Events:
 *   - checkout_started      → /api/collect "InitiateCheckout" with event_id = ic_<purchase_eid>
 *   - checkout_completed    → /api/collect "Purchase"         with event_id = <purchase_eid>
 *   - payment_info_submitted (optional, commented out) → "AddPaymentInfo"
 *
 * Important — sandbox limitations:
 *   • This script cannot access window.fbq of the storefront — no browser pixel
 *     calls from here. The browser pixel matching is therefore not 100% for
 *     Purchase. The reliable Purchase source remains the Shopify orders/paid
 *     webhook → server-side CAPI (with the same event_id).
 *   • This script cannot read sessionStorage/cookies of the storefront. The
 *     storefront writes _mt_* values into the cart via /cart/update.js so
 *     Shopify mirrors them into checkout.attributes — that's how we read them.
 *
 * Install:
 *   Shopify Admin → Settings → Customer events → Add custom pixel.
 *   To get a copy with your store_id pre-filled, open:
 *     https://<your-tracker-domain>/api/script/custom-pixel.js?store_id=<uuid>
 *   Copy the response body and paste it into the Custom Pixel code editor.
 *
 *   If you're pasting THIS file by hand, first replace:
 *     __STORE_ID__   with your store UUID
 *     __API_BASE__   with https://<your-tracker-domain>
 */

(function () {
  'use strict';

  var STORE_ID = '__STORE_ID__';
  var API_BASE = '__API_BASE__';

  // ─── helpers ─────────────────────────────────────────────────────────────
  function getAttr(attrs, key) {
    if (!Array.isArray(attrs)) return null;
    for (var i = 0; i < attrs.length; i++) {
      var a = attrs[i];
      if (a && a.key === key && typeof a.value === 'string' && a.value.length > 0) {
        return a.value;
      }
    }
    return null;
  }

  function extractContentIds(lineItems) {
    if (!Array.isArray(lineItems)) return [];
    var out = [];
    for (var i = 0; i < lineItems.length; i++) {
      var li = lineItems[i];
      var pid =
        (li && li.variant && li.variant.product && li.variant.product.id) ||
        (li && li.id) ||
        null;
      if (pid != null) out.push(String(pid));
    }
    return out;
  }

  function sumQuantities(lineItems) {
    if (!Array.isArray(lineItems)) return 0;
    var n = 0;
    for (var i = 0; i < lineItems.length; i++) {
      var q = lineItems[i] && lineItems[i].quantity;
      n += typeof q === 'number' ? q : 0;
    }
    return n;
  }

  function safeUrl(event) {
    try {
      var ctx = event && event.context;
      if (ctx && ctx.document && ctx.document.location && ctx.document.location.href) {
        return ctx.document.location.href;
      }
      if (ctx && ctx.window && ctx.window.location && ctx.window.location.href) {
        return ctx.window.location.href;
      }
    } catch (e) {}
    return undefined;
  }

  function send(payload) {
    try {
      fetch(API_BASE + '/api/collect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        keepalive: true,
        mode: 'cors',
      }).catch(function () {});
    } catch (e) {}
  }

  function buildPayload(eventName, eventId, checkout, event) {
    var attrs = checkout && checkout.attributes;
    var payload = {
      store_id: STORE_ID,
      event_id: eventId,
      event_name: eventName,
      event_time: Math.floor(Date.now() / 1000),
    };

    var cid = getAttr(attrs, '_mt_cid');
    var fbp = getAttr(attrs, '_mt_fbp');
    var fbc = getAttr(attrs, '_mt_fbc');
    var fbclid = getAttr(attrs, '_mt_fbclid');
    if (cid) payload.client_id = cid;
    if (fbp) payload.fbp = fbp;
    if (fbc) payload.fbc = fbc;
    if (fbclid) payload.fbclid = fbclid;

    var url = safeUrl(event);
    if (url) payload.url = url;

    if (checkout) {
      try {
        if (checkout.totalPrice && checkout.totalPrice.amount != null) {
          payload.value = Number(checkout.totalPrice.amount);
        }
        if (checkout.currencyCode) payload.currency = checkout.currencyCode;
        var ids = extractContentIds(checkout.lineItems);
        if (ids.length) payload.content_ids = ids;
        var nq = sumQuantities(checkout.lineItems);
        if (nq > 0) payload.num_items = nq;
      } catch (e) {}
    }

    return payload;
  }

  // ─── subscriptions ───────────────────────────────────────────────────────
  try {
    analytics.subscribe('checkout_started', function (event) {
      try {
        var co = event && event.data && event.data.checkout;
        var purchaseEid = getAttr(co && co.attributes, '_mt_purchase_eid');
        var fallbackId = (event && event.id) || String(Date.now());
        var eventId = purchaseEid ? 'ic_' + purchaseEid : 'ic_' + fallbackId;
        send(buildPayload('InitiateCheckout', eventId, co, event));
      } catch (e) {}
    });
  } catch (e) {}

  try {
    analytics.subscribe('checkout_completed', function (event) {
      try {
        var co = event && event.data && event.data.checkout;
        var purchaseEid = getAttr(co && co.attributes, '_mt_purchase_eid');
        var orderId = co && co.order && co.order.id;
        var eventId;
        if (purchaseEid) {
          // Same event_id the storefront wrote into cart attributes and that
          // the orders/paid webhook will use → Meta dedups across browser+CAPI.
          eventId = purchaseEid;
        } else if (orderId) {
          // Same deterministic id the webhook handler falls back to.
          eventId = 'purchase_' + orderId;
        } else {
          eventId = 'purchase_' + ((event && event.id) || String(Date.now()));
        }
        send(buildPayload('Purchase', eventId, co, event));
      } catch (e) {}
    });
  } catch (e) {}

  // Optional — uncomment to also track AddPaymentInfo. Requires adding
  // 'AddPaymentInfo' to the /api/collect EVENT_NAMES whitelist first.
  //
  // try {
  //   analytics.subscribe('payment_info_submitted', function (event) {
  //     try {
  //       var co = event && event.data && event.data.checkout;
  //       var purchaseEid = getAttr(co && co.attributes, '_mt_purchase_eid');
  //       var fallbackId = (event && event.id) || String(Date.now());
  //       var eventId = purchaseEid ? 'apinfo_' + purchaseEid : 'apinfo_' + fallbackId;
  //       send(buildPayload('AddPaymentInfo', eventId, co, event));
  //     } catch (e) {}
  //   });
  // } catch (e) {}
})();
