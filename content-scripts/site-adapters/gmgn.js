/*
 * PaperFlip site adapter — GMGN (gmgn.ai)
 *
 * GMGN token pages are URL-shaped as /{chainSlug}/token/{address}, e.g.
 * gmgn.ai/sol/token/<mint> or gmgn.ai/eth/token/<contract>. We parse that
 * directly for the chain + token address (reliable, since it's just the
 * URL), then fall back to the shared DexScreener API for price since GMGN's
 * own DOM is a heavily-obfuscated React app not safe to hard-code selectors
 * against — this only attempts a best-effort text scrape first and
 * degrades to the API immediately if it doesn't find anything.
 */

(function () {
  "use strict";

  const CHAIN_SLUG_MAP = { sol: "solana", eth: "ethereum", bsc: "bnb", base: "base" };

  function parseTokenFromUrl() {
    const parts = location.pathname.split("/").filter(Boolean);
    const tokenIdx = parts.indexOf("token");
    if (tokenIdx === -1 || !parts[tokenIdx + 1]) return null;
    const chainSlug = parts[0];
    const tokenAddress = parts[tokenIdx + 1];
    return { chain: CHAIN_SLUG_MAP[chainSlug] || "solana", tokenAddress };
  }

  /**
   * Best-effort DOM price scrape. GMGN's class names are generated/hashed
   * and change across deploys, so this looks for a plausible "$0.00xxxx"
   * price string near the top of the page instead of a specific selector.
   * Returns null (and lets the caller fall back to the API) far more often
   * than it succeeds — that's expected and fine.
   */
  function scrapePriceFromDom() {
    try {
      const candidates = document.querySelectorAll("[class*='price' i], [data-testid*='price' i]");
      for (const node of candidates) {
        const text = node.textContent?.trim();
        const match = text?.match(/\$([0-9][0-9,]*\.?[0-9]*)/);
        if (match) {
          const value = parseFloat(match[1].replace(/,/g, ""));
          if (value > 0) return value;
        }
      }
    } catch (err) {
      // DOM shape changed — ignore and let the API fallback handle it.
    }
    return null;
  }

  async function resolve() {
    const parsed = parseTokenFromUrl();
    if (!parsed) return null;

    const domPrice = scrapePriceFromDom();
    if (domPrice) {
      return { tokenAddress: parsed.tokenAddress, tokenSymbol: guessSymbolFromDom() || "UNKNOWN", chain: parsed.chain, priceUsd: domPrice, site: "gmgn" };
    }

    const info = await PaperFlipPriceApi.getTokenPrice(parsed.tokenAddress);
    if (!info || !info.priceUsd) return null;
    return { tokenAddress: parsed.tokenAddress, tokenSymbol: info.symbol || "UNKNOWN", chain: parsed.chain, priceUsd: info.priceUsd, site: "gmgn", pairUrl: info.pairUrl };
  }

  function guessSymbolFromDom() {
    const el = document.querySelector("h1, [class*='symbol' i]");
    const text = el?.textContent?.trim();
    return text && text.length <= 15 ? text.replace(/^\$/, "") : null;
  }

  function findChartContainer() {
    return document.querySelector("[class*='kline' i], [class*='chart' i] canvas")?.closest("div") || null;
  }

  window.PaperFlipAdapter = { site: "gmgn", resolve, findChartContainer };
})();
