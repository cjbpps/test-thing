/*
 * PaperFlip site adapter — Padre (padre.gg)
 *
 * Multi-chain terminal, same ambiguous-EVM-chain caveat as the BullX
 * adapter (see comment there) since chain can't be reliably inferred from
 * a bare 0x address. Price resolves via the shared DexScreener API.
 */

(function () {
  "use strict";

  const EVM_ADDR_RE = /\b0x[a-fA-F0-9]{40}\b/;
  const SOLANA_ADDR_RE = /\b[1-9A-HJ-NP-Za-km-z]{32,44}\b/;

  function findTokenAddress() {
    const haystack = `${location.pathname} ${location.search}`;
    const evm = haystack.match(EVM_ADDR_RE);
    if (evm) return { tokenAddress: evm[0], chain: "ethereum" }; // ambiguous EVM chain
    const sol = haystack.match(SOLANA_ADDR_RE);
    if (sol) return { tokenAddress: sol[0], chain: "solana" };
    return null;
  }

  function guessSymbolFromDom() {
    const el = document.querySelector("h1, [class*='symbol' i], [class*='ticker' i]");
    const text = el?.textContent?.trim().replace(/^\$/, "");
    return text && text.length <= 15 ? text : null;
  }

  async function resolve() {
    const found = findTokenAddress();
    if (!found) return null;

    const info = await PaperFlipPriceApi.getTokenPrice(found.tokenAddress);
    if (!info || !info.priceUsd) return null;

    return {
      tokenAddress: found.tokenAddress,
      tokenSymbol: guessSymbolFromDom() || info.symbol || "UNKNOWN",
      chain: info.chain || found.chain,
      priceUsd: info.priceUsd,
      site: "padre",
      pairUrl: info.pairUrl,
    };
  }

  function findChartContainer() {
    return document.querySelector("[class*='chart' i] canvas")?.closest("div") || null;
  }

  window.PaperFlipAdapter = { site: "padre", resolve, findChartContainer };
})();
