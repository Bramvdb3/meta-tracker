/*!
 * Meta Tracker — WooCommerce STOREFRONT tracker
 *
 * Loaded by the WordPress theme/plugin (in <head>):
 *   <script async src="https://<tracker-domain>/api/script/tracker-woo.js?store_id=<uuid>"></script>
 *
 * Differences from the Shopify tracker:
 *   - There is no Shopify cart to write attributes to. All tracking metadata
 *     lives in first-party cookies (_mt_cid, _fbp, _fbc, _mt_purchase_eid,
 *     _mt_landing_url). WooCommerce reads those cookies server-side when the
 *     order is created and stores them as order meta; the paid-order hook then
 *     POSTs the order to /api/webhooks/woocommerce/orders (Purchase → CAPI).
 *   - Product / cart / order data is provided by the site via globals:
 *       window._mt_product = { id, name, price, currency }          (product page)
 *       window._mt_cart    = { value, currency, num_items, content_ids } (checkout)
 *       window._mt_order   = { order_id, value, currency, num_items, content_ids, purchase_eid } (thank-you)
 *   - AddToCart: the site dispatches `document` CustomEvent "mt:addtocart" with
 *     detail { product_id, product_name, price, currency, quantity }. As a
 *     fallback, WooCommerce's ?wc-ajax=add_to_cart and the classic
 *     ?add-to-cart= form submits are intercepted.
 *   - InitiateCheckout: fired on click of a checkout link/button and on the
 *     checkout page itself (event_id = ic_<purchase_eid>, deduped server-side).
 *   - Purchase on the thank-you page is sent to /api/collect for the audit
 *     trail only (server skips CAPI); the webhook is the authoritative source.
 */

