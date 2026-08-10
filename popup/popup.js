/*
 * PaperFlip — popup/popup.js
 * Quick-glance surface: balance, total PnL, open positions with live PnL,
 * a quick-buy shortcut for whatever token the active tab is on, and links
 * out to the full Stats page. Kept deliberately light so it opens instantly.
 */

const PRICE_REFRESH_MS = 10000;
let refreshTimer = null;
let resetArmed = false;

const el = {
  balance: document.getElementById("balance"),
  totalPnl: document.getElementById("total-pnl"),
  totalPnlPct: document.getElementById("total-pnl-pct"),
  positionsList: document.getElementById("positions-list"),
  positionsEmpty: document.getElementById("positions-empty"),
  positionsCount: document.getElementById("positions-count"),
  quickTrade: document.getElementById("quick-trade"),
  quickSymbol: document.getElementById("quick-symbol"),
  quickPrice: document.getElementById("quick-price"),
  quickAmount: document.getElementById("quick-amount"),
  quickBuy: document.getElementById("quick-buy"),
  viewStats: document.getElementById("view-stats"),
  resetBalance: document.getElementById("reset-balance"),
};

function formatUsd(n) {
  const v = Number(n) || 0;
  const sign = v < 0 ? "-" : "";
  return `${sign}$${Math.abs(v).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function formatPct(n) {
  const v = Number(n) || 0;
  return `${v >= 0 ? "+" : ""}${v.toFixed(2)}%`;
}

function pnlClass(n) {
  return (Number(n) || 0) >= 0 ? "pf-positive" : "pf-negative";
}

async function render() {
  const [trades, settings] = await Promise.all([PaperFlipStorage.getTrades(), PaperFlipStorage.getSettings()]);
  el.balance.textContent = formatUsd(settings.currentBalance);

  const realized = PaperFlipStats.totalRealizedPnl(trades);
  const open = trades.filter((t) => t.status === "open");

  let unrealizedUsd = 0;
  let livePrices = new Map();
  if (open.length) {
    try {
      livePrices = await PaperFlipPriceApi.getTokenPrices(open.map((t) => t.tokenAddress));
    } catch (err) {
      // Price fetch failed (offline, rate-limited) — still render entry data.
    }
    for (const t of open) {
      const info = livePrices.get(t.tokenAddress);
      if (info?.priceUsd) unrealizedUsd += t.amountTokens * info.priceUsd - t.amountUsd;
    }
  }

  const totalPnlUsd = realized.usd + unrealizedUsd;
  const investedBasis = settings.startingBalance || 1;
  const totalPnlPct = (totalPnlUsd / investedBasis) * 100;

  el.totalPnl.textContent = formatUsd(totalPnlUsd);
  el.totalPnl.className = `pf-pnl ${pnlClass(totalPnlUsd)}`;
  el.totalPnlPct.textContent = formatPct(totalPnlPct);
  el.totalPnlPct.className = `pf-pnl-pct ${pnlClass(totalPnlPct)}`;

  el.positionsCount.textContent = String(open.length);
  renderPositions(open, livePrices);
}

function renderPositions(open, livePrices) {
  el.positionsList.querySelectorAll(".pf-position").forEach((n) => n.remove());
  el.positionsEmpty.hidden = open.length > 0;

  for (const t of open) {
    const info = livePrices.get(t.tokenAddress);
    const livePrice = info?.priceUsd || t.entryPrice;
    const unrealizedUsd = t.amountTokens * livePrice - t.amountUsd;
    const unrealizedPct = t.amountUsd ? (unrealizedUsd / t.amountUsd) * 100 : 0;

    const row = document.createElement("div");
    row.className = "pf-position";
    row.innerHTML = `
      <div class="pf-position-main">
        <div class="pf-position-token">
          <span class="pf-position-symbol">${escapeHtml(t.tokenSymbol)}</span>
          <span class="pf-position-site">${escapeHtml(t.site)}</span>
        </div>
        <div class="pf-position-prices">
          <span>Entry ${formatPriceSmall(t.entryPrice)}</span>
          <span>Now ${formatPriceSmall(livePrice)}</span>
        </div>
      </div>
      <div class="pf-position-side">
        <span class="pf-pnl-small ${pnlClass(unrealizedUsd)}">${formatUsd(unrealizedUsd)}</span>
        <span class="pf-pnl-pct-small ${pnlClass(unrealizedPct)}">${formatPct(unrealizedPct)}</span>
        <button class="pf-btn pf-btn-sell" data-trade-id="${t.id}">Sell</button>
      </div>
    `;
    row.querySelector(".pf-btn-sell").addEventListener("click", () => sellPosition(t.id, livePrice));
    el.positionsList.appendChild(row);
  }
}

function formatPriceSmall(n) {
  const v = Number(n) || 0;
  if (v === 0) return "$0";
  if (v < 0.01) return `$${v.toFixed(8).replace(/0+$/, "")}`;
  return `$${v.toFixed(4)}`;
}

function escapeHtml(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

async function sellPosition(tradeId, livePrice) {
  await PaperFlipStorage.closeTrade(tradeId, livePrice);
  await render();
}

async function handleResetBalance() {
  if (!resetArmed) {
    resetArmed = true;
    el.resetBalance.textContent = "Confirm reset?";
    el.resetBalance.classList.add("pf-btn-danger");
    setTimeout(() => {
      if (resetArmed) {
        resetArmed = false;
        el.resetBalance.textContent = "Reset Balance";
        el.resetBalance.classList.remove("pf-btn-danger");
      }
    }, 3000);
    return;
  }
  resetArmed = false;
  el.resetBalance.textContent = "Reset Balance";
  el.resetBalance.classList.remove("pf-btn-danger");
  await PaperFlipStorage.resetAccount();
  await render();
}

function openStatsPage() {
  chrome.tabs.create({ url: chrome.runtime.getURL("stats/stats.html") });
}

// --- Quick trade: ask the active tab's content script what token it's on ---

function queryActiveTabToken() {
  return new Promise((resolve) => {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      const tab = tabs[0];
      if (!tab?.id) return resolve(null);
      chrome.tabs.sendMessage(tab.id, { type: "PAPERFLIP_GET_CURRENT_TOKEN" }, (response) => {
        if (chrome.runtime.lastError) return resolve(null); // no content script on this tab
        resolve(response || null);
      });
    });
  });
}

async function setupQuickTrade() {
  const current = await queryActiveTabToken();
  if (!current?.tokenAddress || !current?.priceUsd) return;

  el.quickTrade.hidden = false;
  el.quickSymbol.textContent = current.tokenSymbol || "UNKNOWN";
  el.quickPrice.textContent = formatPriceSmall(current.priceUsd);

  el.quickBuy.addEventListener("click", async () => {
    const amountUsd = Number(el.quickAmount.value) || 0;
    if (amountUsd <= 0) return;
    el.quickBuy.disabled = true;
    try {
      await PaperFlipStorage.openTrade({
        tokenAddress: current.tokenAddress,
        tokenSymbol: current.tokenSymbol,
        chain: current.chain,
        site: current.site,
        entryPrice: current.priceUsd,
        amountUsd,
      });
      await render();
    } finally {
      el.quickBuy.disabled = false;
    }
  });
}

function startAutoRefresh() {
  if (refreshTimer) clearInterval(refreshTimer);
  refreshTimer = setInterval(render, PRICE_REFRESH_MS);
}

document.addEventListener("DOMContentLoaded", async () => {
  el.viewStats.addEventListener("click", openStatsPage);
  el.resetBalance.addEventListener("click", handleResetBalance);

  await render();
  setupQuickTrade();
  startAutoRefresh();
  PaperFlipStorage.subscribe(() => render());
});
