(function () {
  'use strict';

  // 最先执行：证明脚本真的注入了（不依赖后面任何逻辑）
  console.log('[GMGN Paper Trade] script loaded on', location.href, 'v1.5.0');
  function showBeacon(text) {
    try {
      var old = document.getElementById('gpt-beacon');
      if (old) old.remove();
      var d = document.createElement('div');
      d.id = 'gpt-beacon';
      d.textContent = text;
      d.style.cssText = 'position:fixed!important;top:0!important;left:0!important;right:0!important;z-index:2147483647!important;background:#c45c26!important;color:#fff!important;text-align:center!important;padding:6px 10px!important;font:13px/1.35 "Segoe UI","Microsoft YaHei",sans-serif!important;font-weight:700!important;box-shadow:0 2px 10px rgba(0,0,0,.4)!important;';
      (document.body || document.documentElement).appendChild(d);
      setTimeout(function () {
        try {
          if (d.parentNode) d.remove();
        } catch (_) {}
      }, 2800);
    } catch (e) {
      console.error('[GMGN Paper Trade] beacon failed', e);
    }
  }
  showBeacon('GMGN 模拟交易 v1.5.0 已注入');
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () {
      showBeacon('GMGN 模拟交易 v1.5.0 已注入');
    });
  }

  const STORAGE_KEY = 'gmgn_paper_trade_v1';
  const PANEL_ID = 'gmgn-paper-trade-root';
  const FAB_ID = 'gmgn-paper-trade-fab';
  const DEFAULT_START_CASH = 10000;
  const PRICE_POLL_MS = 400;
  /** Buy/sell only when quote is from GMGN/Dex and younger than this */
  const QUOTE_MAX_AGE_MS = 8000;
  /** After SPA route change, ignore DOM prices (prevents previous-token bleed) */
  const DOM_ROUTE_GRACE_MS = 1800;
  /** Reject DOM quotes that jump more than this vs current mark */
  const DOM_MAX_JUMP = 5;
  const HELD_QUOTE_REFRESH_MS = 15000;
  const LOG = (...args) => console.log('[GMGN Paper Trade]', ...args);
  const SUPPORTED_CHAINS = new Set([
    'sol', 'bsc', 'robinhood', 'base', 'eth', 'monad', 'tron', 'blast', 'arc', 'stable',
  ]);

  const CHAIN_ALIASES = {
    solana: 'sol',
    sol: 'sol',
    bsc: 'bsc',
    bnb: 'bsc',
    binance: 'bsc',
    robinhood: 'robinhood',
    hood: 'robinhood',
    rh: 'robinhood',
    base: 'base',
    eth: 'eth',
    ethereum: 'eth',
    monad: 'monad',
    tron: 'tron',
    blast: 'blast',
    arc: 'arc',
    stable: 'stable',
  };

  let state = null;
  let live = {
    chain: null,
    address: null,
    symbol: '—',
    price: null,
    mcap: null,
    source: '',
    updatedAt: 0,
    routeGen: 0,
  };
  let lastRoute = '';
  let routeChangedAt = 0;
  let dragOffset = { x: 0, y: 0 };
  let dragging = false;
  let bootTries = 0;
  // Must be declared before any early scheduleRender() call (TDZ fix)
  let renderQueued = false;
  let lastDexFetchAt = 0;
  let dexFetching = false;
  let lastGmgnFetchAt = 0;
  let gmgnFetching = false;
  let lastHeldRefreshAt = 0;
  let heldRefreshing = false;
  const SOURCE_RANK = { 'gmgn-api': 3, dex: 2, dom: 1, '': 0 };
  const TRUSTED_SOURCES = new Set(['gmgn-api', 'dex']);

  try {
    state = loadState();
    if (!state.ui.sections) {
      state.ui.sections = { positions: false, trades: false, settings: false, limits: false };
    }
    if (!Array.isArray(state.orders)) state.orders = [];
    if (!Array.isArray(state.settings.buyPcts) || !state.settings.buyPcts.length) {
      state.settings.buyPcts = [25, 50, 100];
    }
    if (!Array.isArray(state.settings.sellPcts) || !state.settings.sellPcts.length) {
      state.settings.sellPcts = [25, 50, 100];
    }
    installPageHooks();
    installSpaHooks();
    scheduleBoot();
    window.addEventListener('keydown', onHotkey, true);
    showBeacon('GMGN 模拟交易已就绪 v1.5.0');
  } catch (err) {
    console.error('[GMGN Paper Trade] fatal init error', err);
    showBeacon('GMGN 模拟脚本出错: ' + (err && err.message ? err.message : err));
  }

  // ---------------------------------------------------------------------------
  // Storage
  // ---------------------------------------------------------------------------

  function defaultState() {
    return {
      version: 2,
      cashUsdt: DEFAULT_START_CASH,
      realizedPnl: 0,
      dayAnchor: startOfDay(),
      dayStartEquity: DEFAULT_START_CASH,
      positions: {},
      trades: [],
      orders: [],
      settings: {
        slippageBps: 100,
        feeBps: 100,
        startCash: DEFAULT_START_CASH,
        buyPcts: [25, 50, 100],
        sellPcts: [25, 50, 100],
      },
      ui: {
        left: null,
        top: null,
        collapsed: false,
        hidden: false,
        sections: { positions: false, trades: false, settings: false, limits: false },
      },
    };
  }

  function startOfDay() {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return d.getTime();
  }

  function loadState() {
    let raw = null;
    try {
      if (typeof GM_getValue === 'function') raw = GM_getValue(STORAGE_KEY, null);
    } catch (_) {
      raw = null;
    }
    if (!raw) {
      try {
        const ls = localStorage.getItem(STORAGE_KEY);
        if (ls) raw = JSON.parse(ls);
      } catch (_) {
        raw = null;
      }
    }
    const base = defaultState();
    if (!raw || typeof raw !== 'object') return base;
    return {
      ...base,
      ...raw,
      settings: {
        ...base.settings,
        ...(raw.settings || {}),
        buyPcts: normalizePctList((raw.settings && raw.settings.buyPcts) || base.settings.buyPcts),
        sellPcts: normalizePctList((raw.settings && raw.settings.sellPcts) || base.settings.sellPcts),
      },
      ui: {
        ...base.ui,
        ...(raw.ui || {}),
        sections: { ...base.ui.sections, ...((raw.ui && raw.ui.sections) || {}) },
      },
      positions: raw.positions && typeof raw.positions === 'object' ? raw.positions : {},
      trades: Array.isArray(raw.trades) ? raw.trades : [],
      orders: Array.isArray(raw.orders) ? raw.orders : [],
    };
  }

  function normalizePctList(list) {
    const arr = Array.isArray(list)
      ? list
      : String(list || '')
          .split(/[,，\s]+/)
          .map((x) => Number(x))
          .filter((n) => Number.isFinite(n) && n > 0 && n <= 100);
    const cleaned = arr
      .map((n) => Math.round(Number(n)))
      .filter((n) => n > 0 && n <= 100);
    const uniq = [];
    cleaned.forEach((n) => {
      if (!uniq.includes(n)) uniq.push(n);
    });
    return uniq.length ? uniq.slice(0, 6) : [25, 50, 100];
  }

  function saveState() {
    try {
      if (typeof GM_setValue === 'function') GM_setValue(STORAGE_KEY, state);
    } catch (_) {
      /* ignore */
    }
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch (_) {
      /* ignore */
    }
  }

  function ensureDayAnchor() {
    const today = startOfDay();
    if (state.dayAnchor !== today) {
      state.dayAnchor = today;
      state.dayStartEquity = calcEquity();
      saveState();
    }
  }

  // ---------------------------------------------------------------------------
  // Route / chain / token  (GMGN uses /{chain}/token/{ref}_{address})
  // ---------------------------------------------------------------------------

  function normalizeChain(raw) {
    if (!raw) return null;
    const key = String(raw).toLowerCase().replace(/[^a-z0-9]/g, '');
    return CHAIN_ALIASES[key] || (SUPPORTED_CHAINS.has(key) ? key : null);
  }

  function looksLikeAddress(value, chain) {
    if (!value || typeof value !== 'string') return false;
    if (/^0x[a-fA-F0-9]{40}$/i.test(value)) return true;
    // Solana / base58 style
    if (/^[1-9A-HJ-NP-Za-km-z]{32,48}$/.test(value)) return true;
    if (chain === 'robinhood' && value.length >= 20 && /^[0-9A-Za-z]+$/.test(value)) return true;
    return false;
  }

  /** Strip GMGN referral prefix: "7rpqjHdf_So111..." or "xxx_0xabc..." */
  function extractTokenAddress(raw, chain) {
    if (!raw) return null;
    let s = decodeURIComponent(String(raw)).trim();
    // query junk
    s = s.split('?')[0].split('#')[0];

    if (/0x[a-fA-F0-9]{40}/i.test(s)) {
      const m = s.match(/0x[a-fA-F0-9]{40}/i);
      return m ? m[0] : null;
    }

    if (s.includes('_')) {
      const parts = s.split('_');
      // Prefer longest trailing segment that looks like an address
      for (let i = 1; i < parts.length; i++) {
        const candidate = parts.slice(i).join('_');
        if (looksLikeAddress(candidate, chain)) return candidate;
      }
      // Referral codes are usually short; take everything after first _
      const after = parts.slice(1).join('_');
      if (after.length >= 20) return after;
    }

    if (looksLikeAddress(s, chain)) return s;
    // Accept long opaque token path segments
    if (s.length >= 20 && /^[0-9A-Za-z]+$/.test(s)) return s;
    return null;
  }

  function guessChainFromAddress(address) {
    if (/^0x[a-fA-F0-9]{40}$/i.test(address)) return 'bsc';
    return 'sol';
  }

  function parseRoute(pathname) {
    const parts = (pathname || '').split('/').filter(Boolean);
    // drop locale prefix like zh-CN
    const filtered = parts.filter((p) => !/^[a-z]{2}(-[A-Za-z]{2})?$/i.test(p) || normalizeChain(p));

    let chain = null;
    let address = null;
    let page = 'other';

    for (let i = 0; i < filtered.length; i++) {
      const c = normalizeChain(filtered[i]);
      if (!c) continue;
      chain = c;
      const next = filtered[i + 1];
      const maybeAddr = filtered[i + 2];

      if (next && /^(token|tokens)$/i.test(next) && maybeAddr) {
        address = extractTokenAddress(maybeAddr, c);
        page = address ? 'token' : 'other';
        break;
      }
      if (next && /^(address|addr|wallet)$/i.test(next)) {
        page = 'wallet';
        break;
      }
      if (next) {
        const extracted = extractTokenAddress(next, c);
        if (extracted) {
          address = extracted;
          page = 'token';
          break;
        }
        if (/trench|meme|new|pair|pump/i.test(next)) page = 'trenches';
      } else {
        page = 'home';
      }
      break;
    }

    // ?chain=sol fallback
    if (!chain) {
      try {
        const q = new URLSearchParams(location.search).get('chain');
        chain = normalizeChain(q);
      } catch (_) {
        /* ignore */
      }
    }

    // /token/<chain>/<addr>
    if (!address) {
      const tokenIdx = filtered.findIndex((p) => /^(token|tokens)$/i.test(p));
      if (tokenIdx >= 0) {
        const maybeChain = normalizeChain(filtered[tokenIdx + 1]);
        if (maybeChain && filtered[tokenIdx + 2]) {
          chain = maybeChain;
          address = extractTokenAddress(filtered[tokenIdx + 2], maybeChain);
          if (address) page = 'token';
        } else if (filtered[tokenIdx + 1]) {
          address = extractTokenAddress(filtered[tokenIdx + 1], chain || 'sol');
          if (address) {
            page = 'token';
            if (!chain) chain = guessChainFromAddress(address);
          }
        }
      }
    }

    return { chain, address, page };
  }

  function posKey(chain, address) {
    return `${chain}:${address}`;
  }

  function shortAddr(addr) {
    if (!addr || addr.length < 10) return addr || '—';
    return `${addr.slice(0, 4)}…${addr.slice(-4)}`;
  }

  // ---------------------------------------------------------------------------
  // Price helpers + network hooks (page context)
  // ---------------------------------------------------------------------------

  function parseMoney(text) {
    if (text == null) return null;
    let s = String(text).trim();
    if (!s) return null;

    // GMGN tiny-price subscripts: $0.0₅123 → 0.00000123
    const subMap = { '₀': 0, '₁': 1, '₂': 2, '₃': 3, '₄': 4, '₅': 5, '₆': 6, '₇': 7, '₈': 8, '₉': 9 };
    const subRe = /\$?\s*0\.0([₀₁₂₃₄₅₆₇₈₉])(\d+)/;
    const sm = s.match(subRe);
    if (sm) {
      const zeros = subMap[sm[1]];
      const digits = sm[2];
      const n = Number('0.' + '0'.repeat(zeros) + digits);
      return Number.isFinite(n) && n > 0 ? n : null;
    }

    s = s.replace(/[$,\s]/g, '').replace(/USDT|USD|USDC/gi, '');
    // 中文单位
    s = s.replace(/万/g, 'e4').replace(/亿/g, 'e8');
    const m = s.match(/^([<>~≈]?)(-?\d+(?:\.\d+)?(?:e[+-]?\d+)?)([KMBTkmbt万亿]?)$/);
    if (!m) {
      const n = Number(s);
      return Number.isFinite(n) ? n : null;
    }
    let n = Number(m[2]);
    const suf = (m[3] || '').toUpperCase();
    const mul = { K: 1e3, M: 1e6, B: 1e9, T: 1e12, 万: 1e4, 亿: 1e8 }[suf] || 1;
    n *= mul;
    return Number.isFinite(n) ? n : null;
  }

  function coercePriceValue(v) {
    if (v == null) return null;
    if (typeof v === 'number' && v > 0 && Number.isFinite(v)) return v;
    if (typeof v === 'string') return parseMoney(v);
    if (typeof v === 'object') {
      // GMGN nested: { price: "0.001", ... }
      if (v.price != null) return coercePriceValue(v.price);
      if (v.price_usd != null) return coercePriceValue(v.price_usd);
      if (v.usd != null) return coercePriceValue(v.usd);
    }
    return null;
  }

  function addrEquals(a, b) {
    if (!a || !b) return false;
    return String(a).toLowerCase() === String(b).toLowerCase();
  }

  function extractFromTokenObj(obj) {
    if (!obj || typeof obj !== 'object') return null;
    const addr =
      obj.address || obj.token_address || obj.tokenAddress || obj.mint || obj.contract_address || obj.ca || null;
    const symbol = obj.symbol || obj.token_symbol || obj.tokenSymbol || null;
    let price = coercePriceValue(obj.price);
    if (price == null) price = coercePriceValue(obj.price_usd || obj.usd_price || obj.usdPrice);
    let mcap = coercePriceValue(
      obj.market_cap || obj.marketCap || obj.marketcap || obj.usd_market_cap || obj.mc || obj.fdv
    );
    if (mcap == null && price != null) {
      const supply = Number(obj.circulating_supply || obj.total_supply || obj.totalSupply);
      if (Number.isFinite(supply) && supply > 0) mcap = price * supply;
    }
    if (price == null) return null;
    return {
      price,
      mcap: mcap != null && mcap > 0 ? mcap : null,
      symbol: typeof symbol === 'string' ? symbol : null,
      address: typeof addr === 'string' ? extractTokenAddress(addr) || addr : null,
    };
  }

  function deepFindPrice(obj, depth = 0, preferAddr = null) {
    if (!obj || depth > 8) return null;
    if (Array.isArray(obj)) {
      let best = null;
      for (const item of obj) {
        const r = deepFindPrice(item, depth + 1, preferAddr);
        if (!r) continue;
        if (preferAddr && r.address && addrEquals(r.address, preferAddr)) return r;
        if (!preferAddr && !best) best = r;
      }
      // When a preferred address is set, never return an unmatched first hit
      return preferAddr ? null : best;
    }
    if (typeof obj !== 'object') return null;

    const direct = extractFromTokenObj(obj);
    if (direct) {
      if (preferAddr) {
        if (direct.address && addrEquals(direct.address, preferAddr)) return direct;
      } else {
        // keep scanning for a better match only when no preferAddr
      }
    }

    let best = preferAddr ? null : direct;
    for (const k of Object.keys(obj)) {
      const v = obj[k];
      if (v && typeof v === 'object') {
        const r = deepFindPrice(v, depth + 1, preferAddr);
        if (!r) continue;
        if (preferAddr && r.address && addrEquals(r.address, preferAddr)) return r;
        if (!preferAddr && !best) best = r;
      }
    }
    if (preferAddr) return null;
    if (!best && direct && !preferAddr) best = direct;
    return best;
  }

  function isTrustedSource(src) {
    return TRUSTED_SOURCES.has(src || '');
  }

  function quoteAgeMs() {
    if (!live.updatedAt) return Infinity;
    return Date.now() - live.updatedAt;
  }

  function routeGraceActive() {
    return routeChangedAt > 0 && Date.now() - routeChangedAt < DOM_ROUTE_GRACE_MS;
  }

  function rememberMarkPrice(price) {
    if (!(price > 0) || !live.chain || !live.address) return;
    const key = posKey(live.chain, live.address);
    const pos = state.positions[key];
    if (!pos) return;
    pos.lastPrice = price;
    pos.lastPriceAt = Date.now();
  }

  function markPriceForPos(key, pos) {
    if (isCurrentPos(key) && live.price != null && live.price > 0) return live.price;
    if (pos && pos.lastPrice != null && pos.lastPrice > 0) return pos.lastPrice;
    return pos ? pos.avgCostUsdt : null;
  }

  function applyLiveQuote(found, source) {
    if (!found || found.price == null || !(found.price > 0)) return false;
    const route = parseRoute(location.pathname);
    const want = route.address || live.address;

    // Never attach a quote from another token
    if (want && found.address && !addrEquals(found.address, want)) return false;

    // Trusted API/Dex must carry a matching address when we know the token
    if (want && isTrustedSource(source) && !found.address) return false;

    // DOM during SPA transition often still shows the previous token
    if (source === 'dom' && want && routeGraceActive()) {
      if (found.symbol && (!live.symbol || live.symbol === '—')) live.symbol = found.symbol;
      return false;
    }

    // DOM without verified address: display-only gap fill after grace; never overwrite trusted
    if (want && !found.address) {
      if (source !== 'dom') return false;
      if (live.price != null && isTrustedSource(live.source)) return false;
      if (routeGraceActive()) return false;
    }

    // Reject absurd DOM jumps (often mis-bound mcap / wrong node)
    if (source === 'dom' && live.price != null && live.price > 0) {
      const ratio = found.price / live.price;
      if (ratio > DOM_MAX_JUMP || ratio < 1 / DOM_MAX_JUMP) return false;
    }

    // If labeled "price" looks like a market-cap scale vs known mcap, reject
    if (found.mcap != null && found.mcap > 0 && found.price > 0) {
      if (found.price > found.mcap * 0.5 && found.mcap > 1000) return false;
    }

    const incoming = SOURCE_RANK[source] || 0;
    const current = SOURCE_RANK[live.source] || 0;
    // Lower-ranked source cannot overwrite a higher-ranked quote unless empty
    if (live.price != null && incoming < current) {
      if (live.mcap == null && found.mcap != null && found.mcap > 0 && incoming >= 1) {
        live.mcap = found.mcap;
        scheduleRender();
      }
      return false;
    }

    // Same or higher rank: still reject stale DOM overwriting a fresh trusted quote of equal... DOM is always lower
    live.price = found.price;
    if (found.mcap != null && found.mcap > 0) live.mcap = found.mcap;
    if (found.symbol) live.symbol = found.symbol;
    if (found.address && !live.address) live.address = found.address;
    live.source = source || live.source || '';
    live.updatedAt = Date.now();
    rememberMarkPrice(found.price);
    checkLimitOrders();
    scheduleRender();
    return true;
  }

  function ingestJsonPayload(data) {
    try {
      const route = parseRoute(location.pathname);
      const want = route.address || live.address;
      // Require address match — never promote anonymous first-price hits to gmgn-api
      if (!want) return;
      const found = deepFindPrice(data, 0, want);
      if (!found || !found.address || !addrEquals(found.address, want)) return;
      applyLiveQuote(found, 'gmgn-api');
    } catch (_) {
      /* ignore */
    }
  }

  function parseGmgnTokenInfoPayload(data, address) {
    const list = (data && (data.data || data.tokens || data)) || null;
    const arr = Array.isArray(list) ? list : list && typeof list === 'object' ? [list] : [];
    for (const item of arr) {
      const extracted = extractFromTokenObj(item);
      if (!extracted) continue;
      if (address && extracted.address && !addrEquals(extracted.address, address)) continue;
      if (!extracted.address) extracted.address = address;
      return extracted;
    }
    return deepFindPrice(data, 0, address);
  }

  function fetchGmgnTokenInfo(force) {
    const route = parseRoute(location.pathname);
    const address = route.address || live.address;
    const chain = route.chain || live.chain;
    if (!address || !chain) return;
    const now = Date.now();
    if (!force && (gmgnFetching || now - lastGmgnFetchAt < 900)) return;
    lastGmgnFetchAt = now;
    gmgnFetching = true;

    // Ask page context to fetch (has cookies / same-origin) — more reliable than extension sandbox
    try {
      window.postMessage(
        {
          source: 'gmgn-paper-trade-req',
          type: 'fetch-token-info',
          chain,
          address,
        },
        '*'
      );
    } catch (_) {
      /* ignore */
    }

    // Also try directly (works for extension host_permissions / some TM setups)
    fetch('https://gmgn.ai/api/v1/mutil_window_token_info', {
      method: 'POST',
      credentials: 'include',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify({ addresses: [address], chain }),
    })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error('status ' + r.status))))
      .then((data) => {
        gmgnFetching = false;
        const found = parseGmgnTokenInfoPayload(data, address);
        if (found) applyLiveQuote(found, 'gmgn-api');
      })
      .catch(() => {
        gmgnFetching = false;
      });
  }

  function fetchDexScreenerQuote(force) {
    const route = parseRoute(location.pathname);
    const address = route.address || live.address;
    if (!address) return;
    const now = Date.now();
    if (!force && (dexFetching || now - lastDexFetchAt < 1200)) return;
    lastDexFetchAt = now;
    dexFetching = true;
    const url = 'https://api.dexscreener.com/latest/dex/tokens/' + encodeURIComponent(address);
    fetch(url)
      .then((r) => r.json())
      .then((data) => {
        dexFetching = false;
        const pairs = (data && data.pairs) || [];
        if (!pairs.length) return;
        const matched = pairs
          .filter((p) => {
            const base = p.baseToken && p.baseToken.address;
            return base && addrEquals(base, address);
          })
          .sort((a, b) => (Number(b.liquidity && b.liquidity.usd) || 0) - (Number(a.liquidity && a.liquidity.usd) || 0));
        const pick = matched[0];
        if (!pick) return;
        const price = Number(pick.priceUsd);
        const mcap = Number(pick.marketCap || pick.fdv);
        const symbol = (pick.baseToken && pick.baseToken.symbol) || null;
        applyLiveQuote(
          {
            price: Number.isFinite(price) && price > 0 ? price : null,
            mcap: Number.isFinite(mcap) && mcap > 0 ? mcap : null,
            symbol,
            address,
          },
          'dex'
        );
      })
      .catch(() => {
        dexFetching = false;
      });
  }

  /** Mark-to-market off-page holdings via DexScreener (avoids equity stuck at cost) */
  function refreshHeldQuotes(force) {
    const now = Date.now();
    if (!force && (heldRefreshing || now - lastHeldRefreshAt < HELD_QUOTE_REFRESH_MS)) return;
    const entries = Object.entries(state.positions || {});
    if (!entries.length) return;
    lastHeldRefreshAt = now;
    heldRefreshing = true;

    const jobs = entries
      .filter(([key, pos]) => pos && pos.amount > 0 && pos.address && !isCurrentPos(key))
      .slice(0, 8)
      .map(([key, pos]) => {
        const url = 'https://api.dexscreener.com/latest/dex/tokens/' + encodeURIComponent(pos.address);
        return fetch(url)
          .then((r) => r.json())
          .then((data) => {
            const pairs = (data && data.pairs) || [];
            const matched = pairs
              .filter((p) => {
                const base = p.baseToken && p.baseToken.address;
                return base && addrEquals(base, pos.address);
              })
              .sort(
                (a, b) =>
                  (Number(b.liquidity && b.liquidity.usd) || 0) - (Number(a.liquidity && a.liquidity.usd) || 0)
              );
            const pick = matched[0];
            if (!pick) return;
            const price = Number(pick.priceUsd);
            if (!(price > 0)) return;
            const cur = state.positions[key];
            if (!cur) return;
            cur.lastPrice = price;
            cur.lastPriceAt = Date.now();
            if (pick.baseToken && pick.baseToken.symbol) cur.symbol = pick.baseToken.symbol;
          })
          .catch(() => {});
      });

    Promise.all(jobs).finally(() => {
      heldRefreshing = false;
      scheduleRender();
    });
  }

  function findLabeledValue(labels, opts) {
    const maxVal = (opts && opts.max) || Infinity;
    if (!document.body) return null;
    const all = document.body.querySelectorAll('div, span, p, dt, dd, th, td, label');
    for (let i = 0; i < all.length && i < 2500; i++) {
      const el = all[i];
      const raw = (el.childNodes.length === 1 ? el.textContent : el.childNodes[0] && el.childNodes[0].textContent) || '';
      const t = String(raw).trim();
      if (!t || t.length > 24) continue;
      if (!labels.some((lb) => t === lb || t.replace(/[:：]/g, '') === lb)) continue;
      const parent = el.parentElement;
      if (parent) {
        const texts = Array.from(parent.querySelectorAll('span, div, p, b, strong'))
          .map((n) => (n.textContent || '').trim())
          .filter((x) => x && x !== t && x.length < 40);
        for (const x of texts) {
          const n = parseMoney(x);
          if (n != null && n > 0 && n < maxVal) return n;
        }
        const pt = (parent.textContent || '').replace(t, ' ').trim();
        const n = parseMoney(pt.split(/\s+/).find((w) => /[\d$]/.test(w)) || pt);
        if (n != null && n > 0 && n < maxVal) return n;
      }
    }
    return null;
  }

  function scrapeDomPrice() {
    const route = parseRoute(location.pathname);
    if (route.chain) live.chain = route.chain;
    if (route.address) live.address = route.address;

    const h1 = document.querySelector('h1');
    if (h1) {
      const t = h1.textContent.trim().split(/\s+/)[0];
      if (t && t.length <= 24 && !/^\$?\d/.test(t)) live.symbol = t.replace(/^\$/, '');
    }
    if ((!live.symbol || live.symbol === '—') && document.title) {
      const tm = document.title.match(/^\$?([A-Za-z0-9._]{1,20})/);
      if (tm) live.symbol = tm[1];
    }

    // DOM is lowest priority — never stamp route address onto scraped numbers
    // (that caused previous-token price bleed on SPA navigations).
    const labeledPrice = findLabeledValue(['价格', 'Price', 'price', '单价'], { max: 1e6 });
    const labeledMcap = findLabeledValue(['市值', 'Market Cap', 'MarketCap', 'Mkt Cap', 'MC']);

    if (labeledPrice != null || labeledMcap != null) {
      applyLiveQuote(
        {
          price: labeledPrice,
          mcap: labeledMcap,
          symbol: live.symbol !== '—' ? live.symbol : null,
          address: null,
        },
        'dom'
      );
    } else if (live.price == null && !routeGraceActive() && document.body) {
      // Only when completely empty and past SPA grace: look for tiny prices near header
      const header = document.querySelector('h1') && document.querySelector('h1').parentElement;
      const scope = header || document.body;
      const nodes = scope.querySelectorAll('span, div, b, strong');
      for (let i = 0; i < nodes.length && i < 200; i++) {
        const txt = (nodes[i].textContent || '').trim();
        if (!txt || txt.length > 28) continue;
        if (!/^\$/.test(txt) && !/^0\.0[₀₁₂₃₄₅₆₇₈₉]/.test(txt)) continue;
        const n = parseMoney(txt);
        if (n != null && n > 0 && n < 100) {
          applyLiveQuote({ price: n, mcap: null, address: null }, 'dom');
          break;
        }
      }
    }

    if (route.address) {
      fetchGmgnTokenInfo(false);
      fetchDexScreenerQuote(false);
    }
    refreshHeldQuotes(false);
    scheduleRender();
  }

  function installPageHooks() {
    window.addEventListener('message', (ev) => {
      if (!ev || !ev.data) return;
      if (ev.data.source === 'gmgn-paper-trade' && ev.data.type === 'price-json') {
        ingestJsonPayload(ev.data.payload);
      }
      if (ev.data.source === 'gmgn-paper-trade' && ev.data.type === 'token-info') {
        gmgnFetching = false;
        const found = parseGmgnTokenInfoPayload(ev.data.payload, ev.data.address || live.address);
        if (found) applyLiveQuote(found, 'gmgn-api');
      }
    });

    const injected = `
      (function () {
        if (window.__gmgnPaperPageHooked) return;
        window.__gmgnPaperPageHooked = true;
        function emit(payload) {
          try {
            window.postMessage({ source: 'gmgn-paper-trade', type: 'price-json', payload: payload }, '*');
          } catch (e) {}
        }
        function maybeParse(text, url) {
          try {
            if (!text || typeof text !== 'string') return;
            if (!/gmgn|token|price|pair|pool|trade|candle|kline|stat|mutil_window|dexscreener/i.test(String(url || text.slice(0, 120)))) return;
            var t = text.trim();
            if (t[0] !== '{' && t[0] !== '[') return;
            emit(JSON.parse(t));
          } catch (e) {}
        }
        window.addEventListener('message', function (ev) {
          var d = ev && ev.data;
          if (!d || d.source !== 'gmgn-paper-trade-req' || d.type !== 'fetch-token-info') return;
          try {
            fetch('https://gmgn.ai/api/v1/mutil_window_token_info', {
              method: 'POST',
              credentials: 'include',
              headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
              body: JSON.stringify({ addresses: [d.address], chain: d.chain })
            }).then(function (res) { return res.json(); }).then(function (json) {
              window.postMessage({ source: 'gmgn-paper-trade', type: 'token-info', payload: json, address: d.address }, '*');
            }).catch(function () {});
          } catch (e) {}
        });
        var ofetch = window.fetch;
        if (typeof ofetch === 'function') {
          window.fetch = function () {
            var args = arguments;
            var url = typeof args[0] === 'string' ? args[0] : (args[0] && args[0].url);
            return ofetch.apply(this, args).then(function (res) {
              try {
                res.clone().text().then(function (t) { maybeParse(t, url); }).catch(function () {});
              } catch (e) {}
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
            try { maybeParse(this.responseText, this.__gptUrl); } catch (e) {}
          });
          return XS.apply(this, arguments);
        };
      })();
    `;

    try {
      const s = document.createElement('script');
      s.textContent = injected;
      (document.head || document.documentElement).appendChild(s);
      s.remove();
    } catch (err) {
      try {
        const w = window;
        const ofetch = w.fetch;
        if (ofetch && !w.__gmgnPaperFetchHooked) {
          w.__gmgnPaperFetchHooked = true;
          w.fetch = function (...args) {
            return ofetch.apply(this, args).then((res) => {
              res.clone().json().then((d) => ingestJsonPayload(d)).catch(() => {});
              return res;
            });
          };
        }
      } catch (e2) {
        LOG('network hook failed', e2);
      }
    }
  }

  function installSpaHooks() {
    const notify = () => queueMicrotask(onRouteMaybeChanged);
    const wrap = (fnName) => {
      const orig = history[fnName];
      if (orig.__gptWrapped) return;
      const wrapped = function (...args) {
        const ret = orig.apply(this, args);
        notify();
        return ret;
      };
      wrapped.__gptWrapped = true;
      history[fnName] = wrapped;
    };
    try {
      wrap('pushState');
      wrap('replaceState');
      window.addEventListener('popstate', onRouteMaybeChanged);
    } catch (err) {
      LOG('spa hook error', err);
    }
  }

  function onRouteMaybeChanged() {
    const key = location.pathname + location.search;
    if (key === lastRoute) return;
    lastRoute = key;
    const route = parseRoute(location.pathname);
    live.chain = route.chain;
    live.address = route.address || null;
    live.price = null;
    live.mcap = null;
    live.symbol = '—';
    live.source = '';
    live.updatedAt = 0;
    live.routeGen = (live.routeGen || 0) + 1;
    routeChangedAt = Date.now();
    lastDexFetchAt = 0;
    lastGmgnFetchAt = 0;
    LOG('route', route);
    // Prefer trusted APIs immediately; DOM scrape waits for grace inside applyLiveQuote
    if (route.address) {
      fetchGmgnTokenInfo(true);
      fetchDexScreenerQuote(true);
    }
    scrapeDomPrice();
    scheduleRender(true);
  }

  // ---------------------------------------------------------------------------
  // Paper engine
  // ---------------------------------------------------------------------------

  function calcPositionsValue() {
    let total = 0;
    for (const [key, pos] of Object.entries(state.positions)) {
      const px = markPriceForPos(key, pos);
      if (px != null && px > 0) total += pos.amount * px;
    }
    return total;
  }

  function isCurrentPos(key) {
    return live.chain && live.address && key === posKey(live.chain, live.address);
  }

  function calcEquity() {
    return state.cashUsdt + calcPositionsValue();
  }

  function currentPosition() {
    if (!live.chain || !live.address) return null;
    return state.positions[posKey(live.chain, live.address)] || null;
  }

  function applySlippage(price, side) {
    const bps = Number(state.settings.slippageBps) || 0;
    const m = bps / 10000;
    return side === 'buy' ? price * (1 + m) : price * (1 - m);
  }

  function applyFee(notional) {
    const bps = Number(state.settings.feeBps) || 0;
    return (notional * bps) / 10000;
  }

  /** Refuse trade on stale/DOM/unverified quotes — root cause of fake multi-x P&L */
  function assertTradeableQuote() {
    if (!live.chain || !live.address) return { ok: false, error: '请打开 token 详情页' };
    if (live.price == null || live.price <= 0) {
      fetchGmgnTokenInfo(true);
      fetchDexScreenerQuote(true);
      return { ok: false, error: '暂无有效价格，稍候再试' };
    }
    if (!isTrustedSource(live.source)) {
      fetchGmgnTokenInfo(true);
      fetchDexScreenerQuote(true);
      return { ok: false, error: '报价未就绪（需 GMGN/Dex），请稍候' };
    }
    if (quoteAgeMs() > QUOTE_MAX_AGE_MS) {
      fetchGmgnTokenInfo(true);
      fetchDexScreenerQuote(true);
      return { ok: false, error: '报价过期，正在刷新…' };
    }
    return { ok: true };
  }

  function buy(usdtAmount) {
    ensureDayAnchor();
    const amountIn = Number(usdtAmount);
    if (!Number.isFinite(amountIn) || amountIn <= 0) return { ok: false, error: '金额无效' };
    const q = assertTradeableQuote();
    if (!q.ok) return q;
    if (amountIn > state.cashUsdt + 1e-9) return { ok: false, error: '余额不足' };

    const midPrice = live.price;
    const execPrice = applySlippage(midPrice, 'buy');
    const fee = applyFee(amountIn);
    const net = amountIn - fee;
    if (net <= 0) return { ok: false, error: '金额过小' };
    const tokenAmount = net / execPrice;
    const key = posKey(live.chain, live.address);
    const prev = state.positions[key];
    if (prev) {
      const newAmt = prev.amount + tokenAmount;
      prev.avgCostUsdt = (prev.amount * prev.avgCostUsdt + net) / newAmt;
      prev.amount = newAmt;
      prev.symbol = live.symbol || prev.symbol;
      prev.lastPrice = midPrice;
      prev.lastPriceAt = Date.now();
    } else {
      state.positions[key] = {
        chain: live.chain,
        address: live.address,
        symbol: live.symbol || shortAddr(live.address),
        amount: tokenAmount,
        avgCostUsdt: execPrice,
        lastPrice: midPrice,
        lastPriceAt: Date.now(),
        openedAt: Date.now(),
      };
    }
    state.cashUsdt -= amountIn;
    pushTrade({
      side: 'buy',
      chain: live.chain,
      address: live.address,
      symbol: live.symbol || shortAddr(live.address),
      price: execPrice,
      midPrice,
      amount: tokenAmount,
      notional: amountIn,
      fee,
      realizedPnl: 0,
      quoteSource: live.source,
    });
    saveState();
    return { ok: true, execPrice, midPrice };
  }

  function sell(ratio) {
    const r = Number(ratio);
    if (!Number.isFinite(r) || r <= 0 || r > 1) return { ok: false, error: '比例无效' };
    if (!live.chain || !live.address) return { ok: false, error: '请打开 token 详情页' };
    const key = posKey(live.chain, live.address);
    const pos = state.positions[key];
    if (!pos || pos.amount <= 0) return { ok: false, error: '无持仓' };
    return sellTokens(live.chain, live.address, pos.amount * r);
  }

  function sellTokens(chain, address, tokenAmount, opts) {
    ensureDayAnchor();
    const amount = Number(tokenAmount);
    if (!Number.isFinite(amount) || amount <= 0) return { ok: false, error: '数量无效' };
    const q = assertTradeableQuote();
    if (!q.ok) return q;
    if (!addrEquals(address, live.address) || chain !== live.chain) {
      return { ok: false, error: '请打开该代币页后再卖出' };
    }

    const key = posKey(chain, address);
    const pos = state.positions[key];
    if (!pos || pos.amount <= 0) return { ok: false, error: '无持仓' };

    const sellAmt = Math.min(amount, pos.amount);
    const midPrice = live.price;
    const execPrice = applySlippage(midPrice, 'sell');
    const gross = sellAmt * execPrice;
    const fee = applyFee(gross);
    const proceeds = gross - fee;
    const realized = proceeds - sellAmt * pos.avgCostUsdt;

    pos.amount -= sellAmt;
    if (pos.amount <= 1e-12) delete state.positions[key];
    else {
      pos.lastPrice = midPrice;
      pos.lastPriceAt = Date.now();
    }

    state.cashUsdt += proceeds;
    state.realizedPnl = (state.realizedPnl || 0) + realized;
    pushTrade({
      side: 'sell',
      chain,
      address,
      symbol: (pos && pos.symbol) || live.symbol,
      price: execPrice,
      midPrice,
      amount: sellAmt,
      notional: proceeds,
      fee,
      realizedPnl: realized,
      note: (opts && opts.note) || '',
      quoteSource: live.source,
    });
    saveState();
    return { ok: true, realized, sold: sellAmt, execPrice };
  }

  function placeLimitSell(targetPrice, ratioPct) {
    ensureDayAnchor();
    if (!live.chain || !live.address) return { ok: false, error: '请打开 token 详情页' };
    const tp = Number(targetPrice);
    const pct = Number(ratioPct);
    if (!Number.isFinite(tp) || tp <= 0) return { ok: false, error: '目标价无效' };
    if (!Number.isFinite(pct) || pct <= 0 || pct > 100) return { ok: false, error: '卖出比例 1–100' };
    const key = posKey(live.chain, live.address);
    const pos = state.positions[key];
    if (!pos || pos.amount <= 0) return { ok: false, error: '无持仓，无法挂限价卖' };

    const amount = pos.amount * (pct / 100);
    if (!Array.isArray(state.orders)) state.orders = [];
    state.orders.unshift({
      id: `L${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      side: 'sell',
      type: 'limit',
      chain: live.chain,
      address: live.address,
      symbol: pos.symbol || live.symbol,
      targetPrice: tp,
      amount,
      ratioPct: pct,
      createdAt: Date.now(),
      status: 'open',
    });
    if (state.orders.length > 50) state.orders.length = 50;
    saveState();
    // Immediate trigger if already at/above target
    checkLimitOrders();
    return { ok: true };
  }

  function cancelLimitOrder(id) {
    if (!Array.isArray(state.orders)) return;
    const o = state.orders.find((x) => x.id === id);
    if (!o || o.status !== 'open') return;
    o.status = 'cancelled';
    saveState();
  }

  function checkLimitOrders() {
    if (!Array.isArray(state.orders) || !state.orders.length) return;
    if (live.price == null || live.price <= 0) return;
    let changed = false;
    state.orders.forEach((o) => {
      if (!o || o.status !== 'open' || o.side !== 'sell') return;
      if (!live.chain || !live.address) return;
      if (o.chain !== live.chain || !addrEquals(o.address, live.address)) return;
      if (live.price + 1e-18 < o.targetPrice) return;
      const res = sellTokens(o.chain, o.address, o.amount, { note: 'limit' });
      if (res.ok) {
        o.status = 'filled';
        o.filledAt = Date.now();
        o.filledPrice = live.price;
        changed = true;
      }
    });
    if (changed) {
      saveState();
      scheduleRender(true);
    }
  }

  function pushTrade(t) {
    state.trades.unshift({
      id: `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      ts: Date.now(),
      ...t,
    });
    if (state.trades.length > 200) state.trades.length = 200;
  }

  function resetAccount() {
    const start = Number(state.settings.startCash) || DEFAULT_START_CASH;
    state.cashUsdt = start;
    state.realizedPnl = 0;
    state.positions = {};
    state.trades = [];
    state.orders = [];
    state.dayAnchor = startOfDay();
    state.dayStartEquity = start;
    saveState();
  }

  // ---------------------------------------------------------------------------
  // UI
  // ---------------------------------------------------------------------------

  function fmt(n, digits = 2) {
    if (n == null || !Number.isFinite(n)) return '—';
    const abs = Math.abs(n);
    if (abs >= 1e9) return (n / 1e9).toFixed(2) + 'B';
    if (abs >= 1e6) return (n / 1e6).toFixed(2) + 'M';
    if (abs >= 1e3) return (n / 1e3).toFixed(2) + 'K';
    if (abs >= 1) return n.toFixed(digits);
    if (abs >= 0.0001) return n.toFixed(6);
    return n.toExponential(2);
  }

  function fmtPct(n) {
    if (n == null || !Number.isFinite(n)) return '—';
    return (n > 0 ? '+' : '') + (n * 100).toFixed(2) + '%';
  }

  function pnlClass(n) {
    if (n > 0) return 'gpt-up';
    if (n < 0) return 'gpt-down';
    return '';
  }

  function escapeHtml(s) {
    return String(s ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function escapeAttr(s) {
    return escapeHtml(s).replace(/'/g, '&#39;');
  }

  function injectStyles() {
    const STYLE_VER = '1.4.0';
    const css = `
#${PANEL_ID} {
  position: fixed !important;
  z-index: 2147483646 !important;
  right: 12px;
  top: 72px;
  width: 300px;
  max-height: calc(100vh - 84px);
  overflow: auto;
  font-family: "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif !important;
  font-size: 13px !important;
  line-height: 1.35 !important;
  color: #ffffff !important;
  background: #111827 !important;
  border: 2px solid #f59e0b !important;
  border-radius: 12px !important;
  box-shadow: 0 12px 36px rgba(0,0,0,.6) !important;
  -webkit-font-smoothing: antialiased !important;
}
#${PANEL_ID}, #${PANEL_ID} * { box-sizing: border-box !important; }
#${PANEL_ID} .gpt-head {
  display: flex !important; align-items: center !important; justify-content: space-between !important; gap: 6px !important;
  padding: 8px 10px !important; cursor: move !important;
  background: #b45309 !important; border-bottom: 1px solid #92400e !important;
  position: sticky !important; top: 0 !important; z-index: 2 !important;
  user-select: none !important;
}
#${PANEL_ID} .gpt-badge {
  display: inline-block !important; font-size: 11px !important;
  padding: 2px 6px !important; border-radius: 4px !important; background: #111827 !important; color: #fde68a !important; font-weight: 800 !important;
}
#${PANEL_ID} .gpt-title { font-weight: 800 !important; font-size: 14px !important; color: #fffbeb !important; }
#${PANEL_ID} .gpt-head-actions { display: flex !important; gap: 4px !important; }
#${PANEL_ID} .gpt-icon-btn {
  border: 0 !important; background: #78350f !important; color: #fffbeb !important; width: 26px !important; height: 26px !important;
  border-radius: 7px !important; cursor: pointer !important; font-size: 14px !important; font-weight: 700 !important;
}
#${PANEL_ID} .gpt-body { padding: 8px 10px 10px !important; color: #ffffff !important; }
#${PANEL_ID} .gpt-row {
  display: flex !important; justify-content: space-between !important; align-items: center !important;
  margin: 3px 0 !important; gap: 8px !important; font-size: 12.5px !important; color: #ffffff !important;
}
#${PANEL_ID} .gpt-row > span:last-child { font-weight: 700 !important; color: #ffffff !important; text-align: right !important; }
#${PANEL_ID} .gpt-muted { color: #d1d5db !important; font-weight: 500 !important; }
#${PANEL_ID} .gpt-up { color: #4ade80 !important; font-weight: 800 !important; }
#${PANEL_ID} .gpt-down { color: #f87171 !important; font-weight: 800 !important; }
#${PANEL_ID} .gpt-card {
  background: #1f2937 !important; border: 1px solid #4b5563 !important;
  border-radius: 8px !important; padding: 8px !important; margin: 6px 0 !important;
}
#${PANEL_ID} .gpt-section-title {
  display: flex !important; align-items: center !important; justify-content: space-between !important;
  font-size: 12px !important; font-weight: 800 !important; color: #fbbf24 !important;
  margin-bottom: 4px !important; user-select: none !important;
}
#${PANEL_ID} .gpt-section-title.gpt-toggle { cursor: pointer !important; }
#${PANEL_ID} .gpt-chevron { color: #fcd34d !important; font-size: 11px !important; margin-left: 6px !important; }
#${PANEL_ID} .gpt-fold[hidden] { display: none !important; }
#${PANEL_ID} .gpt-token { font-size: 15px !important; font-weight: 800 !important; color: #ffffff !important; }
#${PANEL_ID} .gpt-chain {
  font-size: 11px !important; text-transform: uppercase !important; padding: 1px 6px !important;
  border-radius: 4px !important; background: #1d4ed8 !important; color: #eff6ff !important; font-weight: 700 !important;
}
#${PANEL_ID} .gpt-input {
  width: 100% !important; background: #030712 !important; border: 1.5px solid #6b7280 !important; color: #ffffff !important;
  border-radius: 7px !important; padding: 7px 9px !important; margin: 4px 0 !important;
  font: 600 13px/1.3 "Segoe UI", "Microsoft YaHei", sans-serif !important;
  outline: none !important; user-select: text !important; -webkit-user-select: text !important;
}
#${PANEL_ID} .gpt-input:focus { border-color: #f59e0b !important; box-shadow: 0 0 0 2px rgba(245,158,11,.35) !important; }
#${PANEL_ID} .gpt-input::placeholder { color: #9ca3af !important; }
#${PANEL_ID} .gpt-btns { display: grid !important; grid-template-columns: repeat(4, 1fr) !important; gap: 5px !important; margin: 5px 0 !important; }
#${PANEL_ID} .gpt-btn {
  border: 0 !important; border-radius: 7px !important; padding: 7px 4px !important; cursor: pointer !important;
  font: 800 12px/1.15 "Segoe UI", "Microsoft YaHei", sans-serif !important;
}
#${PANEL_ID} .gpt-btn:disabled { opacity: .4 !important; cursor: not-allowed !important; }
#${PANEL_ID} .gpt-buy { background: #22c55e !important; color: #052e16 !important; }
#${PANEL_ID} .gpt-sell { background: #ef4444 !important; color: #ffffff !important; }
#${PANEL_ID} .gpt-ghost { background: #374151 !important; color: #f9fafb !important; }
#${PANEL_ID} .gpt-actions { display: grid !important; grid-template-columns: 1fr 1fr !important; gap: 5px !important; margin-top: 5px !important; }
#${PANEL_ID} .gpt-actions .gpt-btn { padding: 8px 4px !important; }
#${PANEL_ID} .gpt-list { max-height: 110px !important; overflow: auto !important; margin-top: 4px !important; }
#${PANEL_ID} .gpt-item {
  display: flex !important; justify-content: space-between !important; gap: 6px !important;
  padding: 5px 0 !important; border-bottom: 1px solid #374151 !important; cursor: pointer !important;
  color: #ffffff !important; font-size: 12px !important;
}
#${PANEL_ID} .gpt-item strong { color: #ffffff !important; font-size: 12.5px !important; }
#${PANEL_ID} .gpt-msg { min-height: 16px !important; margin-top: 4px !important; color: #fbbf24 !important; font-size: 12px !important; font-weight: 700 !important; }
#${PANEL_ID} .gpt-settings { display: grid !important; grid-template-columns: 1fr 1fr !important; gap: 6px !important; margin-top: 4px !important; }
#${PANEL_ID} .gpt-settings label {
  display: flex !important; flex-direction: column !important; gap: 2px !important;
  color: #e5e7eb !important; font-size: 12px !important; font-weight: 700 !important;
}
#${PANEL_ID} .gpt-settings .gpt-btn { align-self: end !important; min-height: 36px !important; }
#${PANEL_ID}.gpt-collapsed .gpt-body { display: none !important; }
#${PANEL_ID}.gpt-hidden { display: none !important; }
#${PANEL_ID} .gpt-watermark {
  text-align: center !important; font-size: 11px !important; color: #9ca3af !important; margin-top: 6px !important;
  font-weight: 700 !important;
}
#${PANEL_ID} .gpt-src { font-size: 11px !important; color: #9ca3af !important; font-weight: 600 !important; }
#${PANEL_ID} .gpt-pnl-pct { font-size: 15px !important; font-weight: 900 !important; letter-spacing: .02em !important; }
#${PANEL_ID} .gpt-live { font-weight: 800 !important; }
#${FAB_ID} {
  position: fixed !important; z-index: 2147483647 !important;
  right: 14px; bottom: 18px;
  width: 54px; height: 54px; border-radius: 50%;
  border: 2px solid #fde68a !important; background: #d97706 !important; color: #fff !important;
  font-weight: 900 !important; font-size: 12px !important; line-height: 1.1 !important;
  box-shadow: 0 8px 22px rgba(0,0,0,.45) !important; cursor: pointer !important;
  font-family: "Segoe UI", "Microsoft YaHei", sans-serif !important;
}
#${FAB_ID}:hover { filter: brightness(1.1); }
`;
    let s = document.getElementById('gmgn-paper-trade-style');
    if (!s) {
      s = document.createElement('style');
      s.id = 'gmgn-paper-trade-style';
      (document.head || document.documentElement).appendChild(s);
    }
    if (s.getAttribute('data-ver') !== STYLE_VER) {
      s.setAttribute('data-ver', STYLE_VER);
      s.textContent = css;
    }
  }

  function mountTarget() {
    return document.body || document.documentElement;
  }

  function ensureFab() {
    let fab = document.getElementById(FAB_ID);
    if (fab) return fab;
    fab = document.createElement('button');
    fab.id = FAB_ID;
    fab.type = 'button';
    fab.title = '显示/隐藏模拟交易面板 (Alt+P)';
    fab.innerHTML = '模拟<br>交易';
    fab.addEventListener('click', () => {
      state.ui.hidden = !state.ui.hidden;
      saveState();
      scheduleRender();
    });
    mountTarget().appendChild(fab);
    return fab;
  }

  function ensurePanel() {
    let root = document.getElementById(PANEL_ID);
    if (root) return root;
    root = document.createElement('div');
    root.id = PANEL_ID;
    root.setAttribute('data-gpt', '1');
    root.innerHTML = `
      <div class="gpt-head" data-drag="1">
        <div>
          <span class="gpt-badge">模拟</span>
          <span class="gpt-title"> Paper Trade</span>
        </div>
        <div class="gpt-head-actions">
          <button type="button" class="gpt-icon-btn" data-act="collapse" title="折叠">–</button>
          <button type="button" class="gpt-icon-btn" data-act="hide" title="隐藏 (Alt+P)">×</button>
          <button type="button" class="gpt-icon-btn" data-act="reset" title="重置账户">↺</button>
        </div>
      </div>
      <div class="gpt-body"></div>
    `;
    mountTarget().appendChild(root);

    if (state.ui.left != null && state.ui.top != null) {
      const left = Math.min(Math.max(0, state.ui.left), window.innerWidth - 80);
      const top = Math.min(Math.max(0, state.ui.top), window.innerHeight - 80);
      root.style.left = left + 'px';
      root.style.top = top + 'px';
      root.style.right = 'auto';
    }

    const head = root.querySelector('.gpt-head');
    head.addEventListener('mousedown', (e) => {
      if (e.target.closest('[data-act]')) return;
      dragging = true;
      const rect = root.getBoundingClientRect();
      dragOffset.x = e.clientX - rect.left;
      dragOffset.y = e.clientY - rect.top;
      e.preventDefault();
    });
    window.addEventListener('mousemove', (e) => {
      if (!dragging) return;
      const left = Math.max(0, Math.min(window.innerWidth - 40, e.clientX - dragOffset.x));
      const top = Math.max(0, Math.min(window.innerHeight - 40, e.clientY - dragOffset.y));
      root.style.left = left + 'px';
      root.style.top = top + 'px';
      root.style.right = 'auto';
      state.ui.left = left;
      state.ui.top = top;
    });
    window.addEventListener('mouseup', () => {
      if (!dragging) return;
      dragging = false;
      saveState();
    });

    root.addEventListener('click', onPanelClick);
    root.addEventListener('input', onPanelInput);
    root.addEventListener('change', onPanelInput);
    LOG('panel mounted');
    return root;
  }

  function onHotkey(e) {
    if (e.altKey && (e.key === 'p' || e.key === 'P')) {
      e.preventDefault();
      state.ui.hidden = !state.ui.hidden;
      if (!state.ui.hidden) state.ui.collapsed = false;
      saveState();
      scheduleRender();
    }
  }

  function applySettingsFromInputs(root) {
    if (!root) return false;
    const slipEl = root.querySelector('[data-field="slippageBps"]');
    const feeEl = root.querySelector('[data-field="feeBps"]');
    const startEl = root.querySelector('[data-field="startCash"]');
    const buyPctEl = root.querySelector('[data-field="buyPcts"]');
    const sellPctEl = root.querySelector('[data-field="sellPcts"]');
    let changed = false;
    if (slipEl) {
      const slip = Number(slipEl.value);
      if (Number.isFinite(slip) && slip >= 0 && slip !== state.settings.slippageBps) {
        state.settings.slippageBps = Math.round(slip);
        changed = true;
      }
    }
    if (feeEl) {
      const fee = Number(feeEl.value);
      if (Number.isFinite(fee) && fee >= 0 && fee !== state.settings.feeBps) {
        state.settings.feeBps = Math.round(fee);
        changed = true;
      }
    }
    if (startEl) {
      const start = Number(startEl.value);
      if (Number.isFinite(start) && start > 0 && start !== state.settings.startCash) {
        state.settings.startCash = start;
        changed = true;
      }
    }
    if (buyPctEl) {
      const next = normalizePctList(buyPctEl.value);
      if (JSON.stringify(next) !== JSON.stringify(state.settings.buyPcts)) {
        state.settings.buyPcts = next;
        changed = true;
      }
    }
    if (sellPctEl) {
      const next = normalizePctList(sellPctEl.value);
      if (JSON.stringify(next) !== JSON.stringify(state.settings.sellPcts)) {
        state.settings.sellPcts = next;
        changed = true;
      }
    }
    if (changed) saveState();
    return changed;
  }

  function onPanelInput(e) {
    const field = e.target && e.target.getAttribute && e.target.getAttribute('data-field');
    if (!field) return;
    if (
      field === 'slippageBps' ||
      field === 'feeBps' ||
      field === 'startCash' ||
      field === 'buyPcts' ||
      field === 'sellPcts'
    ) {
      const root = document.getElementById(PANEL_ID) || e.currentTarget;
      const changed = applySettingsFromInputs(root);
      const msgEl = document.querySelector(`#${PANEL_ID} .gpt-msg-settings`);
      if (msgEl) msgEl.textContent = '设置已自动保存';
      if (changed && (field === 'buyPcts' || field === 'sellPcts')) scheduleRender(true);
    }
  }

  function onPanelClick(e) {
    const actEl = e.target.closest('[data-act]');
    if (!actEl) {
      const item = e.target.closest('[data-pos-key]');
      if (item) {
        const key = item.getAttribute('data-pos-key');
        const pos = state.positions[key];
        if (pos) location.href = `https://gmgn.ai/${pos.chain}/token/${pos.address}`;
      }
      return;
    }
    const act = actEl.getAttribute('data-act');
    const msg = (text) => {
      const el = document.querySelector(`#${PANEL_ID} .gpt-msg`);
      if (el) el.textContent = text || '';
    };

    if (act === 'collapse') {
      const root = document.getElementById(PANEL_ID);
      root.classList.toggle('gpt-collapsed');
      state.ui.collapsed = root.classList.contains('gpt-collapsed');
      saveState();
      return;
    }
    if (act === 'toggle-section') {
      const key = actEl.getAttribute('data-section');
      if (!state.ui.sections) state.ui.sections = {};
      state.ui.sections[key] = !state.ui.sections[key];
      saveState();
      scheduleRender(true);
      return;
    }
    if (act === 'hide') {
      state.ui.hidden = true;
      saveState();
      scheduleRender();
      return;
    }
    if (act === 'reset') {
      if (confirm('重置模拟账户？持仓、挂单与成交记录将清空。')) {
        resetAccount();
        msg('已重置为 ' + fmt(state.settings.startCash) + ' USDT');
        scheduleRender(true);
      }
      return;
    }
    if (act === 'buy-pct') {
      const pct = Number(actEl.getAttribute('data-pct'));
      const input = document.querySelector(`#${PANEL_ID} [data-field="buyAmount"]`);
      if (input) input.value = String(+(state.cashUsdt * pct).toFixed(4));
      return;
    }
    if (act === 'buy') {
      const input = document.querySelector(`#${PANEL_ID} [data-field="buyAmount"]`);
      const res = buy(input ? Number(input.value) : 0);
      msg(
        res.ok
          ? `买入成功 @ $${fmt(res.execPrice, 8)}（中间价 $${fmt(res.midPrice, 8)}）`
          : res.error
      );
      scheduleRender(true);
      return;
    }
    if (act === 'sell-pct') {
      const pct = Number(actEl.getAttribute('data-pct'));
      const res = sell(pct);
      msg(res.ok ? `卖出成功 已实现 ${res.realized >= 0 ? '+' : ''}${fmt(res.realized)}` : res.error);
      scheduleRender(true);
      return;
    }
    if (act === 'limit-sell') {
      const priceEl = document.querySelector(`#${PANEL_ID} [data-field="limitPrice"]`);
      const ratioEl = document.querySelector(`#${PANEL_ID} [data-field="limitRatio"]`);
      const res = placeLimitSell(priceEl ? priceEl.value : 0, ratioEl ? ratioEl.value : 100);
      msg(res.ok ? `限价卖出单已挂出` : res.error);
      scheduleRender(true);
      return;
    }
    if (act === 'cancel-limit') {
      cancelLimitOrder(actEl.getAttribute('data-id'));
      msg('已取消挂单');
      scheduleRender(true);
      return;
    }
    if (act === 'save-settings') {
      applySettingsFromInputs(document.getElementById(PANEL_ID));
      const tip = document.querySelector(`#${PANEL_ID} .gpt-msg-settings`);
      if (tip) tip.textContent = '设置已保存';
      msg('设置已保存');
      scheduleRender(true);
    }
  }

  function snapshotFields(body) {
    const snap = {};
    body.querySelectorAll('[data-field]').forEach((el) => {
      const k = el.getAttribute('data-field');
      if (k) snap[k] = el.value;
    });
    return snap;
  }

  function restoreFields(body, snap) {
    if (!snap) return;
    Object.keys(snap).forEach((k) => {
      const el = body.querySelector(`[data-field="${k}"]`);
      if (el && snap[k] !== undefined) el.value = snap[k];
    });
  }

  function isEditingPanel() {
    const ae = document.activeElement;
    if (!ae) return false;
    const root = document.getElementById(PANEL_ID);
    if (!root || !root.contains(ae)) return false;
    const tag = (ae.tagName || '').toLowerCase();
    return tag === 'input' || tag === 'textarea' || ae.isContentEditable;
  }

  function patchLiveNumbers(body) {
    ensureDayAnchor();
    const equity = calcEquity();
    const dayPnl = equity - (state.dayStartEquity || equity);
    const pos = currentPosition();
    const markPx = pos ? markPriceForPos(posKey(live.chain, live.address), pos) : null;
    const posValue = pos && markPx != null ? pos.amount * markPx : null;
    const posCost = pos ? pos.amount * pos.avgCostUsdt : null;
    const upnl = posValue != null && posCost != null ? posValue - posCost : null;
    const upnlPct = posCost ? upnl / posCost : null;
    const quoteOk = isTrustedSource(live.source) && live.price != null && quoteAgeMs() <= QUOTE_MAX_AGE_MS;

    const set = (key, text, cls) => {
      const el = body.querySelector(`[data-live="${key}"]`);
      if (!el) return;
      el.textContent = text;
      if (cls !== undefined) {
        el.className = cls;
      }
    };

    set('cash', fmt(state.cashUsdt));
    set('equity', fmt(equity) + ' USDT');
    set('dayPnl', (dayPnl >= 0 ? '+' : '') + fmt(dayPnl), 'gpt-live ' + pnlClass(dayPnl));
    set('symbol', live.address && live.chain ? live.symbol : '战壕');
    set('price', live.price != null ? '$' + fmt(live.price, 8) : '读取中…');
    set('mcap', live.mcap != null ? '$' + fmt(live.mcap) : '—');
    set('posAmt', pos ? fmt(pos.amount, 4) : '0');
    set('avgCost', pos ? '$' + fmt(pos.avgCostUsdt, 8) : '—');
    set('upnl', upnl == null ? '—' : (upnl >= 0 ? '+' : '') + fmt(upnl), 'gpt-live ' + pnlClass(upnl));
    set('upnlPct', upnlPct == null ? '—' : fmtPct(upnlPct), 'gpt-pnl-pct ' + pnlClass(upnlPct));
    const srcMap = { 'gmgn-api': 'GMGN', dex: 'Dex', dom: '页面' };
    const age = live.updatedAt ? Math.round(quoteAgeMs() / 100) / 10 + 's' : '—';
    const ready = quoteOk ? '可交易' : '等待可靠报价';
    set(
      'src',
      live.source
        ? `报价源: ${srcMap[live.source] || live.source} · ${age} · ${ready}`
        : '报价源: …'
    );

    const openN = (state.orders || []).filter((o) => o.status === 'open').length;
    set('openOrders', String(openN));

    // Keep trade controls in sync without full re-render
    body.querySelectorAll('[data-act="buy"]').forEach((el) => {
      el.disabled = !quoteOk;
    });
    body.querySelectorAll('[data-act="sell-pct"]').forEach((el) => {
      el.disabled = !(quoteOk && pos);
    });
    body.querySelectorAll('[data-act="limit-sell"]').forEach((el) => {
      el.disabled = !(quoteOk && pos);
    });
    const msgEl = body.querySelector('.gpt-msg');
    if (msgEl && !quoteOk) {
      if (!msgEl.textContent || msgEl.textContent.indexOf('等待') === 0 || msgEl.textContent === '') {
        msgEl.textContent = '等待 GMGN/Dex 可靠报价后再交易…';
      }
    } else if (msgEl && quoteOk && msgEl.textContent.indexOf('等待 GMGN/Dex') === 0) {
      msgEl.textContent = '';
    }
  }

  function scheduleRender(forceFull) {
    if (renderQueued) return;
    renderQueued = true;
    requestAnimationFrame(() => {
      renderQueued = false;
      try {
        const body = document.querySelector(`#${PANEL_ID} .gpt-body`);
        if (!forceFull && body && body.querySelector('[data-live="price"]')) {
          const route = parseRoute(location.pathname);
          if (route.chain) live.chain = route.chain;
          if (route.address) live.address = route.address;
          patchLiveNumbers(body);
          return;
        }
        renderPanel(!!forceFull);
      } catch (err) {
        console.error('[GMGN Paper Trade] render error', err);
        showBeacon('GMGN 渲染出错: ' + (err && err.message ? err.message : err));
      }
    });
  }

  function renderPanel(forceFull) {
    if (!mountTarget()) return;
    ensureDayAnchor();
    injectStyles();
    ensureFab();
    const root = ensurePanel();
    root.classList.toggle('gpt-hidden', !!state.ui.hidden);
    root.classList.toggle('gpt-collapsed', !!state.ui.collapsed);

    const body = root.querySelector('.gpt-body');
    if (!body || state.ui.hidden) return;

    if (!forceFull && isEditingPanel() && body.querySelector('[data-live="price"]')) {
      const route = parseRoute(location.pathname);
      if (route.chain) live.chain = route.chain;
      if (route.address) live.address = route.address;
      patchLiveNumbers(body);
      return;
    }

    const fieldSnap = snapshotFields(body);
    const prevMsg = body.querySelector('.gpt-msg');
    const prevMsgText = prevMsg ? prevMsg.textContent : '';
    const prevSettingsMsg = body.querySelector('.gpt-msg-settings');
    const prevSettingsMsgText = prevSettingsMsg ? prevSettingsMsg.textContent : '';
    const activeField = document.activeElement && document.activeElement.getAttribute
      ? document.activeElement.getAttribute('data-field')
      : null;
    const selStart = document.activeElement && document.activeElement.selectionStart;
    const selEnd = document.activeElement && document.activeElement.selectionEnd;

    const route = parseRoute(location.pathname);
    if (route.chain) live.chain = route.chain;
    if (route.address) live.address = route.address;
    const onToken = !!(live.address && live.chain);
    const equity = calcEquity();
    const dayPnl = equity - (state.dayStartEquity || equity);
    const pos = currentPosition();
    const markPx = pos ? markPriceForPos(posKey(live.chain, live.address), pos) : null;
    const posValue = pos && markPx != null ? pos.amount * markPx : null;
    const posCost = pos ? pos.amount * pos.avgCostUsdt : null;
    const upnl = posValue != null && posCost != null ? posValue - posCost : null;
    const upnlPct = posCost ? upnl / posCost : null;
    const quoteOk = isTrustedSource(live.source) && live.price != null && quoteAgeMs() <= QUOTE_MAX_AGE_MS;

    const buyPcts = normalizePctList(state.settings.buyPcts);
    const sellPcts = normalizePctList(state.settings.sellPcts);

    const posRows = Object.entries(state.positions)
      .map(([key, p]) => {
        const px = markPriceForPos(key, p);
        const val = px != null ? p.amount * px : p.amount * p.avgCostUsdt;
        const cost = p.amount * p.avgCostUsdt;
        const pnl = val - cost;
        const pct = cost ? pnl / cost : null;
        const stale = !isCurrentPos(key) && (!p.lastPriceAt || Date.now() - p.lastPriceAt > 60000);
        return `<div class="gpt-item" data-pos-key="${escapeAttr(key)}">
          <div>
            <div><strong>${escapeHtml(p.symbol)}</strong> <span class="gpt-chain">${escapeHtml(p.chain)}</span></div>
            <div class="gpt-muted">${shortAddr(p.address)}${stale ? ' · 价待刷新' : ''}</div>
          </div>
          <div style="text-align:right">
            <div class="${pnlClass(pnl)}">${fmt(val)} <span class="gpt-pnl-pct">${pct == null ? '' : fmtPct(pct)}</span></div>
            <div class="gpt-muted">${fmt(p.amount, 4)} tok · 成本 $${fmt(p.avgCostUsdt, 8)}</div>
          </div>
        </div>`;
      })
      .join('');

    const tradeRows = state.trades
      .slice(0, 12)
      .map((t) => {
        const sideCls = t.side === 'buy' ? 'gpt-up' : 'gpt-down';
        const note = t.note === 'limit' ? '限价' : '';
        return `<div class="gpt-item" style="cursor:default">
          <div>
            <span class="${sideCls}">${t.side.toUpperCase()}</span>
            ${escapeHtml(t.symbol)}
            <span class="gpt-muted">${escapeHtml(t.chain)} ${note}</span>
          </div>
          <div style="text-align:right">
            <div>${fmt(t.notional)}</div>
            <div class="gpt-muted">${new Date(t.ts).toLocaleTimeString()}</div>
          </div>
        </div>`;
      })
      .join('');

    const openOrders = (state.orders || []).filter((o) => o.status === 'open');
    const orderRows = openOrders
      .map((o) => {
        return `<div class="gpt-item" style="cursor:default">
          <div>
            <div><strong>${escapeHtml(o.symbol)}</strong> <span class="gpt-chain">${escapeHtml(o.chain)}</span></div>
            <div class="gpt-muted">≥ $${fmt(o.targetPrice, 8)} · ${o.ratioPct}%</div>
          </div>
          <div style="text-align:right">
            <button type="button" class="gpt-btn gpt-ghost" data-act="cancel-limit" data-id="${escapeAttr(o.id)}" style="padding:4px 8px;font-size:11px">取消</button>
          </div>
        </div>`;
      })
      .join('');

    const buyBtns = buyPcts
      .map((p) => {
        const label = p >= 100 ? '全仓' : p + '%';
        return `<button type="button" class="gpt-btn gpt-ghost" data-act="buy-pct" data-pct="${p / 100}">${label}</button>`;
      })
      .join('');
    const sellBtns = sellPcts
      .map((p) => {
        const label = p >= 100 ? '清仓' : '卖' + p + '%';
        return `<button type="button" class="gpt-btn gpt-sell" data-act="sell-pct" data-pct="${p / 100}" ${pos && quoteOk ? '' : 'disabled'}>${label}</button>`;
      })
      .join('');

    const sec = state.ui.sections || { positions: false, trades: false, settings: false, limits: false };
    const chev = (open) => (open ? '▾' : '▸');
    const posCount = Object.keys(state.positions).length;
    const srcMap = { 'gmgn-api': 'GMGN', dex: 'Dex', dom: '页面' };
    const age = live.updatedAt ? Math.round(quoteAgeMs() / 100) / 10 + 's' : '—';
    const ready = quoteOk ? '可交易' : '等待可靠报价';
    const srcLabel = live.source
      ? `${srcMap[live.source] || live.source} · ${age} · ${ready}`
      : '…';
    const tradeDisabled = onToken && !quoteOk ? 'disabled' : '';
    const defaultLimitPrice =
      fieldSnap.limitPrice ||
      (live.price != null ? String(+(live.price * 1.1).toPrecision(6)) : '');
    const defaultLimitRatio = fieldSnap.limitRatio || '100';

    body.innerHTML = `
      <div class="gpt-card">
        <div class="gpt-row" style="margin:0">
          <span class="gpt-muted">权益</span>
          <span data-live="equity">${fmt(equity)} USDT</span>
        </div>
        <div class="gpt-row">
          <span class="gpt-muted">现金 / 今日</span>
          <span><span data-live="cash">${fmt(state.cashUsdt)}</span>
          · <span data-live="dayPnl" class="${pnlClass(dayPnl)}">${dayPnl >= 0 ? '+' : ''}${fmt(dayPnl)}</span></span>
        </div>
      </div>

      <div class="gpt-card">
        <div class="gpt-row" style="margin-top:0">
          <span class="gpt-token" data-live="symbol">${escapeHtml(onToken ? live.symbol : '战壕')}</span>
          ${live.chain ? `<span class="gpt-chain">${escapeHtml(live.chain)}</span>` : ''}
        </div>
        <div class="gpt-row"><span class="gpt-muted">价格</span><span data-live="price">${live.price != null ? '$' + fmt(live.price, 8) : '读取中…'}</span></div>
        <div class="gpt-row"><span class="gpt-muted">市值</span><span data-live="mcap">${live.mcap != null ? '$' + fmt(live.mcap) : '—'}</span></div>
        <div class="gpt-row"><span class="gpt-muted">持仓</span><span data-live="posAmt">${pos ? fmt(pos.amount, 4) : '0'}</span></div>
        <div class="gpt-row"><span class="gpt-muted">成本价</span><span data-live="avgCost">${pos ? '$' + fmt(pos.avgCostUsdt, 8) : '—'}</span></div>
        <div class="gpt-row"><span class="gpt-muted">浮盈</span><span data-live="upnl" class="${pnlClass(upnl)}">${upnl == null ? '—' : (upnl >= 0 ? '+' : '') + fmt(upnl)}</span></div>
        <div class="gpt-row"><span class="gpt-muted">盈亏%</span><span data-live="upnlPct" class="gpt-pnl-pct ${pnlClass(upnlPct)}">${upnlPct == null ? '—' : fmtPct(upnlPct)}</span></div>
        <div class="gpt-src" data-live="src">报价源: ${escapeHtml(srcLabel)}</div>
      </div>

      ${
        onToken
          ? `
      <div class="gpt-card">
        <input class="gpt-input" data-field="buyAmount" type="number" min="0" step="any" placeholder="买入 USDT 金额" />
        <div class="gpt-btns" style="grid-template-columns: repeat(${Math.min(buyPcts.length + 1, 4)}, 1fr)">
          ${buyBtns}
          <button type="button" class="gpt-btn gpt-buy" data-act="buy" ${tradeDisabled}>买</button>
        </div>
        <div class="gpt-actions" style="grid-template-columns: repeat(${Math.min(sellPcts.length, 4)}, 1fr)">
          ${sellBtns}
        </div>
        <div class="gpt-muted" style="margin-top:8px">限价卖出（现价 ≥ 目标价触发）</div>
        <div class="gpt-settings">
          <label>目标价 $
            <input class="gpt-input" data-field="limitPrice" type="number" min="0" step="any" value="${escapeAttr(defaultLimitPrice)}" placeholder="目标价" />
          </label>
          <label>卖出 %
            <input class="gpt-input" data-field="limitRatio" type="number" min="1" max="100" step="1" value="${escapeAttr(defaultLimitRatio)}" />
          </label>
        </div>
        <button type="button" class="gpt-btn gpt-sell" data-act="limit-sell" style="width:100%;margin-top:4px" ${pos && quoteOk ? '' : 'disabled'}>挂限价卖单</button>
        <div class="gpt-msg">${quoteOk ? '' : '等待 GMGN/Dex 可靠报价后再交易…'}</div>
      </div>`
          : `<div class="gpt-card gpt-muted">打开 token 页可买卖 · Alt+P</div>`
      }

      <div class="gpt-card">
        <div class="gpt-section-title gpt-toggle" data-act="toggle-section" data-section="limits">
          <span>挂单 (<span data-live="openOrders">${openOrders.length}</span>)</span><span class="gpt-chevron">${chev(!!sec.limits)}</span>
        </div>
        <div class="gpt-fold" ${sec.limits ? '' : 'hidden'}>
          <div class="gpt-list">${orderRows || '<div class="gpt-muted">暂无挂单</div>'}</div>
        </div>
      </div>

      <div class="gpt-card">
        <div class="gpt-section-title gpt-toggle" data-act="toggle-section" data-section="positions">
          <span>持仓 (${posCount})</span><span class="gpt-chevron">${chev(!!sec.positions)}</span>
        </div>
        <div class="gpt-fold" ${sec.positions ? '' : 'hidden'}>
          <div class="gpt-list">${posRows || '<div class="gpt-muted">暂无持仓</div>'}</div>
        </div>
      </div>

      <div class="gpt-card">
        <div class="gpt-section-title gpt-toggle" data-act="toggle-section" data-section="trades">
          <span>成交</span><span class="gpt-chevron">${chev(!!sec.trades)}</span>
        </div>
        <div class="gpt-fold" ${sec.trades ? '' : 'hidden'}>
          <div class="gpt-list">${tradeRows || '<div class="gpt-muted">暂无成交</div>'}</div>
        </div>
      </div>

      <div class="gpt-card">
        <div class="gpt-section-title gpt-toggle" data-act="toggle-section" data-section="settings">
          <span>设置</span><span class="gpt-chevron">${chev(!!sec.settings)}</span>
        </div>
        <div class="gpt-fold" ${sec.settings ? '' : 'hidden'}>
          <div class="gpt-settings">
            <label>滑点 bps<input class="gpt-input" data-field="slippageBps" type="number" min="0" step="1" value="${state.settings.slippageBps}" /></label>
            <label>手续费 bps<input class="gpt-input" data-field="feeBps" type="number" min="0" step="1" value="${state.settings.feeBps}" /></label>
            <label>初始资金<input class="gpt-input" data-field="startCash" type="number" min="1" step="1" value="${state.settings.startCash}" /></label>
            <label>买入快捷%<input class="gpt-input" data-field="buyPcts" type="text" value="${escapeAttr(buyPcts.join(','))}" placeholder="25,50,100" /></label>
            <label>卖出快捷%<input class="gpt-input" data-field="sellPcts" type="text" value="${escapeAttr(sellPcts.join(','))}" placeholder="25,50,100" /></label>
            <button type="button" class="gpt-btn gpt-ghost" data-act="save-settings">保存</button>
          </div>
          <div class="gpt-msg-settings gpt-muted" style="margin-top:6px">快捷%用逗号分隔，如 10,25,50,100</div>
        </div>
      </div>
      <div class="gpt-watermark">PAPER · Alt+P · v1.5.0</div>
    `;

    restoreFields(body, fieldSnap);
    if (!fieldSnap.slippageBps) {
      const el = body.querySelector('[data-field="slippageBps"]');
      if (el) el.value = String(state.settings.slippageBps);
    }
    if (!fieldSnap.feeBps) {
      const el = body.querySelector('[data-field="feeBps"]');
      if (el) el.value = String(state.settings.feeBps);
    }
    if (!fieldSnap.startCash) {
      const el = body.querySelector('[data-field="startCash"]');
      if (el) el.value = String(state.settings.startCash);
    }
    if (!fieldSnap.buyPcts) {
      const el = body.querySelector('[data-field="buyPcts"]');
      if (el) el.value = buyPcts.join(',');
    }
    if (!fieldSnap.sellPcts) {
      const el = body.querySelector('[data-field="sellPcts"]');
      if (el) el.value = sellPcts.join(',');
    }

    const msgEl = body.querySelector('.gpt-msg');
    if (msgEl && prevMsgText) msgEl.textContent = prevMsgText;
    const sMsg = body.querySelector('.gpt-msg-settings');
    if (sMsg && prevSettingsMsgText) sMsg.textContent = prevSettingsMsgText;

    if (activeField) {
      const el = body.querySelector(`[data-field="${activeField}"]`);
      if (el && typeof el.focus === 'function') {
        el.focus();
        if (typeof selStart === 'number' && typeof el.setSelectionRange === 'function') {
          try {
            el.setSelectionRange(selStart, selEnd);
          } catch (_) {
            /* ignore */
          }
        }
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Boot
  // ---------------------------------------------------------------------------

  function bootUi() {
    bootTries += 1;
    if (!mountTarget()) {
      if (bootTries < 40) setTimeout(bootUi, 250);
      return;
    }
    injectStyles();
    ensureFab();
    ensurePanel();
    // Force visible on first successful boot if previously somehow marked hidden without FAB awareness
    if (state.ui.hidden && bootTries === 1) {
      // keep user preference
    }
    onRouteMaybeChanged();
    scrapeDomPrice();
    scheduleRender();

    if (!window.__gptPriceTimer) {
      window.__gptPriceTimer = setInterval(() => {
        scrapeDomPrice();
        scheduleRender();
      }, PRICE_POLL_MS);
    }

    if (!window.__gptMo) {
      window.__gptMo = new MutationObserver(() => {
        if (window.__gptMo._scheduled) return;
        window.__gptMo._scheduled = true;
        setTimeout(() => {
          window.__gptMo._scheduled = false;
          if (!document.getElementById(PANEL_ID) || !document.getElementById(FAB_ID)) {
            ensureFab();
            ensurePanel();
          }
          scrapeDomPrice();
        }, 180);
      });
      window.__gptMo.observe(document.documentElement, { childList: true, subtree: true });
    }

    LOG('UI ready', parseRoute(location.pathname));
  }

  function scheduleBoot() {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', bootUi);
    } else {
      bootUi();
    }
    // Retry in case GMGN replaces body after load
    setTimeout(bootUi, 800);
    setTimeout(bootUi, 2000);
    setTimeout(bootUi, 5000);
  }
})();
