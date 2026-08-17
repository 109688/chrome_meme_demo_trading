/**
 * MAIN-world: stream GMGN's own live price to the panel.
 * 1) Lock ONE header $ price node (MutationObserver + 100ms tick)
 * 2) Mirror fetch / XHR / WebSocket JSON (same feed that drives the UI)
 * Single page family → realtime without Dex↔DOM large-gap flicker.
 */
(function () {
  'use strict';
  if (window.__gmgnPaperPageHooked) return;
  window.__gmgnPaperPageHooked = true;

  var subMap = { '₀': 0, '₁': 1, '₂': 2, '₃': 3, '₄': 4, '₅': 5, '₆': 6, '₇': 7, '₈': 8, '₉': 9 };
  var lockedEl = null;
  var lastSent = 0;
  var lastSentAt = 0;

  function emitTick(price) {
    try {
      window.postMessage(
        { source: 'gmgn-paper-trade', type: 'dom-tick', price: price, ts: Date.now() },
        '*'
      );
    } catch (_) {}
  }

  function emitJson(payload) {
    try {
      window.postMessage({ source: 'gmgn-paper-trade', type: 'price-json', payload: payload }, '*');
    } catch (_) {}
  }

  function parseMoney(text) {
    if (text == null) return null;
    var s = String(text).trim();
    if (!s || s.length > 40) return null;
    var sm = s.match(/\$?\s*0\.0([₀₁₂₃₄₅₆₇₈₉])(\d+)/);
    if (sm) {
      var zeros = subMap[sm[1]];
      var n = Number('0.' + Array(zeros + 1).join('0') + sm[2]);
      return n > 0 && isFinite(n) ? n : null;
    }
    s = s.replace(/[$,\s]/g, '').replace(/USDT|USD|USDC/gi, '');
    var m = s.match(/^(-?\d+(?:\.\d+)?(?:e[+-]?\d+)?)$/i);
    if (!m) return null;
    var n2 = Number(m[1]);
    return isFinite(n2) && n2 > 0 ? n2 : null;
  }

  function looksLikeUnitPrice(n, raw) {
    if (!(n > 0) || n >= 1000) return false;
    var r = String(raw || '').trim();
    if (/^\$/.test(r) || /0\.0[₀₁₂₃₄₅₆₇₈₉]/.test(r)) return true;
    return n < 50;
  }

  function findHeaderPriceEl() {
    var h1 = document.querySelector('h1');
    var roots = [];
    if (h1) {
      var p = h1.parentElement;
      for (var up = 0; up < 4 && p; up++) {
        roots.push(p);
        p = p.parentElement;
      }
    }
    roots.push(document.querySelector('main') || document.body);

    for (var r = 0; r < roots.length; r++) {
      var root = roots[r];
      if (!root) continue;
      var nodes = root.querySelectorAll('span, div, b, strong');
      var max = Math.min(nodes.length, 280);
      var best = null;
      for (var i = 0; i < max; i++) {
        var el = nodes[i];
        // Allow light nesting ($ + digits / subscript digits)
        if ((el.childElementCount || 0) > 6) continue;
        var raw = (el.textContent || '').trim().replace(/\s+/g, '');
        if (!raw || raw.length > 28) continue;
        if (raw.charAt(0) !== '$' && !/^0\.0[₀₁₂₃₄₅₆₇₈₉]/.test(raw)) continue;
        var n = parseMoney(raw);
        if (!looksLikeUnitPrice(n, raw)) continue;
        // Prefer shorter leaf-ish $ nodes near the header
        if (!best || raw.length < best.raw.length || (el.childElementCount || 0) < best.kids) {
          best = { el: el, raw: raw, kids: el.childElementCount || 0, n: n };
        }
        if (raw.charAt(0) === '$' && (el.childElementCount || 0) <= 2 && n < 10) {
          return el;
        }
      }
      if (best) return best.el;
    }
    return null;
  }

  function readLocked() {
    if (!lockedEl || !document.contains(lockedEl)) {
      lockedEl = findHeaderPriceEl();
    }
    if (!lockedEl) return null;
    var raw = (lockedEl.textContent || '').trim().replace(/\s+/g, '');
    var n = parseMoney(raw);
    if (!looksLikeUnitPrice(n, raw)) {
      lockedEl = null;
      return null;
    }
    return n;
  }

  function tick() {
    var px = readLocked();
    if (px == null) return;
    var now = Date.now();
    var changed = !(lastSent > 0) || Math.abs(px - lastSent) / lastSent > 1e-12;
    if (!changed && now - lastSentAt < 400) return;
    lastSent = px;
    lastSentAt = now;
    emitTick(px);
  }

  function maybeParse(text, url) {
    try {
      if (!text || typeof text !== 'string') return;
      if (
        !/gmgn|token|price|pair|pool|trade|candle|kline|stat|mutil_window|ticker|quote|ws/i.test(
          String(url || text.slice(0, 160))
        )
      ) {
        return;
      }
      var t = text.trim();
      if (t[0] !== '{' && t[0] !== '[') return;
      emitJson(JSON.parse(t));
    } catch (_) {}
  }

  window.addEventListener('message', function (ev) {
    var d = ev && ev.data;
    if (!d || d.source !== 'gmgn-paper-trade-req') return;
    if (d.type === 'reset-lock') {
      lockedEl = null;
      lastSent = 0;
      lastSentAt = 0;
      setTimeout(tick, 50);
    } else if (d.type === 'ping-tick') {
      tick();
    } else if (d.type === 'fetch-token-info') {
      try {
        var api =
          (location.origin || 'https://gmgn.ai') + '/api/v1/mutil_window_token_info';
        fetch(api, {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
          body: JSON.stringify({ addresses: [d.address], chain: d.chain }),
        })
          .then(function (res) {
            return res.json();
          })
          .then(function (json) {
            window.postMessage(
              { source: 'gmgn-paper-trade', type: 'token-info', payload: json, address: d.address },
              '*'
            );
          })
          .catch(function () {});
      } catch (_) {}
    }
  });

  var ofetch = window.fetch;
  if (typeof ofetch === 'function') {
    window.fetch = function () {
      var args = arguments;
      var url = typeof args[0] === 'string' ? args[0] : args[0] && args[0].url;
      return ofetch.apply(this, args).then(function (res) {
        try {
          res
            .clone()
            .text()
            .then(function (t) {
              maybeParse(t, url);
            })
            .catch(function () {});
        } catch (_) {}
        return res;
      });
    };
  }

  var XO = XMLHttpRequest.prototype.open;
  var XS = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.open = function (method, url) {
    this.__gptUrl = url;
    return XO.apply(this, arguments);
  };
  XMLHttpRequest.prototype.send = function () {
    this.addEventListener('load', function () {
      try {
        maybeParse(this.responseText, this.__gptUrl);
      } catch (_) {}
    });
    return XS.apply(this, arguments);
  };

  try {
    var OrigWS = window.WebSocket;
    if (typeof OrigWS === 'function') {
      function WrappedWS(url, protocols) {
        var ws = protocols !== undefined ? new OrigWS(url, protocols) : new OrigWS(url);
        try {
          ws.addEventListener('message', function (ev) {
            try {
              var data = ev && ev.data;
              if (typeof data === 'string') maybeParse(data, url);
              else if (data && typeof Blob !== 'undefined' && data instanceof Blob) {
                data
                  .text()
                  .then(function (t) {
                    maybeParse(t, url);
                  })
                  .catch(function () {});
              }
            } catch (_) {}
          });
        } catch (_) {}
        return ws;
      }
      WrappedWS.prototype = OrigWS.prototype;
      WrappedWS.CONNECTING = OrigWS.CONNECTING;
      WrappedWS.OPEN = OrigWS.OPEN;
      WrappedWS.CLOSING = OrigWS.CLOSING;
      WrappedWS.CLOSED = OrigWS.CLOSED;
      window.WebSocket = WrappedWS;
    }
  } catch (_) {}

  setInterval(tick, 100);
  setTimeout(tick, 200);
  setTimeout(tick, 600);
  setTimeout(tick, 1200);

  try {
    var mo = new MutationObserver(function () {
      if (mo._busy) return;
      mo._busy = 1;
      setTimeout(function () {
        mo._busy = 0;
        tick();
      }, 30);
    });
    var start = function () {
      if (!document.body) return setTimeout(start, 150);
      mo.observe(document.body, { childList: true, subtree: true, characterData: true });
    };
    start();
  } catch (_) {}
})();
