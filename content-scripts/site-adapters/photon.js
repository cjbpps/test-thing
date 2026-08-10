/*
 * PaperFlip site adapter — Photon (photon-sol.tinyastro.io)
 *
 * Solana-only terminal (the "sol" in the domain isn't subtle). Same
 * approach as the Axiom adapter: scan the URL for a Solana mint address
 * rather than hard-coding this SPA's DOM structure, then resolve price via
 * the shared DexScreener API.
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
      site: "photon",
      pairUrl: info.pairUrl,
    };
  }

  function findChartContainer() {
    return document.querySelector("[class*='chart' i] canvas")?.closest("div") || null;
  }

  window.PaperFlipAdapter = { site: "photon", resolve, findChartContainer };
})();
