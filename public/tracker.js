/*!
 * Meta Tracker — Shopify STOREFRONT tracker
 *
 * Loaded from theme.liquid:
 *   <script async src="https://<tracker-domain>/api/script/tracker.js?store_id=<uuid>"></script>
 *
 * Scope: storefront pages ONLY (home, collection, product, cart). Shopify's checkout
 * and Thank-You pages cannot reach theme.liquid scripts in Checkout Extensibility —
 * those are covered by a separate Shopify Custom Pixel (see custom-pixel.js).
 *
 * Responsibilities:
 *   - Maintain _fbp / _fbc / _mt_cid cookies (90 days) and a stable _mt_purchase_eid
 *     (sessionStorage + localStorage)
 *   - Write tracking metadata to the Shopify cart via POST /cart/update.js on
 *     PageView, ViewContent, AddToCart, and on checkout-button click
 *   - POST events to <tracker-domain>/api/collect for server-side CAPI forwarding
 *   - Fire fbq() in the browser with the SAME event_id, but only if window.fbq exists
 *   - Throttle ViewContent (once per product per session) and InitiateCheckout
 *     (once per purchase_eid; the Custom Pixel also fires IC with event_id =
 *     ic_<purchase_eid> so /api/collect dedups across both)
 *   - Intercept /cart/add(.js) via fetch, XHR and form submits for AddToCart
 *   - Everything wrapped in try/catch — never throw or block checkout.
 *
 * Purchase is NOT fired here. The reliable source is the orders/paid webhook
 * → server-side CAPI. The Custom Pixel additionally sends a Purchase to
 * /api/collect with the same event_id for dedup.
 */

