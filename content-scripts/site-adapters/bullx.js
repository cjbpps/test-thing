/*
 * PaperFlip site adapter — BullX (bullx.io)
 *
 * BullX trades both Solana and EVM-chain memecoins, so unlike the
 * Solana-only adapters we can't assume a chain — we detect it from which
 * address format shows up in the URL. EVM chain is ambiguous from the
 * address alone (Base/Ethereum/BNB all use the same 0x format); we default
 * to "ethereum" and this is a known best-effort limitation, documented
 * here rather than silently guessed. Price resolves via the shared
 * DexScreener API either way.
 */

(function () {
  "use strict";

  const EVM_ADDR_RE = /\b0x[a-fA-F0-9]{40}\b/;
  const SOLANA_ADDR_RE = /\b[1-9A-HJ-NP-Za-km-z]{32,44}\b/;

  function findTokenAddress() {
    const haystack = `${location.pathname} ${location.search}`;
    const evm = haystack.match(EVM_ADDR_RE);
    if (evm) return { tokenAddress: evm[0], chain: "ethereum" }; // ambiguous EVM chain, see note above
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
      site: "bullx",
      pairUrl: info.pairUrl,
    };
  }

  function findChartContainer() {
    return document.querySelector("[class*='chart' i] canvas")?.closest("div") || null;
  }

  window.PaperFlipAdapter = { site: "bullx", resolve, findChartContainer };
})();