(function () {
  'use strict';

  var SCRIPT_TAG = document.currentScript;
  if (!SCRIPT_TAG || !SCRIPT_TAG.src) return;
  var SCRIPT_URL;
  try { SCRIPT_URL = new URL(SCRIPT_TAG.src); } catch (e) { return; }

  var STORE_ID = SCRIPT_URL.searchParams.get('store_id');
  var API_ORIGIN = SCRIPT_URL.origin;
  if (!STORE_ID) return;

  var DEBUG = SCRIPT_URL.searchParams.get('debug') === '1' || (window && window._mt_debug === true);
  function log() {
    if (!DEBUG) return;
    try { console.log.apply(console, ['[meta-tracker:woo]'].concat([].slice.call(arguments))); } catch (e) {}
  }

  var COOKIE_DAYS = 90;
  var CID_COOKIE = '_mt_cid';
  var FBP_COOKIE = '_fbp';
  var FBC_COOKIE = '_fbc';
  var EID_COOKIE = '_mt_purchase_eid';
  var LANDING_COOKIE = '_mt_landing_url';

  var SS_IC_SENT_FOR_EID = '_mt_ic_sent_for';
  var SS_PV_SENT = '_mt_pv_sent';
  var SS_VC_PREFIX = '_mt_vc_';
  var SS_PURCHASE_SENT = '_mt_purchase_sent_';

  function safe(fn, label) {
    return function () {
      try { return fn.apply(this, arguments); }
      catch (e) { log('error in ' + (label || 'fn'), e); }
    };
  }

  function uuid() {
    try {
      if (window.crypto && typeof window.crypto.randomUUID === 'function') return window.crypto.randomUUID();
    } catch (e) {}
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
      var r = (Math.random() * 16) | 0;
      var v = c === 'x' ? r : (r & 0x3) | 0x8;
      return v.toString(16);
    });
  }

  function getCookie(name) {
    try {
      var m = document.cookie.match(new RegExp('(?:^|; )' + name.replace(/([.$?*|{}()[\]\\/+^])/g, '\\$1') + '=([^;]*)'));
      return m ? decodeURIComponent(m[1]) : null;
    } catch (e) { return null; }
  }
  function setCookie(name, value, days) {
    try {
      var expires = new Date(Date.now() + days * 86400000).toUTCString();
      document.cookie = name + '=' + encodeURIComponent(value) + '; expires=' + expires + '; path=/; SameSite=Lax';
    } catch (e) {}
  }
  function delCookie(name) {
    try { document.cookie = name + '=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/; SameSite=Lax'; } catch (e) {}
  }
  function ssGet(k) { try { return window.sessionStorage.getItem(k); } catch (e) { return null; } }
  function ssSet(k, v) { try { window.sessionStorage.setItem(k, v); } catch (e) {} }
  function ssDel(k) { try { window.sessionStorage.removeItem(k); } catch (e) {} }
  function getQueryParam(name) {
    try { return new URL(window.location.href).searchParams.get(name); } catch (e) { return null; }
  }

  function getClientId() {
    var cid = getCookie(CID_COOKIE);
    if (!cid) { cid = uuid(); setCookie(CID_COOKIE, cid, COOKIE_DAYS); }
    return cid;
  }
  function ensureFbp() {
    var fbp = getCookie(FBP_COOKIE);
    if (!fbp) { fbp = 'fb.1.' + Date.now() + '.' + Math.floor(Math.random() * 1e10); setCookie(FBP_COOKIE, fbp, COOKIE_DAYS); }
    return fbp;
  }
  function ensureFbc() {
    var fbclid = getQueryParam('fbclid');
    var fbc = getCookie(FBC_COOKIE);
    if (fbclid && (!fbc || fbc.indexOf(fbclid) === -1)) { fbc = 'fb.1.' + Date.now() + '.' + fbclid; setCookie(FBC_COOKIE, fbc, COOKIE_DAYS); }
    return fbc;
  }
  function getFbclid() { return getQueryParam('fbclid'); }

  function getOrCreatePurchaseEid() {
    var eid = getCookie(EID_COOKIE);
    if (!eid) { eid = uuid(); }
    setCookie(EID_COOKIE, eid, 7);
    return eid;
  }
  function clearPurchaseEid() { delCookie(EID_COOKIE); ssDel(SS_IC_SENT_FOR_EID); }
  function ensureLandingUrl() {
    var lu = getCookie(LANDING_COOKIE);
    if (!lu) { lu = String(window.location.href).slice(0, 1000); setCookie(LANDING_COOKIE, lu, 7); }
    return lu;
  }

  function sendToCollect(payload) {
    try {
      fetch(API_ORIGIN + '/api/collect', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload), keepalive: true, mode: 'cors'
      }).then(function (r) { log('collect ' + payload.event_name, r.status); })
        .catch(function (e) { log('collect failed (ignored)', e); });
    } catch (e) { log('collect fetch threw', e); }
  }

  function fireFbq(eventName, data, eventId) {
    if (typeof window.fbq !== 'function') return;
    try { window.fbq('track', eventName, data || {}, { eventID: eventId }); log('fbq ' + eventName + ' eid=' + eventId); }
    catch (e) { log('fbq threw', e); }
  }

  function trackEvent(eventName, extras) {
    extras = extras || {};
    var eventId = extras.event_id || uuid();
    var payload = {
      store_id: STORE_ID, event_id: eventId, event_name: eventName,
      event_time: Math.floor(Date.now() / 1000), client_id: getClientId(), url: window.location.href
    };
    var fbp = ensureFbp(); if (fbp) payload.fbp = fbp;
    var fbc = ensureFbc(); if (fbc) payload.fbc = fbc;
    var fbclid = getFbclid(); if (fbclid) payload.fbclid = fbclid;
    var ref = document.referrer; if (ref) payload.referrer = ref;
    if (extras.product_id) payload.product_id = String(extras.product_id);
    if (extras.product_name) payload.product_name = String(extras.product_name).slice(0, 255);
    if (extras.content_ids) payload.content_ids = extras.content_ids.map(String);
    if (typeof extras.value === 'number' && !isNaN(extras.value)) payload.value = extras.value;
    if (extras.currency) payload.currency = String(extras.currency);
    if (typeof extras.num_items === 'number') payload.num_items = extras.num_items;
    if (extras.email_hash) payload.email_hash = extras.email_hash;

    sendToCollect(payload);

    var fbqData = {};
    if (payload.content_ids) { fbqData.content_ids = payload.content_ids; fbqData.content_type = 'product'; }
    else if (payload.product_id) { fbqData.content_ids = [payload.product_id]; fbqData.content_type = 'product'; }
    if (payload.value !== undefined) fbqData.value = payload.value;
    if (payload.currency) fbqData.currency = payload.currency;
    if (payload.num_items !== undefined) fbqData.num_items = payload.num_items;
    fireFbq(eventName, fbqData, eventId);
    return eventId;
  }

  // ── page data supplied by the site ──
  function getCurrentProduct() {
    try {
      var p = window._mt_product;
      if (p && p.id) return { id: String(p.id), name: p.name || null, price: p.price != null ? Number(p.price) : null, currency: p.currency || null };
    } catch (e) {}
    return null;
  }
  function isCheckoutPage() {
    try { return !!(window._mt_cart) || /(^|\s)woocommerce-checkout(\s|$)/.test(document.body.className) && !/order-received/.test(window.location.pathname); } catch (e) { return false; }
  }
  function isThankYouPage() {
    try { return !!(window._mt_order && window._mt_order.order_id); } catch (e) { return false; }
  }

  function trackPageView() {
    if (ssGet(SS_PV_SENT) === window.location.href) return;
    ssSet(SS_PV_SENT, window.location.href);
    safe(trackEvent, 'collect:pv')('PageView');
  }

  function trackViewContent() {
    var product = getCurrentProduct();
    if (!product || !product.id) return;
    var key = SS_VC_PREFIX + product.id;
    if (ssGet(key)) { log('VC already sent for ' + product.id); return; }
    ssSet(key, '1');
    var extras = { product_id: product.id, product_name: product.name || undefined, content_ids: [product.id] };
    if (product.price != null) extras.value = product.price;
    if (product.currency) extras.currency = product.currency;
    safe(trackEvent, 'collect:vc')('ViewContent', extras);
  }

  var ATC_DEDUP_WINDOW_MS = 2500, lastAtcKey = null, lastAtcAt = 0;
  function trackAddToCart(item) {
    var key = item && item.product_id != null ? 'p' + String(item.product_id) : 'unknown';
    var now = Date.now();
    if (now - lastAtcAt < ATC_DEDUP_WINDOW_MS && (key === lastAtcKey || key === 'unknown' || lastAtcKey === 'unknown')) { log('AddToCart deduped'); return; }
    lastAtcKey = key; lastAtcAt = now;
    var extras = {};
    try {
      if (item) {
        if (item.product_id != null) { extras.product_id = String(item.product_id); extras.content_ids = [String(item.product_id)]; }
        if (item.product_name) extras.product_name = String(item.product_name);
        if (item.price != null) extras.value = Number(item.price) * (item.quantity != null ? Number(item.quantity) : 1);
        if (item.quantity != null) extras.num_items = Number(item.quantity);
        if (item.currency) extras.currency = item.currency;
      }
      if (!extras.currency && window._mt_currency) extras.currency = window._mt_currency;
    } catch (e) {}
    safe(trackEvent, 'collect:atc')('AddToCart', extras);
  }

  function trackInitiateCheckout(cart) {
    var eid = getOrCreatePurchaseEid();
    if (ssGet(SS_IC_SENT_FOR_EID) === eid) { log('IC already sent for ' + eid); return; }
    ssSet(SS_IC_SENT_FOR_EID, eid);
    var extras = { event_id: 'ic_' + eid };
    try {
      cart = cart || window._mt_cart || null;
      if (cart) {
        if (cart.value != null) extras.value = Number(cart.value);
        if (cart.currency) extras.currency = cart.currency;
        if (cart.num_items != null) extras.num_items = Number(cart.num_items);
        if (Array.isArray(cart.content_ids) && cart.content_ids.length) extras.content_ids = cart.content_ids.map(String);
      }
      if (!extras.currency && window._mt_currency) extras.currency = window._mt_currency;
    } catch (e) {}
    safe(trackEvent, 'collect:ic')('InitiateCheckout', extras);
  }

  function trackPurchase() {
    var o = window._mt_order; if (!o || !o.order_id) return;
    if (ssGet(SS_PURCHASE_SENT + o.order_id)) return;
    ssSet(SS_PURCHASE_SENT + o.order_id, '1');
    var eid = o.purchase_eid || getCookie(EID_COOKIE) || ('purchase_' + o.order_id);
    var extras = { event_id: eid };
    if (o.value != null) extras.value = Number(o.value);
    if (o.currency) extras.currency = o.currency;
    if (o.num_items != null) extras.num_items = Number(o.num_items);
    if (Array.isArray(o.content_ids)) extras.content_ids = o.content_ids.map(String);
    if (o.email_hash) extras.email_hash = o.email_hash;
    safe(trackEvent, 'collect:purchase')('Purchase', extras);
    clearPurchaseEid();
  }

  // ── hooks ──
  function installAddToCartHooks() {
    // Preferred: the site tells us
    document.addEventListener('mt:addtocart', function (e) { safe(trackAddToCart, 'atc-event')(e && e.detail ? e.detail : null); });

    // Fallback: WooCommerce AJAX add to cart
    try {
      var originalFetch = window.fetch;
      if (typeof originalFetch === 'function') {
        window.fetch = function (input, init) {
          var promise = originalFetch.apply(this, arguments);
          try {
            var url = typeof input === 'string' ? input : (input && input.url) || '';
            var method = ((init && init.method) || (input && input.method) || 'GET').toUpperCase();
            if (method === 'POST' && /wc-ajax=add_to_cart/.test(url)) {
              var pid = null;
              try { var b = init && init.body; if (b && typeof b.get === 'function') pid = b.get('product_id'); } catch (e2) {}
              promise.then(function (r) {
                try { r.clone().json().then(function (j) { if (!j || !j.error) setTimeout(function () { safe(trackAddToCart, 'atc-fetch')({ product_id: pid }); }, 50); }).catch(function () {}); } catch (e3) {}
              }).catch(function () {});
            }
          } catch (e) {}
          return promise;
        };
      }
    } catch (e) { log('fetch hook failed', e); }
    try {
      document.addEventListener('submit', function (e) {
        try {
          var form = e.target; if (!form) return;
          var hasAtc = form.querySelector && form.querySelector('[name="add-to-cart"]');
          if (hasAtc && !(form.classList && form.classList.contains('lt-atc'))) safe(trackAddToCart, 'atc-form')({ product_id: hasAtc.value });
        } catch (e2) {}
      }, true);
    } catch (e) {}
  }

  function looksLikeCheckoutTarget(el) {
    if (!el) return false;
    try {
      var href = el.getAttribute && el.getAttribute('href');
      if (href && /\/checkout\/?(\?|$)/.test(href)) return true;
      if (el.classList && (el.classList.contains('checkout-button') || el.classList.contains('cart-drawer__checkout') || el.classList.contains('wc-block-cart__submit-button'))) return true;
    } catch (e) {}
    return false;
  }
  function installCheckoutHooks() {
    document.addEventListener('click', function (e) {
      try {
        var t = e.target; var el = t && t.closest ? t.closest('a, button, input[type=submit]') : null;
        if (el && looksLikeCheckoutTarget(el)) safe(trackInitiateCheckout, 'ic-click')(null);
      } catch (e2) {}
    }, true);
  }

  function init() {
    ensureLandingUrl(); ensureFbp(); ensureFbc(); getClientId();
    if (!isThankYouPage()) getOrCreatePurchaseEid();

    safe(trackPageView, 'init-pv')();
    if (getCurrentProduct()) safe(trackViewContent, 'init-vc')();
    if (isThankYouPage()) safe(trackPurchase, 'init-purchase')();
    else if (isCheckoutPage()) safe(trackInitiateCheckout, 'init-ic')(null);

    safe(installAddToCartHooks, 'init-atc-hooks')();
    safe(installCheckoutHooks, 'init-ic-hooks')();
    log('init done', { store_id: STORE_ID, api: API_ORIGIN });
  }

  try {
    window._mt = {
      version: 'woo-0.1.0', storeId: STORE_ID,
      getClientId: getClientId, getPurchaseEid: getOrCreatePurchaseEid,
      trackPageView: trackPageView, trackViewContent: trackViewContent,
      trackAddToCart: trackAddToCart, trackInitiateCheckout: trackInitiateCheckout, trackPurchase: trackPurchase
    };
  } catch (e) {}

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', safe(init, 'dom-init'));
  else safe(init, 'immediate-init')();
})();
