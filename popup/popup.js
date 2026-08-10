/*
 * PaperFlip — popup/popup.js
 * Quick-glance surface: balance, total PnL, open positions with live PnL,
 * an insta-buy/quick-buy shortcut for whatever token the active tab is on,
 * a wallet manager, and a link out to the full Stats page. Kept
 * deliberately light so it opens instantly.
 */

const PRICE_REFRESH_MS = 8000;
let refreshTimer = null;
let currentToken = null; // last resolved token info from the active tab's content script
let solPriceUsd = null;

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
  quickInstabuy: document.getElementById("quick-instabuy"),
  quickInstabuyAmt: document.getElementById("quick-instabuy-amt"),
  viewStats: document.getElementById("view-stats"),
  walletToggle: document.getElementById("wallet-toggle"),
  walletPanel: document.getElementById("wallet-panel"),
  walletCurrent: document.getElementById("wallet-current"),
  walletSolSub: document.getElementById("wallet-sol-sub"),
  walletAmount: document.getElementById("wallet-amount"),
  walletUnit: document.getElementById("wallet-unit"),
  walletPreview: document.getElementById("wallet-preview"),
  walletApply: document.getElementById("wallet-apply"),
  walletQuickReset: document.getElementById("wallet-quick-reset"),
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

function formatPriceSmall(n) {
  const v = Number(n) || 0;
  if (v === 0) return "$0";
  if (v < 0.01) return `$${v.toFixed(8).replace(/0+$/, "")}`;
  return `$${v.toFixed(4)}`;
}

function escapeHtml(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

async function render() {
  const [trades, settings] = await Promise.all([PaperFlipStorage.getTrades(), PaperFlipStorage.getSettings()]);
  el.balance.textContent = formatUsd(settings.currentBalance);
  el.quickInstabuyAmt.textContent = formatUsd(settings.instaBuyAmountUsd);

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

  if (!el.walletPanel.hidden) renderWalletPanel(settings);
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

async function sellPosition(tradeId, livePrice) {
  await PaperFlipStorage.closeTrade(tradeId, livePrice);
  await render();
}

function openStatsPage() {
  chrome.tabs.create({ url: chrome.runtime.getURL("stats/stats.html") });
}

function openChartTab(token) {
  const url = token.pairUrl || `https://dexscreener.com/search?q=${encodeURIComponent(token.tokenAddress)}`;
  chrome.tabs.create({ url });
}

// --- Quick trade + Insta Buy: ask the active tab's content script what token it's on ---

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

async function executeQuickBuy(amountUsd) {
  if (!currentToken || !amountUsd || amountUsd <= 0) return;
  await PaperFlipStorage.openTrade({
    tokenAddress: currentToken.tokenAddress,
    tokenSymbol: currentToken.tokenSymbol,
    chain: currentToken.chain,
    site: currentToken.site,
    entryPrice: currentToken.priceUsd,
    amountUsd,
  });
  openChartTab(currentToken);
  await render();
}

async function setupQuickTrade() {
  currentToken = await queryActiveTabToken();
  if (!currentToken?.tokenAddress || !currentToken?.priceUsd) return;

  el.quickTrade.hidden = false;
  el.quickSymbol.textContent = currentToken.tokenSymbol || "UNKNOWN";
  el.quickPrice.textContent = formatPriceSmall(currentToken.priceUsd);

  el.quickBuy.addEventListener("click", async () => {
    const amountUsd = Number(el.quickAmount.value) || 0;
    el.quickBuy.disabled = true;
    try {
      await executeQuickBuy(amountUsd);
    } finally {
      el.quickBuy.disabled = false;
    }
  });

  el.quickInstabuy.addEventListener("click", async () => {
    el.quickInstabuy.disabled = true;
    try {
      const settings = await PaperFlipStorage.getSettings();
      await executeQuickBuy(settings.instaBuyAmountUsd);
    } finally {
      el.quickInstabuy.disabled = false;
    }
  });
}

// --- Wallet manager ---

async function getSolPriceUsd() {
  if (solPriceUsd) return solPriceUsd;
  try {
    const info = await PaperFlipPriceApi.getTokenPrice(PaperFlipPriceApi.SOL_MINT_ADDRESS);
    solPriceUsd = info?.priceUsd || null;
  } catch (err) {
    solPriceUsd = null;
  }
  return solPriceUsd;
}

async function renderWalletPanel(settings) {
  el.walletCurrent.textContent = formatUsd(settings.currentBalance);
  const price = await getSolPriceUsd();
  el.walletSolSub.textContent = price ? `≈ ${(settings.currentBalance / price).toFixed(3)} SOL @ ${formatUsd(price)}` : "SOL price unavailable — showing USD only";
  updateWalletPreview();
}

async function updateWalletPreview() {
  const amount = Number(el.walletAmount.value) || 0;
  if (!amount) {
    el.walletPreview.textContent = "";
    return;
  }
  const unit = el.walletUnit.value;
  if (unit === "sol") {
    const price = await getSolPriceUsd();
    el.walletPreview.textContent = price ? `≈ ${formatUsd(amount * price)}` : "SOL price unavailable — try USD instead";
  } else {
    const price = await getSolPriceUsd();
    el.walletPreview.textContent = price ? `≈ ${(amount / price).toFixed(3)} SOL` : "";
  }
}

async function resolveWalletUsdAmount() {
  const amount = Number(el.walletAmount.value) || 0;
  if (amount <= 0) return null;
  if (el.walletUnit.value === "usd") return amount;
  const price = await getSolPriceUsd();
  if (!price) return null;
  return amount * price;
}

/** Two-step confirm: first click arms the button, second click (within 3s) fires. */
function armButton(button, idleLabel, confirmLabel, onConfirm) {
  let armed = false;
  let timer = null;
  button.textContent = idleLabel;
  button.addEventListener("click", async () => {
    if (!armed) {
      armed = true;
      button.textContent = confirmLabel;
      button.classList.add("pf-btn-danger");
      timer = setTimeout(() => {
        armed = false;
        button.textContent = idleLabel;
        button.classList.remove("pf-btn-danger");
      }, 3000);
      return;
    }
    clearTimeout(timer);
    armed = false;
    button.textContent = idleLabel;
    button.classList.remove("pf-btn-danger");
    await onConfirm();
  });
}

function setupWalletPanel() {
  el.walletToggle.addEventListener("click", async () => {
    el.walletPanel.hidden = !el.walletPanel.hidden;
    if (!el.walletPanel.hidden) {
      const settings = await PaperFlipStorage.getSettings();
      renderWalletPanel(settings);
    }
  });

  el.walletAmount.addEventListener("input", updateWalletPreview);
  el.walletUnit.addEventListener("change", updateWalletPreview);

  armButton(el.walletApply, "Set Balance (resets history)", "Confirm — wipes trades?", async () => {
    const usd = await resolveWalletUsdAmount();
    if (usd == null) return;
    await PaperFlipStorage.resetAccount(usd);
    el.walletAmount.value = "";
    await render();
  });

  armButton(el.walletQuickReset, "Quick Reset (same balance)", "Confirm reset?", async () => {
    await PaperFlipStorage.resetAccount();
    await render();
  });
}

function startAutoRefresh() {
  if (refreshTimer) clearInterval(refreshTimer);
  refreshTimer = setInterval(render, PRICE_REFRESH_MS);
}

document.addEventListener("DOMContentLoaded", async () => {
  el.viewStats.addEventListener("click", openStatsPage);
  setupWalletPanel();

  await render();
  setupQuickTrade();
  startAutoRefresh();
  PaperFlipStorage.subscribe(() => render());
});
