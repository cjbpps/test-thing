/*
 * PaperFlip — content-scripts/overlay.js
 *
 * Shared widget logic injected on every supported site. Relies on
 * `window.PaperFlipAdapter` (set by whichever site-adapters/*.js file the
 * manifest loaded before this one) to resolve the current page's token +
 * live price. Everything here is site-agnostic: the adapter is the only
 * thing that changes per site.
 *
 * 100% local simulation: "Buy"/"Sell" only ever write to
 * chrome.storage.local via lib/storage.js. No wallet is connected, no
 * transaction is ever signed or broadcast.
 */

(function () {
  "use strict";

  if (window.__paperflipOverlayInjected) return;
  window.__paperflipOverlayInjected = true;

  const adapter = window.PaperFlipAdapter;
  if (!adapter) return;

  const RESOLVE_RETRY_MS = 2000;
  const RESOLVE_MAX_ATTEMPTS = 20; // ~40s of retrying for SPA content to load
  const PRICE_REFRESH_MS = 8000;
  const POSITION_STORAGE_KEY = "paperflip-overlay-pos";

  let currentToken = null; // last resolved {tokenAddress, tokenSymbol, chain, priceUsd, site}
  let widgetEl = null;
  let minimized = false;
  let refreshTimer = null;
  let unsubscribeStorage = null;

  // ---------- boot ----------

  attemptResolve(0);
  watchForUrlChanges();

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type === "PAPERFLIP_GET_CURRENT_TOKEN") {
      sendResponse(currentToken);
      return true;
    }
    return false;
  });

  function watchForUrlChanges() {
    let lastHref = location.href;
    setInterval(() => {
      if (location.href !== lastHref) {
        lastHref = location.href;
        currentToken = null;
        attemptResolve(0);
      }
    }, 1500);
  }

  async function attemptResolve(attempt) {
    try {
      const resolved = await adapter.resolve();
      if (resolved) {
        currentToken = resolved;
        mountWidget();
        return;
      }
    } catch (err) {
      console.warn("[PaperFlip] adapter resolve failed:", err);
    }
    if (attempt < RESOLVE_MAX_ATTEMPTS) {
      setTimeout(() => attemptResolve(attempt + 1), RESOLVE_RETRY_MS);
    }
  }

  // ---------- widget lifecycle ----------

  function mountWidget() {
    if (!widgetEl) {
      widgetEl = buildWidgetShell();
      document.documentElement.appendChild(widgetEl);
      restorePosition();
      makeDraggable(widgetEl.querySelector(".pf-ov-header"));
      startPriceRefresh();
      unsubscribeStorage = PaperFlipStorage.subscribe((changes) => {
        if (changes.trades || changes.settings) renderWidget();
      });
    }
    renderWidget();
    renderChartMarkers();
  }

  function startPriceRefresh() {
    if (refreshTimer) clearInterval(refreshTimer);
    refreshTimer = setInterval(async () => {
      try {
        const resolved = await adapter.resolve();
        if (resolved) {
          currentToken = resolved;
          renderWidget();
        }
      } catch (err) {
        // Transient network/API hiccup — keep showing the last known price.
      }
    }, PRICE_REFRESH_MS);
  }

  // ---------- rendering ----------

  function buildWidgetShell() {
    const wrap = document.createElement("div");
    wrap.id = "paperflip-overlay-root";
    wrap.innerHTML = `
      <div class="pf-ov-widget">
        <div class="pf-ov-header">
          <span class="pf-ov-brand">PaperFlip</span>
          <span class="pf-ov-balance" id="pf-ov-balance">$0.00</span>
          <button class="pf-ov-min" id="pf-ov-min" title="Minimize">–</button>
        </div>
        <div class="pf-ov-body" id="pf-ov-body">
          <div class="pf-ov-token-row">
            <span class="pf-ov-symbol" id="pf-ov-symbol">—</span>
            <span class="pf-ov-price" id="pf-ov-price">$0.00</span>
          </div>
          <div class="pf-ov-positions" id="pf-ov-positions"></div>
          <div class="pf-ov-trade-row">
            <input type="number" id="pf-ov-amount" class="pf-ov-input" placeholder="Amount USD" min="0" step="1" value="100" />
            <button id="pf-ov-quickbuy" class="pf-ov-btn pf-ov-btn-ghost" title="Quick buy $50">$50</button>
          </div>
          <div class="pf-ov-tpsl-row">
            <input type="number" id="pf-ov-tp" class="pf-ov-input pf-ov-input-sm" placeholder="TP %" />
            <input type="number" id="pf-ov-sl" class="pf-ov-input pf-ov-input-sm" placeholder="SL %" />
          </div>
          <button id="pf-ov-buy" class="pf-ov-btn pf-ov-btn-buy">Buy (Paper)</button>
        </div>
      </div>
      <div class="pf-ov-toast-stack" id="pf-ov-toast-stack"></div>
    `;

    wrap.querySelector("#pf-ov-min").addEventListener("click", (e) => {
      e.stopPropagation();
      toggleMinimize();
    });
    wrap.querySelector("#pf-ov-buy").addEventListener("click", handleBuyClick);
    wrap.querySelector("#pf-ov-quickbuy").addEventListener("click", () => {
      wrap.querySelector("#pf-ov-amount").value = "50";
      handleBuyClick();
    });
    return wrap;
  }

  async function renderWidget() {
    if (!widgetEl || !currentToken) return;

    const settings = await PaperFlipStorage.getSettings();
    widgetEl.querySelector("#pf-ov-balance").textContent = formatUsd(settings.currentBalance);
    widgetEl.querySelector("#pf-ov-symbol").textContent = currentToken.tokenSymbol;
    widgetEl.querySelector("#pf-ov-price").textContent = formatPriceSmall(currentToken.priceUsd);

    if (settings.defaultTakeProfitPercent != null && !widgetEl.querySelector("#pf-ov-tp").value) {
      widgetEl.querySelector("#pf-ov-tp").value = settings.defaultTakeProfitPercent;
    }
    if (settings.defaultStopLossPercent != null && !widgetEl.querySelector("#pf-ov-sl").value) {
      widgetEl.querySelector("#pf-ov-sl").value = settings.defaultStopLossPercent;
    }

    const trades = await PaperFlipStorage.getTrades();
    const openForToken = trades.filter((t) => t.status === "open" && t.tokenAddress === currentToken.tokenAddress);
    const positionsEl = widgetEl.querySelector("#pf-ov-positions");
    positionsEl.innerHTML = "";

    for (const t of openForToken) {
      const pnlUsd = t.amountTokens * currentToken.priceUsd - t.amountUsd;
      const pnlPct = t.amountUsd ? (pnlUsd / t.amountUsd) * 100 : 0;
      const row = document.createElement("div");
      row.className = "pf-ov-position";
      row.innerHTML = `
        <span class="${pnlUsd >= 0 ? "pf-ov-positive" : "pf-ov-negative"}">${formatUsd(pnlUsd)} (${pnlPct >= 0 ? "+" : ""}${pnlPct.toFixed(1)}%)</span>
        <button class="pf-ov-btn pf-ov-btn-sell" data-id="${t.id}">Sell</button>
      `;
      row.querySelector(".pf-ov-btn-sell").addEventListener("click", () => handleSellClick(t.id));
      positionsEl.appendChild(row);
    }
  }

  function toggleMinimize() {
    minimized = !minimized;
    widgetEl.querySelector("#pf-ov-body").style.display = minimized ? "none" : "";
    widgetEl.querySelector("#pf-ov-min").textContent = minimized ? "+" : "–";
  }

  // ---------- actions ----------

  async function handleBuyClick() {
    if (!currentToken) return;
    const amountUsd = Number(widgetEl.querySelector("#pf-ov-amount").value) || 0;
    if (amountUsd <= 0) return;
    const tp = widgetEl.querySelector("#pf-ov-tp").value;
    const sl = widgetEl.querySelector("#pf-ov-sl").value;

    const settings = await PaperFlipStorage.getSettings();
    if (amountUsd > settings.currentBalance) {
      showToast(`Not enough virtual balance for ${formatUsd(amountUsd)}`, "error");
      return;
    }

    await PaperFlipStorage.openTrade({
      tokenAddress: currentToken.tokenAddress,
      tokenSymbol: currentToken.tokenSymbol,
      chain: currentToken.chain,
      site: currentToken.site,
      entryPrice: currentToken.priceUsd,
      amountUsd,
      takeProfitPercent: tp !== "" ? Number(tp) : null,
      stopLossPercent: sl !== "" ? Number(sl) : null,
    });

    showToast(`Bought ${formatUsd(amountUsd)} of ${currentToken.tokenSymbol} @ ${formatPriceSmall(currentToken.priceUsd)}`, "success");
    renderWidget();
    renderChartMarkers();
  }

  async function handleSellClick(tradeId) {
    if (!currentToken) return;
    const closed = await PaperFlipStorage.closeTrade(tradeId, currentToken.priceUsd);
    if (closed) {
      showToast(`Sold ${closed.tokenSymbol} — PnL ${formatUsd(closed.pnlUsd)} (${closed.pnlPercent >= 0 ? "+" : ""}${closed.pnlPercent.toFixed(1)}%)`, closed.pnlUsd >= 0 ? "success" : "error");
    }
    renderWidget();
    renderChartMarkers();
  }

  // ---------- best-effort chart markers ----------

  function renderChartMarkers() {
    // Plotting exact buy/sell points on the host site's price series would
    // require deep integration with each site's charting library (most are
    // canvas-based with no stable DOM hooks). Instead we dock a compact
    // "recent trades" strip to the chart container when we can find one —
    // useful context without pretending to be pixel-precise. If no chart
    // container is found, this quietly does nothing.
    try {
      const container = adapter.findChartContainer?.();
      if (!container) return;
      let strip = container.querySelector(":scope > #paperflip-chart-markers");
      if (!strip) {
        strip = document.createElement("div");
        strip.id = "paperflip-chart-markers";
        strip.className = "pf-ov-chart-markers";
        if (getComputedStyle(container).position === "static") {
          container.style.position = "relative";
        }
        container.appendChild(strip);
      }
      renderMarkerStrip(strip);
    } catch (err) {
      // Host chart DOM isn't scriptable the way we assumed — degrade silently.
    }
  }

  async function renderMarkerStrip(strip) {
    if (!currentToken) return;
    const trades = await PaperFlipStorage.getTrades();
    const relevant = trades
      .filter((t) => t.tokenAddress === currentToken.tokenAddress)
      .sort((a, b) => b.entryTimestamp - a.entryTimestamp)
      .slice(0, 5);

    strip.innerHTML = relevant
      .map((t) => `<span class="pf-ov-marker pf-ov-marker-${t.status === "open" ? "buy" : t.pnlUsd >= 0 ? "win" : "loss"}" title="${t.status === "open" ? "Open" : `Closed ${formatUsd(t.pnlUsd)}`}">${t.status === "open" ? "▲" : t.pnlUsd >= 0 ? "●" : "▼"}</span>`)
      .join("");
  }

  // ---------- drag + persistence ----------

  function makeDraggable(handle) {
    let dragging = false;
    let startX, startY, startLeft, startTop;

    handle.addEventListener("mousedown", (e) => {
      if (e.target.closest("#pf-ov-min")) return;
      dragging = true;
      const rect = widgetEl.querySelector(".pf-ov-widget").getBoundingClientRect();
      startX = e.clientX;
      startY = e.clientY;
      startLeft = rect.left;
      startTop = rect.top;
      e.preventDefault();
    });

    document.addEventListener("mousemove", (e) => {
      if (!dragging) return;
      const left = startLeft + (e.clientX - startX);
      const top = startTop + (e.clientY - startY);
      applyPosition(left, top);
    });

    document.addEventListener("mouseup", () => {
      if (!dragging) return;
      dragging = false;
      const rect = widgetEl.querySelector(".pf-ov-widget").getBoundingClientRect();
      try {
        localStorage.setItem(POSITION_STORAGE_KEY, JSON.stringify({ left: rect.left, top: rect.top }));
      } catch (err) {
        // localStorage unavailable (privacy mode etc.) — position just won't persist.
      }
    });
  }

  function applyPosition(left, top) {
    const el = widgetEl.querySelector(".pf-ov-widget");
    const maxLeft = window.innerWidth - el.offsetWidth - 8;
    const maxTop = window.innerHeight - el.offsetHeight - 8;
    el.style.left = `${Math.max(8, Math.min(left, maxLeft))}px`;
    el.style.top = `${Math.max(8, Math.min(top, maxTop))}px`;
    el.style.right = "auto";
  }

  function restorePosition() {
    try {
      const saved = JSON.parse(localStorage.getItem(POSITION_STORAGE_KEY) || "null");
      if (saved) applyPosition(saved.left, saved.top);
    } catch (err) {
      // No saved position yet — default CSS placement (top-right) applies.
    }
  }

  // ---------- toast ----------

  function showToast(message, kind) {
    const stack = widgetEl?.querySelector("#pf-ov-toast-stack");
    if (!stack) return;
    const toast = document.createElement("div");
    toast.className = `pf-ov-toast pf-ov-toast-${kind}`;
    toast.textContent = message;
    stack.appendChild(toast);
    setTimeout(() => toast.classList.add("pf-ov-toast-out"), 2600);
    setTimeout(() => toast.remove(), 3000);
  }

  // ---------- formatting ----------

  function formatUsd(n) {
    const v = Number(n) || 0;
    const sign = v < 0 ? "-" : "";
    return `${sign}$${Math.abs(v).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  }

  function formatPriceSmall(n) {
    const v = Number(n) || 0;
    if (v === 0) return "$0";
    if (v < 0.01) return `$${v.toFixed(8).replace(/0+$/, "")}`;
    return `$${v.toFixed(4)}`;
  }
})();