(function () {
  'use strict';

  // ─────────────────── 0. Bootstrap: read config from script tag ────────────────
  var SCRIPT_TAG = document.currentScript;
  if (!SCRIPT_TAG || !SCRIPT_TAG.src) return;

  var SCRIPT_URL;
  try {
    SCRIPT_URL = new URL(SCRIPT_TAG.src);
  } catch (e) {
    return;
  }

  var STORE_ID = SCRIPT_URL.searchParams.get('store_id');
  var API_ORIGIN = SCRIPT_URL.origin;
  if (!STORE_ID) return;

  var DEBUG = SCRIPT_URL.searchParams.get('debug') === '1' || (window && window._mt_debug === true);
  function log() {
    if (!DEBUG) return;
    try { console.log.apply(console, ['[meta-tracker]'].concat([].slice.call(arguments))); } catch (e) {}
  }

  // ─────────────────── 1. Constants ────────────────────────────────────────────
  var COOKIE_DAYS = 90;
  var CID_COOKIE = '_mt_cid';
  var FBP_COOKIE = '_fbp';
  var FBC_COOKIE = '_fbc';

  var SS_PURCHASE_EID = '_mt_purchase_eid';
  var SS_LANDING_URL = '_mt_landing_url';
  var SS_IC_SENT_FOR_EID = '_mt_ic_sent_for';
  var SS_PV_SENT = '_mt_pv_sent';
  var SS_VC_PREFIX = '_mt_vc_';

  // ─────────────────── 2. Safety wrapper ───────────────────────────────────────
  function safe(fn, label) {
    return function () {
      try { return fn.apply(this, arguments); }
      catch (e) { log('error in ' + (label || 'fn'), e); }
    };
  }

  // ─────────────────── 3. UUID ─────────────────────────────────────────────────
  function uuid() {
    try {
      if (window.crypto && typeof window.crypto.randomUUID === 'function') {
        return window.crypto.randomUUID();
      }
    } catch (e) {}
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
      var r = (Math.random() * 16) | 0;
      var v = c === 'x' ? r : (r & 0x3) | 0x8;
      return v.toString(16);
    });
  }

  // ─────────────────── 4. Cookie / storage helpers ─────────────────────────────
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

  function ssGet(k) { try { return window.sessionStorage.getItem(k); } catch (e) { return null; } }
  function ssSet(k, v) { try { window.sessionStorage.setItem(k, v); } catch (e) {} }
  function ssDel(k) { try { window.sessionStorage.removeItem(k); } catch (e) {} }
  function lsGet(k) { try { return window.localStorage.getItem(k); } catch (e) { return null; } }
  function lsSet(k, v) { try { window.localStorage.setItem(k, v); } catch (e) {} }
  function lsDel(k) { try { window.localStorage.removeItem(k); } catch (e) {} }

  function getQueryParam(name) {
    try { return new URL(window.location.href).searchParams.get(name); }
    catch (e) { return null; }
  }

  // ─────────────────── 5. _mt_cid, _fbp, _fbc, fbclid, purchase_eid, landing ───
  function getClientId() {
    var cid = getCookie(CID_COOKIE);
    if (!cid) {
      cid = uuid();
      setCookie(CID_COOKIE, cid, COOKIE_DAYS);
    }
    return cid;
  }

  function ensureFbp() {
    var fbp = getCookie(FBP_COOKIE);
    if (!fbp) {
      fbp = 'fb.1.' + Date.now() + '.' + Math.floor(Math.random() * 1e10);
      setCookie(FBP_COOKIE, fbp, COOKIE_DAYS);
    }
    return fbp;
  }

  function ensureFbc() {
    var fbclid = getQueryParam('fbclid');
    var fbc = getCookie(FBC_COOKIE);
    if (fbclid && (!fbc || fbc.indexOf(fbclid) === -1)) {
      fbc = 'fb.1.' + Date.now() + '.' + fbclid;
      setCookie(FBC_COOKIE, fbc, COOKIE_DAYS);
    }
    return fbc;
  }

  function getFbclid() { return getQueryParam('fbclid'); }

  function getOrCreatePurchaseEid() {
    var eid = ssGet(SS_PURCHASE_EID) || lsGet(SS_PURCHASE_EID);
    if (!eid) {
      eid = uuid();
    }
    ssSet(SS_PURCHASE_EID, eid);
    lsSet(SS_PURCHASE_EID, eid);
    return eid;
  }

  function clearPurchaseEid() {
    ssDel(SS_PURCHASE_EID);
    lsDel(SS_PURCHASE_EID);
    ssDel(SS_IC_SENT_FOR_EID);
  }

  function ensureLandingUrl() {
    var lu = ssGet(SS_LANDING_URL);
    if (!lu) {
      lu = window.location.href;
      ssSet(SS_LANDING_URL, lu);
    }
    return lu;
  }

  // ─────────────────── 6. Cart attributes write ────────────────────────────────
  var lastCartAttrsSerialized = null;

  function buildCartAttributes() {
    return {
      _mt_cid: getClientId(),
      _mt_fbp: ensureFbp() || '',
      _mt_fbc: ensureFbc() || '',
      _mt_fbclid: getFbclid() || '',
      _mt_purchase_eid: getOrCreatePurchaseEid(),
      _mt_landing_url: String(ensureLandingUrl() || '').slice(0, 1000),
      _mt_user_agent: String((window.navigator && window.navigator.userAgent) || '').slice(0, 250)
    };
  }

  function writeCartAttributes() {
    var attrs = buildCartAttributes();
    var serialized = JSON.stringify(attrs);
    if (serialized === lastCartAttrsSerialized) {
      log('cart attrs unchanged — skip');
      return;
    }
    lastCartAttrsSerialized = serialized;

    try {
      fetch('/cart/update.js', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ attributes: attrs }),
        credentials: 'same-origin',
        keepalive: true
      }).then(function () { log('cart attrs written'); })
        .catch(function (e) { log('cart attrs write failed (ignored)', e); });
    } catch (e) {
      log('cart attrs fetch threw', e);
    }
  }

  // ─────────────────── 7. /api/collect + fbq pair ──────────────────────────────
  function sendToCollect(payload) {
    try {
      fetch(API_ORIGIN + '/api/collect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        keepalive: true,
        // No credentials — we don't use cookies on the tracker domain
        mode: 'cors'
      }).then(function (r) { log('collect ' + payload.event_name, r.status); })
        .catch(function (e) { log('collect failed (ignored)', e); });
    } catch (e) {
      log('collect fetch threw', e);
    }
  }

  function fireFbq(eventName, data, eventId) {
    if (typeof window.fbq !== 'function') return;
    try {
      window.fbq('track', eventName, data || {}, { eventID: eventId });
      log('fbq ' + eventName + ' eid=' + eventId);
    } catch (e) {
      log('fbq threw', e);
    }
  }

  /**
   * Fires one event in both places (collect endpoint + browser fbq) with the same event_id.
   * `extras` may contain product/content/value/currency fields.
   */
  function trackEvent(eventName, extras) {
    extras = extras || {};
    var eventId = extras.event_id || uuid();

    var payload = {
      store_id: STORE_ID,
      event_id: eventId,
      event_name: eventName,
      event_time: Math.floor(Date.now() / 1000),
      client_id: getClientId(),
      url: window.location.href
    };
    var fbp = ensureFbp(); if (fbp) payload.fbp = fbp;
    var fbc = ensureFbc(); if (fbc) payload.fbc = fbc;
    var fbclid = getFbclid(); if (fbclid) payload.fbclid = fbclid;
    var ref = document.referrer; if (ref) payload.referrer = ref;

    if (extras.product_id) payload.product_id = String(extras.product_id);
    if (extras.product_name) payload.product_name = String(extras.product_name);
    if (extras.content_ids) payload.content_ids = extras.content_ids.map(String);
    if (typeof extras.value === 'number') payload.value = extras.value;
    if (extras.currency) payload.currency = String(extras.currency);
    if (typeof extras.num_items === 'number') payload.num_items = extras.num_items;

    sendToCollect(payload);

    // Browser pixel — only if fbq exists, with the SAME event_id
    var fbqData = {};
    if (payload.content_ids) {
      fbqData.content_ids = payload.content_ids;
      fbqData.content_type = 'product';
    } else if (payload.product_id) {
      fbqData.content_ids = [payload.product_id];
      fbqData.content_type = 'product';
    }
    if (payload.value !== undefined) fbqData.value = payload.value;
    if (payload.currency) fbqData.currency = payload.currency;
    if (payload.num_items !== undefined) fbqData.num_items = payload.num_items;
    fireFbq(eventName, fbqData, eventId);

    return eventId;
  }

  // ─────────────────── 8. Page detection ───────────────────────────────────────
  function pathStartsWith(prefix) {
    return (window.location.pathname || '').indexOf(prefix) === 0;
  }
  function isProductPage() { return pathStartsWith('/products/'); }

  function getCurrentProduct() {
    try {
      var m = window.meta && window.meta.product;
      if (m && m.id) {
        var price = null;
        if (m.variants && m.variants.length && m.variants[0].price != null) {
          price = Number(m.variants[0].price) / 100;
        } else if (m.price != null) {
          price = Number(m.price) / 100;
        }
        return {
          id: String(m.id),
          name: m.title || m.name || null,
          price: price,
          currency: (window.Shopify && window.Shopify.currency && window.Shopify.currency.active) || null
        };
      }
    } catch (e) {}
    try {
      var sa = window.ShopifyAnalytics && window.ShopifyAnalytics.meta && window.ShopifyAnalytics.meta.product;
      if (sa && sa.id) {
        return {
          id: String(sa.id),
          name: sa.title || null,
          price: sa.price != null ? Number(sa.price) / 100 : null,
          currency: (window.Shopify && window.Shopify.currency && window.Shopify.currency.active) || null
        };
      }
    } catch (e) {}
    return null;
  }

  // ─────────────────── 9. Per-event handlers ───────────────────────────────────
  function trackPageView() {
    if (ssGet(SS_PV_SENT) === window.location.href) return; // same URL within session = skip
    ssSet(SS_PV_SENT, window.location.href);
    safe(writeCartAttributes, 'writeCartAttributes:pv')();
    safe(trackEvent, 'collect:pv')('PageView');
  }

  function trackViewContent() {
    var product = getCurrentProduct();
    if (!product || !product.id) return;
    var sessionKey = SS_VC_PREFIX + product.id;
    if (ssGet(sessionKey)) {
      log('VC already sent for product ' + product.id + ' this session');
      return;
    }
    ssSet(sessionKey, '1');

    safe(writeCartAttributes, 'writeCartAttributes:vc')();

    var extras = {
      product_id: product.id,
      product_name: product.name || undefined,
      content_ids: [product.id]
    };
    if (product.price != null) extras.value = product.price;
    if (product.currency) extras.currency = product.currency;

    safe(trackEvent, 'collect:vc')('ViewContent', extras);
  }

  function trackAddToCart(item) {
    safe(writeCartAttributes, 'writeCartAttributes:atc')();

    var extras = {};
    try {
      if (item) {
        if (item.product_id != null) {
          extras.product_id = String(item.product_id);
          extras.content_ids = [String(item.product_id)];
        }
        var name = item.product_title || item.title || item.product_name;
        if (name) extras.product_name = String(name);
        var price = null;
        if (item.final_price != null) price = Number(item.final_price) / 100;
        else if (item.price != null) price = Number(item.price) / 100;
        if (price != null) extras.value = price;
        if (item.quantity != null) extras.num_items = Number(item.quantity);
      }
      if (!extras.currency && window.Shopify && window.Shopify.currency && window.Shopify.currency.active) {
        extras.currency = window.Shopify.currency.active;
      }
    } catch (e) {}

    safe(trackEvent, 'collect:atc')('AddToCart', extras);
  }

  function trackInitiateCheckout() {
    var eid = getOrCreatePurchaseEid();
    if (ssGet(SS_IC_SENT_FOR_EID) === eid) {
      log('IC already sent for purchase_eid ' + eid);
      return;
    }
    ssSet(SS_IC_SENT_FOR_EID, eid);

    safe(writeCartAttributes, 'writeCartAttributes:ic')();

    // IC event_id is deterministic from purchase_eid so the Custom Pixel's
    // checkout_started call hits the same row in /api/collect (deduped).
    var icEventId = 'ic_' + eid;

    var doSend = function (cart) {
      var extras = { event_id: icEventId };
      try {
        if (cart) {
          if (cart.total_price != null) extras.value = Number(cart.total_price) / 100;
          if (cart.currency) extras.currency = cart.currency;
          else if (window.Shopify && window.Shopify.currency && window.Shopify.currency.active) {
            extras.currency = window.Shopify.currency.active;
          }
          if (cart.item_count != null) extras.num_items = Number(cart.item_count);
          if (Array.isArray(cart.items) && cart.items.length) {
            extras.content_ids = cart.items.map(function (i) { return String(i.product_id); });
          }
        }
      } catch (e) {}
      safe(trackEvent, 'collect:ic')('InitiateCheckout', extras);
    };

    try {
      fetch('/cart.js', { credentials: 'same-origin' })
        .then(function (r) { return r.ok ? r.json() : null; })
        .then(function (cart) { safe(doSend, 'ic-send')(cart); })
        .catch(function () { safe(doSend, 'ic-send-nocart')(null); });
    } catch (e) {
      safe(doSend, 'ic-send-throw')(null);
    }
  }

  // ─────────────────── 10. AddToCart interception ──────────────────────────────
  function installCartAddHooks() {
    // 10a. Fetch
    try {
      var originalFetch = window.fetch;
      if (typeof originalFetch === 'function') {
        window.fetch = function (input, init) {
          var promise = originalFetch.apply(this, arguments);
          try {
            var url = typeof input === 'string'
              ? input
              : (input && input.url) || '';
            var method = ((init && init.method) || (input && input.method) || 'GET').toUpperCase();
            if (method === 'POST' && /\/cart\/add(\.js)?(\?|$)/.test(url)) {
              promise.then(function (response) {
                try {
                  response.clone().json().then(function (data) {
                    handleCartAddResponse(data);
                  }).catch(function () { safe(trackAddToCart, 'atc-noparse')(null); });
                } catch (e) { safe(trackAddToCart, 'atc-throw')(null); }
              }).catch(function () { /* original request failed, do nothing */ });
            }
          } catch (e) {}
          return promise;
        };
      }
    } catch (e) { log('fetch hook failed', e); }

    // 10b. XHR
    try {
      var XHR = window.XMLHttpRequest;
      if (XHR && XHR.prototype) {
        var origOpen = XHR.prototype.open;
        var origSend = XHR.prototype.send;
        XHR.prototype.open = function (method, url) {
          try {
            this.__mt_method = (method || '').toUpperCase();
            this.__mt_url = url || '';
          } catch (e) {}
          return origOpen.apply(this, arguments);
        };
        XHR.prototype.send = function () {
          try {
            var xhr = this;
            if (xhr.__mt_method === 'POST' && /\/cart\/add(\.js)?(\?|$)/.test(xhr.__mt_url || '')) {
              xhr.addEventListener('load', function () {
                if (xhr.status >= 200 && xhr.status < 300) {
                  try {
                    var data = JSON.parse(xhr.responseText);
                    handleCartAddResponse(data);
                  } catch (e) { safe(trackAddToCart, 'atc-xhr-noparse')(null); }
                }
              });
            }
          } catch (e) {}
          return origSend.apply(this, arguments);
        };
      }
    } catch (e) { log('xhr hook failed', e); }

    // 10c. Native form submit to /cart/add
    try {
      document.addEventListener('submit', function (e) {
        try {
          var form = e.target;
          if (!form || !form.action) return;
          if (/\/cart\/add(\?|$|\.js)/.test(form.action)) {
            // The form will navigate — fire immediately
            safe(trackAddToCart, 'atc-form')(null);
          }
        } catch (e2) {}
      }, true);
    } catch (e) {}
  }

  function handleCartAddResponse(data) {
    try {
      if (!data) { safe(trackAddToCart, 'atc-empty')(null); return; }
      if (Array.isArray(data.items)) {
        data.items.forEach(function (it) { safe(trackAddToCart, 'atc-item')(it); });
      } else {
        safe(trackAddToCart, 'atc-single')(data);
      }
    } catch (e) {
      safe(trackAddToCart, 'atc-handle-throw')(null);
    }
  }

  // ─────────────────── 11. Checkout intent detection ───────────────────────────
  function looksLikeCheckoutTarget(el) {
    if (!el) return false;
    try {
      var href = el.getAttribute && el.getAttribute('href');
      if (href && /\/checkouts?(\/|\?|$)/.test(href)) return true;
      var name = el.getAttribute && (el.getAttribute('name') || '').toLowerCase();
      if (name === 'checkout' || name === 'goto_pp' || name === 'goto_gc') return true;
      if (el.form && el.form.action && /\/checkout/.test(el.form.action)) return true;
      var txt = (el.textContent || '').trim().toLowerCase();
      if (el.tagName === 'BUTTON' && /^(checkout|check out|afrekenen|kassa|naar de kassa)$/.test(txt)) return true;
    } catch (e) {}
    return false;
  }

  function installCheckoutHooks() {
    try {
      document.addEventListener('click', function (e) {
        try {
          var t = e.target;
          var el = t && t.closest ? t.closest('a, button, input[type=submit]') : null;
          if (!el) return;
          if (looksLikeCheckoutTarget(el)) {
            safe(trackInitiateCheckout, 'ic-click')();
          }
        } catch (e2) {}
      }, true);

      document.addEventListener('submit', function (e) {
        try {
          var form = e.target;
          if (!form || !form.action) return;
          if (/\/checkout/.test(form.action) || /\/cart/.test(form.action) && /checkout/i.test((form.querySelector('button[name=checkout],input[name=checkout]') || {}).name || '')) {
            safe(trackInitiateCheckout, 'ic-submit')();
          }
        } catch (e2) {}
      }, true);

      // Catch programmatic navigations to /checkouts/* in same page (rare)
      if (window.history && window.history.pushState) {
        var origPush = window.history.pushState;
        window.history.pushState = function () {
          try {
            var url = arguments[2];
            if (typeof url === 'string' && /\/checkout/.test(url)) {
              safe(trackInitiateCheckout, 'ic-push')();
            }
          } catch (e) {}
          return origPush.apply(this, arguments);
        };
      }
    } catch (e) { log('checkout hooks failed', e); }
  }

  // ─────────────────── 12. Init ────────────────────────────────────────────────
  function init() {
    // Touch identifiers early so they're available for everyone
    ensureLandingUrl();
    ensureFbp();
    ensureFbc();
    getClientId();
    getOrCreatePurchaseEid();

    // PageView always
    safe(trackPageView, 'init-pv')();

    // ViewContent (product page) — wait briefly for window.meta.product to populate
    if (isProductPage()) {
      var attempts = 0;
      var iv = window.setInterval(function () {
        attempts++;
        if (getCurrentProduct() || attempts >= 20) {
          window.clearInterval(iv);
          safe(trackViewContent, 'init-vc')();
        }
      }, 100);
    }

    // Checkout & Thank-You are NOT handled here — see custom-pixel.js (Shopify
    // Custom Pixel) which subscribes to checkout_started and checkout_completed.

    safe(installCartAddHooks, 'init-atc-hooks')();
    safe(installCheckoutHooks, 'init-ic-hooks')();

    log('init done', { store_id: STORE_ID, api: API_ORIGIN });
  }

  // Expose a small debug surface
  try {
    window._mt = {
      version: '0.1.0',
      storeId: STORE_ID,
      getClientId: getClientId,
      getPurchaseEid: getOrCreatePurchaseEid,
      writeCartAttributes: writeCartAttributes,
      trackPageView: trackPageView,
      trackViewContent: trackViewContent,
      trackAddToCart: trackAddToCart,
      trackInitiateCheckout: trackInitiateCheckout,
      buildCartAttributes: buildCartAttributes
    };
  } catch (e) {}

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', safe(init, 'dom-init'));
  } else {
    safe(init, 'immediate-init')();
  }
})();
