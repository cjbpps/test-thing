/*
 * PaperFlip — lib/price-api.js
 *
 * Thin wrapper around the public DexScreener API. This is the shared
 * fallback price source used by every site adapter when a site-specific
 * DOM scraper isn't available, and by background.js to poll open positions.
 * No API key, no auth, no wallet — just public market data.
 *
 * Docs (public, unauthenticated): https://docs.dexscreener.com/api/reference
 *   GET https://api.dexscreener.com/latest/dex/tokens/{addresses}
 *   addresses: comma-separated, up to 30 per request.
 *
 * Context handling: content scripts run inside the *host page's* origin, so
 * their fetch() calls can be constrained by that page's CSP (some trading
 * terminals lock down connect-src). The service worker and our own
 * extension pages (popup/stats) aren't subject to that, so this module
 * fetches directly there and relays through the background worker
 * (chrome.runtime.sendMessage) everywhere else. Callers always just call
 * getTokenPrice()/getTokenPrices() and don't need to know which path ran.
 */

(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory();
  } else {
    root.PaperFlipPriceApi = factory();
  }
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  const BASE_URL = "https://api.dexscreener.com/latest/dex/tokens/";
  const PAIRS_URL = "https://api.dexscreener.com/latest/dex/pairs/";
  const CACHE_TTL_MS = 8000; // avoid hammering the API when overlay + background both poll
  const MAX_ADDRESSES_PER_REQUEST = 30;
  const MSG_GET_PRICE = "PAPERFLIP_GET_TOKEN_PRICE";
  const MSG_GET_PRICES = "PAPERFLIP_GET_TOKEN_PRICES";
  const MSG_GET_PAIR_PRICE = "PAPERFLIP_GET_PAIR_PRICE";

  // DexScreener's chainId strings -> our internal chain enum.
  const CHAIN_ID_MAP = {
    solana: "solana",
    bsc: "bnb",
    base: "base",
    ethereum: "ethereum",
  };

  const isServiceWorker = typeof window === "undefined" && typeof importScripts === "function";
  const isExtensionPage = typeof location !== "undefined" && location.protocol === "chrome-extension:";
  const canFetchDirect = isServiceWorker || isExtensionPage || typeof chrome === "undefined";

  const cache = new Map(); // address(lowercased) -> {expires, data}

  function now() {
    return Date.now();
  }

  function normalizeChain(dexscreenerChainId) {
    return CHAIN_ID_MAP[dexscreenerChainId] || dexscreenerChainId || "solana";
  }

  /** Picks the most liquid pair for a token — the most representative price. */
  function pickBestPair(pairs) {
    if (!pairs || !pairs.length) return null;
    return pairs.reduce((best, p) => {
      const liq = Number(p?.liquidity?.usd) || 0;
      const bestLiq = Number(best?.liquidity?.usd) || 0;
      return liq > bestLiq ? p : best;
    }, pairs[0]);
  }

  function pairToPriceInfo(pair) {
    if (!pair) return null;
    return {
      tokenAddress: pair.baseToken?.address || "",
      symbol: pair.baseToken?.symbol || "",
      name: pair.baseToken?.name || "",
      chain: normalizeChain(pair.chainId),
      dexId: pair.dexId || "",
      priceUsd: Number(pair.priceUsd) || 0,
      priceChange24h: Number(pair?.priceChange?.h24) || 0,
      liquidityUsd: Number(pair?.liquidity?.usd) || 0,
      fdv: Number(pair.fdv) || 0,
      pairUrl: pair.url || "",
      updatedAt: now(),
    };
  }

  async function fetchJson(url, attempt = 0) {
    const res = await fetch(url, { headers: { Accept: "application/json" } });
    if (res.status === 429 && attempt < 3) {
      const backoffMs = 500 * Math.pow(2, attempt);
      await new Promise((resolve) => setTimeout(resolve, backoffMs));
      return fetchJson(url, attempt + 1);
    }
    if (!res.ok) throw new Error(`DexScreener API error ${res.status}`);
    return res.json();
  }

  async function directGetTokenPrice(tokenAddress) {
    if (!tokenAddress) return null;
    const key = tokenAddress.toLowerCase();
    const cached = cache.get(key);
    if (cached && cached.expires > now()) return cached.data;

    const json = await fetchJson(BASE_URL + encodeURIComponent(tokenAddress));
    const best = pickBestPair(json?.pairs);
    const info = pairToPriceInfo(best);

    cache.set(key, { expires: now() + CACHE_TTL_MS, data: info });
    return info;
  }

  async function directGetTokenPrices(tokenAddresses) {
    const unique = [...new Set((tokenAddresses || []).filter(Boolean))];
    const results = new Map();

    const uncached = [];
    for (const addr of unique) {
      const cached = cache.get(addr.toLowerCase());
      if (cached && cached.expires > now()) {
        results.set(addr, cached.data);
      } else {
        uncached.push(addr);
      }
    }

    for (let i = 0; i < uncached.length; i += MAX_ADDRESSES_PER_REQUEST) {
      const chunk = uncached.slice(i, i + MAX_ADDRESSES_PER_REQUEST);
      try {
        const json = await fetchJson(BASE_URL + chunk.map(encodeURIComponent).join(","));
        const pairsByAddress = new Map();
        for (const pair of json?.pairs || []) {
          const addr = (pair.baseToken?.address || "").toLowerCase();
          if (!addr) continue;
          const existing = pairsByAddress.get(addr);
          if (!existing || (Number(pair?.liquidity?.usd) || 0) > (Number(existing?.liquidity?.usd) || 0)) {
            pairsByAddress.set(addr, pair);
          }
        }
        for (const addr of chunk) {
          const pair = pairsByAddress.get(addr.toLowerCase());
          const info = pair ? pairToPriceInfo(pair) : null;
          cache.set(addr.toLowerCase(), { expires: now() + CACHE_TTL_MS, data: info });
          results.set(addr, info);
        }
      } catch (err) {
        for (const addr of chunk) results.set(addr, results.get(addr) ?? null);
      }
    }

    return results;
  }

  /**
   * Fetches the price for one specific pair (chainId + pairAddress), as
   * used by the Dexscreener adapter — the pair page's own URL already
   * gives us the exact chain + pair, so we skip the token-search endpoint
   * entirely and go straight to the precise pair lookup.
   */
  async function directGetPairPrice(chainId, pairAddress) {
    if (!chainId || !pairAddress) return null;
    const key = `pair:${chainId}:${pairAddress}`.toLowerCase();
    const cached = cache.get(key);
    if (cached && cached.expires > now()) return cached.data;

    const json = await fetchJson(`${PAIRS_URL}${encodeURIComponent(chainId)}/${encodeURIComponent(pairAddress)}`);
    const pair = (json?.pairs || [])[0] || null;
    const info = pairToPriceInfo(pair);

    cache.set(key, { expires: now() + CACHE_TTL_MS, data: info });
    return info;
  }

  function sendMessageAsync(message) {
    return new Promise((resolve, reject) => {
      chrome.runtime.sendMessage(message, (response) => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
          return;
        }
        resolve(response);
      });
    });
  }

  /**
   * Fetches live price info for a single token address. Returns null if the
   * token has no known trading pairs (e.g. brand-new/unindexed token).
   */
  async function getTokenPrice(tokenAddress) {
    if (canFetchDirect) return directGetTokenPrice(tokenAddress);
    return sendMessageAsync({ type: MSG_GET_PRICE, tokenAddress });
  }

  /**
   * Batch-fetches prices for multiple token addresses (chunked to stay under
   * DexScreener's per-request address limit). Returns a Map keyed by the
   * original address string (not lowercased) -> priceInfo | null.
   */
  async function getTokenPrices(tokenAddresses) {
    if (canFetchDirect) return directGetTokenPrices(tokenAddresses);
    const entries = await sendMessageAsync({ type: MSG_GET_PRICES, tokenAddresses });
    return new Map(entries || []);
  }

  /** Fetches the price for one specific pair given its chainId + pairAddress. */
  async function getPairPrice(chainId, pairAddress) {
    if (canFetchDirect) return directGetPairPrice(chainId, pairAddress);
    return sendMessageAsync({ type: MSG_GET_PAIR_PRICE, chainId, pairAddress });
  }

  /**
   * Registers the runtime.onMessage relay. Call this once from background.js
   * so content-script callers (which can't always fetch cross-origin
   * directly) get served by the service worker's fetch.
   */
  function registerBackgroundRelay() {
    if (typeof chrome === "undefined" || !chrome.runtime?.onMessage) return;
    chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
      if (message?.type === MSG_GET_PRICE) {
        directGetTokenPrice(message.tokenAddress).then(sendResponse).catch(() => sendResponse(null));
        return true;
      }
      if (message?.type === MSG_GET_PRICES) {
        directGetTokenPrices(message.tokenAddresses)
          .then((map) => sendResponse([...map.entries()]))
          .catch(() => sendResponse([]));
        return true;
      }
      if (message?.type === MSG_GET_PAIR_PRICE) {
        directGetPairPrice(message.chainId, message.pairAddress)
          .then(sendResponse)
          .catch(() => sendResponse(null));
        return true;
      }
      return false;
    });
  }

  function clearCache() {
    cache.clear();
  }

  return {
    getTokenPrice,
    getTokenPrices,
    getPairPrice,
    pickBestPair,
    normalizeChain,
    clearCache,
    registerBackgroundRelay,
    canFetchDirect,
  };
});
