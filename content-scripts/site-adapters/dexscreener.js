/*
 * PaperFlip site adapter — Dexscreener (dexscreener.com)
 *
 * This is the reference adapter: dexscreener.com pair pages URL-encode
 * exactly what we need (`/{chainId}/{pairAddress}`), so we skip DOM
 * scraping entirely and hit DexScreener's own pair-lookup API for an
 * exact, reliable price. Every other adapter in this extension falls back
 * to the token-search endpoint in lib/price-api.js because it doesn't have
 * a precise pair id to work with — this one does.
 */

(function () {
  "use strict";

  function parsePairFromUrl() {
    // e.g. https://dexscreener.com/solana/58oqchx... or /ethereum/0xabc...
    const parts = location.pathname.split("/").filter(Boolean);
    if (parts.length < 2) return null;
    const [chainId, pairAddress] = parts;
    if (!chainId || !pairAddress) return null;
    return { chainId, pairAddress };
  }

  async function resolve() {
    const parsed = parsePairFromUrl();
    if (!parsed) return null;

    const info = await PaperFlipPriceApi.getPairPrice(parsed.chainId, parsed.pairAddress);
    if (!info || !info.priceUsd) return null;

    return {
      tokenAddress: info.tokenAddress,
      tokenSymbol: info.symbol || "UNKNOWN",
      chain: info.chain,
      priceUsd: info.priceUsd,
      site: "dexscreener",
      pairUrl: location.href, // we're already on the exact pair page
    };
  }

  function findChartContainer() {
    // Dexscreener's embedded TradingView-style chart. Best-effort selector —
    // if it doesn't match (site markup changed), the overlay simply skips
    // chart markers and still works as a floating trade panel.
    return document.querySelector("#pair-chart, .chart-container, iframe#dex-chart") || null;
  }

  window.PaperFlipAdapter = { site: "dexscreener", resolve, findChartContainer };
})();
