/*
 * PaperFlip site adapter — Axiom (axiom.trade)
 *
 * Axiom is a Solana-only memecoin terminal. We don't hard-code its exact
 * URL/DOM structure (it's a fast-moving obfuscated React app, and hard-coded
 * selectors would silently break on the next deploy) — instead we scan the
 * URL for a Solana mint address, which token pages reliably embed
 * somewhere in the path or query string, and let the shared DexScreener
 * API resolve the actual price. If the address can't be found this
 * degrades to "no overlay on this page" rather than guessing wrong.
 */

(function () {
  "use strict";

  const SOLANA_ADDR_RE = /\b[1-9A-HJ-NP-Za-km-z]{32,44}\b/;

  function findTokenAddress() {
    const haystack = `${location.pathname} ${location.search}`;
    const match = haystack.match(SOLANA_ADDR_RE);
    return match ? match[0] : null;
  }

  function guessSymbolFromDom() {
    const el = document.querySelector("h1, [class*='symbol' i], [class*='ticker' i]");
    const text = el?.textContent?.trim().replace(/^\$/, "");
    return text && text.length <= 15 ? text : null;
  }

  async function resolve() {
    const tokenAddress = findTokenAddress();
    if (!tokenAddress) return null;

    const info = await PaperFlipPriceApi.getTokenPrice(tokenAddress);
    if (!info || !info.priceUsd) return null;

    return {
      tokenAddress,
      tokenSymbol: guessSymbolFromDom() || info.symbol || "UNKNOWN",
      chain: "solana",
      priceUsd: info.priceUsd,
      site: "axiom",
      pairUrl: info.pairUrl,
    };
  }

  function findChartContainer() {
    return document.querySelector("[class*='chart' i] canvas")?.closest("div") || null;
  }

  window.PaperFlipAdapter = { site: "axiom", resolve, findChartContainer };
})();
