/*
 * PaperFlip — stats/stats.js
 * The full analytics dashboard: hero stats, summary cards, charts, and a
 * sortable/filterable trade history table. All numbers derive from
 * lib/stats-calculations.js so this file is purely about rendering.
 */

const SITE_LABELS = { axiom: "Axiom", gmgn: "GMGN", photon: "Photon", bullx: "BullX", padre: "Padre", dexscreener: "Dexscreener" };
const CHAIN_LABELS = { solana: "Solana", bnb: "BNB", base: "Base", ethereum: "Ethereum" };
const CHART_COLORS = { green: "#2ed573", red: "#ff4757", accent: "#58a6ff", yellow: "#f0c14b", dim: "#8b949e", grid: "#232b38" };

let allTrades = [];
let allSettings = null;
let livePrices = new Map(); // tokenAddress -> priceInfo, for open positions only
let sortState = { key: "entryTimestamp", dir: "desc" };
let filterState = { search: "", site: "", chain: "", status: "", day: null };
let expandedRowId = null;
let calendarMonth = new Date(new Date().getFullYear(), new Date().getMonth(), 1);
let selectedDay = null;
let solPriceUsd = null;
const charts = {};

const el = {
  hdrBalance: document.getElementById("hdr-balance"),
  devToggle: document.getElementById("dev-toggle"),
  devPanel: document.getElementById("dev-panel"),
  seedData: document.getElementById("seed-data"),
  clearData: document.getElementById("clear-data"),
  statWinrate: document.getElementById("stat-winrate"),
  statWinrateSub: document.getElementById("stat-winrate-sub"),
  statAvgHold: document.getElementById("stat-avghold"),
  statMedianHoldSub: document.getElementById("stat-medianhold-sub"),
  statPnl: document.getElementById("stat-pnl"),
  statPnlPct: document.getElementById("stat-pnl-pct"),
  statStreak: document.getElementById("stat-streak"),
  statStreakSub: document.getElementById("stat-streak-sub"),
  statTotalTrades: document.getElementById("stat-total-trades"),
  statOpenPositions: document.getElementById("stat-open-positions"),
  statBest: document.getElementById("stat-best"),
  statWorst: document.getElementById("stat-worst"),
  statProfitFactor: document.getElementById("stat-profit-factor"),
  statAvgWinLoss: document.getElementById("stat-avg-win-loss"),
  statWinLossRatio: document.getElementById("stat-win-loss-ratio"),
  statAvgPosition: document.getElementById("stat-avg-position"),
  statUnrealizedPnl: document.getElementById("stat-unrealized-pnl"),
  statUnrealizedPnlSub: document.getElementById("stat-unrealized-pnl-sub"),
  calPrev: document.getElementById("cal-prev"),
  calNext: document.getElementById("cal-next"),
  calMonthLabel: document.getElementById("cal-month-label"),
  calClearFilter: document.getElementById("cal-clear-filter"),
  calendarGrid: document.getElementById("calendar-grid"),
  walletOpen: document.getElementById("wallet-open"),
  walletModal: document.getElementById("wallet-modal"),
  walletClose: document.getElementById("wallet-close"),
  walletCurrentUsd: document.getElementById("wallet-current-usd"),
  walletCurrentSolSub: document.getElementById("wallet-current-sol-sub"),
  walletInputAmount: document.getElementById("wallet-input-amount"),
  walletInputUnit: document.getElementById("wallet-input-unit"),
  walletPreview: document.getElementById("wallet-preview"),
  walletApply: document.getElementById("wallet-apply"),
  walletInstabuyInput: document.getElementById("wallet-instabuy-input"),
  walletInstabuySave: document.getElementById("wallet-instabuy-save"),
  walletQuickReset: document.getElementById("wallet-quick-reset"),
  filterSearch: document.getElementById("filter-search"),
  filterSite: document.getElementById("filter-site"),
  filterChain: document.getElementById("filter-chain"),
  filterStatus: document.getElementById("filter-status"),
  tableCount: document.getElementById("table-count"),
  tbody: document.getElementById("trades-tbody"),
  tableEmpty: document.getElementById("table-empty"),
  table: document.getElementById("trades-table"),
};

// ---------- formatting helpers ----------

function formatUsd(n) {
  const v = Number(n) || 0;
  const sign = v < 0 ? "-" : "";
  return `${sign}$${Math.abs(v).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function formatPct(n) {
  if (n === Infinity) return "∞";
  const v = Number(n) || 0;
  return `${v >= 0 ? "+" : ""}${v.toFixed(2)}%`;
}

function formatPriceSmall(n) {
  const v = Number(n) || 0;
  if (v === 0) return "$0";
  if (v < 0.01) return `$${v.toFixed(8).replace(/0+$/, "")}`;
  return `$${v.toFixed(4)}`;
}

function formatDate(ts) {
  if (!ts) return "—";
  const d = new Date(ts);
  return d.toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

function pnlClass(n) {
  return (Number(n) || 0) >= 0 ? "pf-positive" : "pf-negative";
}

function escapeHtml(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

// ---------- data load + refresh ----------

async function loadData() {
  const [trades, settings] = await Promise.all([PaperFlipStorage.getTrades(), PaperFlipStorage.getSettings()]);
  allTrades = trades;
  allSettings = settings;
}

async function refresh() {
  await loadData();
  await loadLivePrices();
  renderHeader();
  renderCards();
  renderCharts();
  populateFilterOptions();
  renderTable();
  renderCalendar();
}

async function loadLivePrices() {
  const open = PaperFlipStats.getOpenTrades(allTrades);
  if (!open.length) {
    livePrices = new Map();
    return;
  }
  try {
    livePrices = await PaperFlipPriceApi.getTokenPrices(open.map((t) => t.tokenAddress));
  } catch (err) {
    // Price fetch failed (offline, rate-limited) — keep the previous prices
    // rather than blanking out the live PnL display.
  }
}

function livePriceFor(t) {
  return livePrices.get(t.tokenAddress)?.priceUsd || t.entryPrice;
}

function renderHeader() {
  el.hdrBalance.textContent = formatUsd(allSettings.currentBalance);
  el.devPanel.hidden = !allSettings.devMode;
}

// ---------- cards ----------

function renderCards() {
  const stats = PaperFlipStats.computeAllStats(allTrades);

  el.statWinrate.textContent = `${(stats.winRate.rate * 100).toFixed(1)}%`;
  el.statWinrateSub.textContent = `${stats.winRate.wins}W / ${stats.winRate.losses}L / ${stats.winRate.total} closed`;

  el.statAvgHold.textContent = stats.closedTradesCount ? stats.avgHoldTimeLabel : "—";
  el.statMedianHoldSub.textContent = stats.closedTradesCount ? `median ${stats.medianHoldTimeLabel}` : "no closed trades yet";

  el.statPnl.textContent = formatUsd(stats.totalRealizedPnl.usd);
  el.statPnl.className = `pf-hero-value ${pnlClass(stats.totalRealizedPnl.usd)}`;
  el.statPnlPct.textContent = formatPct(stats.totalRealizedPnl.percent);

  if (stats.currentStreak.type === "none") {
    el.statStreak.textContent = "—";
    el.statStreakSub.textContent = "no closed trades yet";
  } else {
    const label = stats.currentStreak.type === "win" ? "Win" : "Loss";
    el.statStreak.textContent = `${stats.currentStreak.count} ${label}${stats.currentStreak.count === 1 ? "" : "s"}`;
    el.statStreak.className = `pf-hero-value ${stats.currentStreak.type === "win" ? "pf-positive" : "pf-negative"}`;
    el.statStreakSub.textContent = stats.currentStreak.type === "win" ? "streak in the green" : "streak in the red";
  }

  el.statTotalTrades.textContent = String(stats.totalTradesCount);
  el.statOpenPositions.textContent = String(stats.openPositionsCount);

  el.statBest.textContent = stats.bestTrade ? `${stats.bestTrade.tokenSymbol} ${formatPct(stats.bestTrade.pnlPercent)}` : "—";
  el.statBest.className = `pf-value ${stats.bestTrade ? pnlClass(stats.bestTrade.pnlPercent) : ""}`;
  el.statWorst.textContent = stats.worstTrade ? `${stats.worstTrade.tokenSymbol} ${formatPct(stats.worstTrade.pnlPercent)}` : "—";
  el.statWorst.className = `pf-value ${stats.worstTrade ? pnlClass(stats.worstTrade.pnlPercent) : ""}`;

  el.statProfitFactor.textContent = stats.profitFactor === Infinity ? "∞" : stats.closedTradesCount ? stats.profitFactor.toFixed(2) : "—";
  el.statAvgWinLoss.textContent = stats.closedTradesCount
    ? `${formatUsd(stats.avgWinLoss.avgWin)} / ${formatUsd(stats.avgWinLoss.avgLoss)}`
    : "—";
  el.statWinLossRatio.textContent =
    stats.avgWinLoss.winLossRatio === Infinity ? "∞" : stats.closedTradesCount ? stats.avgWinLoss.winLossRatio.toFixed(2) : "—";
  el.statAvgPosition.textContent = allTrades.length ? formatUsd(stats.avgPositionSize) : "—";

  const open = PaperFlipStats.getOpenTrades(allTrades);
  const unrealizedUsd = open.reduce((sum, t) => sum + (t.amountTokens * livePriceFor(t) - t.amountUsd), 0);
  el.statUnrealizedPnl.textContent = open.length ? formatUsd(unrealizedUsd) : "—";
  el.statUnrealizedPnl.className = `pf-hero-value ${open.length ? pnlClass(unrealizedUsd) : ""}`;
  el.statUnrealizedPnlSub.textContent = `${open.length} open position${open.length === 1 ? "" : "s"}`;
}

// ---------- charts ----------

function baseChartOptions(overrides) {
  return Object.assign(
    {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { labels: { color: CHART_COLORS.dim, font: { size: 11 } } },
      },
    },
    overrides
  );
}

function renderCharts() {
  renderEquityChart();
  renderWinLossChart();
  renderHoldBucketChart();
  renderBreakdownChart("chart-site", PaperFlipStats.tradesBySite(allTrades), SITE_LABELS);
  renderBreakdownChart("chart-chain", PaperFlipStats.tradesByChain(allTrades), CHAIN_LABELS);
}

async function renderEquityChart() {
  const history = await PaperFlipStorage.getBalanceHistory();
  const points = history.length ? history : [{ timestamp: Date.now(), balance: allSettings.currentBalance }];
  const labels = points.map((p) => formatDate(p.timestamp));
  const data = points.map((p) => p.balance);
  const trendUp = data[data.length - 1] >= data[0];

  upsertChart("chart-equity", "line", {
    data: {
      labels,
      datasets: [
        {
          label: "Balance",
          data,
          borderColor: trendUp ? CHART_COLORS.green : CHART_COLORS.red,
          backgroundColor: trendUp ? "rgba(46,213,115,0.08)" : "rgba(255,71,87,0.08)",
          fill: true,
          tension: 0.25,
          pointRadius: 0,
          borderWidth: 2,
        },
      ],
    },
    options: baseChartOptions({
      plugins: { legend: { display: false } },
      scales: {
        x: { ticks: { color: CHART_COLORS.dim, maxTicksLimit: 8, font: { size: 10 } }, grid: { color: CHART_COLORS.grid } },
        y: { ticks: { color: CHART_COLORS.dim, font: { size: 10 } }, grid: { color: CHART_COLORS.grid } },
      },
    }),
  });
}

function renderWinLossChart() {
  const { wins, losses } = PaperFlipStats.winRate(allTrades);
  upsertChart("chart-winloss", "doughnut", {
    data: {
      labels: ["Wins", "Losses"],
      datasets: [{ data: [wins, losses], backgroundColor: [CHART_COLORS.green, CHART_COLORS.red], borderWidth: 0 }],
    },
    options: baseChartOptions({ cutout: "65%" }),
  });
}

function renderHoldBucketChart() {
  const buckets = PaperFlipStats.pnlByHoldBucket(allTrades);
  upsertChart("chart-holdbucket", "bar", {
    data: {
      labels: buckets.map((b) => b.label),
      datasets: [
        {
          label: "PnL ($)",
          data: buckets.map((b) => b.pnlUsd),
          backgroundColor: buckets.map((b) => (b.pnlUsd >= 0 ? CHART_COLORS.green : CHART_COLORS.red)),
          borderRadius: 4,
        },
      ],
    },
    options: baseChartOptions({
      plugins: { legend: { display: false } },
      scales: {
        x: { ticks: { color: CHART_COLORS.dim, font: { size: 10 } }, grid: { display: false } },
        y: { ticks: { color: CHART_COLORS.dim, font: { size: 10 } }, grid: { color: CHART_COLORS.grid } },
      },
    }),
  });
}

function renderBreakdownChart(canvasId, countsMap, labelMap) {
  const labels = Object.keys(countsMap);
  const data = labels.map((k) => countsMap[k]);
  const palette = [CHART_COLORS.accent, CHART_COLORS.green, CHART_COLORS.yellow, CHART_COLORS.red, "#a371f7", "#8b949e"];
  upsertChart(canvasId, "doughnut", {
    data: {
      labels: labels.map((k) => labelMap[k] || k),
      datasets: [{ data, backgroundColor: labels.map((_, i) => palette[i % palette.length]), borderWidth: 0 }],
    },
    options: baseChartOptions({ cutout: "60%", plugins: { legend: { labels: { color: CHART_COLORS.dim, font: { size: 10 }, boxWidth: 10 } } } }),
  });
}

function upsertChart(canvasId, type, config) {
  const ctx = document.getElementById(canvasId);
  if (!ctx) return;
  if (charts[canvasId]) {
    charts[canvasId].data = config.data;
    charts[canvasId].options = config.options;
    charts[canvasId].update();
    return;
  }
  charts[canvasId] = new Chart(ctx, { type, ...config });
}

// ---------- table ----------

function populateFilterOptions() {
  fillSelect(el.filterSite, [...new Set(allTrades.map((t) => t.site))].sort(), SITE_LABELS, "All sites");
  fillSelect(el.filterChain, [...new Set(allTrades.map((t) => t.chain))].sort(), CHAIN_LABELS, "All chains");
}

function fillSelect(selectEl, values, labelMap, allLabel) {
  const current = selectEl.value;
  selectEl.innerHTML = `<option value="">${allLabel}</option>`;
  for (const v of values) {
    const opt = document.createElement("option");
    opt.value = v;
    opt.textContent = labelMap[v] || v;
    selectEl.appendChild(opt);
  }
  if (values.includes(current)) selectEl.value = current;
}

function getFilteredSortedTrades() {
  const search = filterState.search.trim().toLowerCase();
  let rows = allTrades.filter((t) => {
    if (filterState.site && t.site !== filterState.site) return false;
    if (filterState.chain && t.chain !== filterState.chain) return false;
    if (filterState.status && t.status !== filterState.status) return false;
    if (filterState.day && (!t.exitTimestamp || PaperFlipStats.dayKey(t.exitTimestamp) !== filterState.day)) return false;
    if (search && !`${t.tokenSymbol} ${t.tokenAddress}`.toLowerCase().includes(search)) return false;
    return true;
  });

  rows = rows.map((t) => ({ ...t, holdMs: PaperFlipStats.holdTimeMs(t) }));

  const { key, dir } = sortState;
  rows.sort((a, b) => {
    let av = a[key];
    let bv = b[key];
    if (typeof av === "string") av = av.toLowerCase();
    if (typeof bv === "string") bv = bv.toLowerCase();
    if (av == null) av = -Infinity;
    if (bv == null) bv = -Infinity;
    if (av < bv) return dir === "asc" ? -1 : 1;
    if (av > bv) return dir === "asc" ? 1 : -1;
    return 0;
  });

  return rows;
}

function renderTable() {
  const rows = getFilteredSortedTrades();
  el.tableCount.textContent = `${rows.length} trade${rows.length === 1 ? "" : "s"}`;
  el.tableEmpty.hidden = rows.length > 0;
  el.tbody.innerHTML = "";

  for (const t of rows) {
    const isOpen = t.status === "open";
    let pnlUsd = t.pnlUsd;
    let pnlPercent = t.pnlPercent;
    if (isOpen) {
      const livePrice = livePriceFor(t);
      pnlUsd = t.amountTokens * livePrice - t.amountUsd;
      pnlPercent = t.amountUsd ? (pnlUsd / t.amountUsd) * 100 : 0;
    }

    const tr = document.createElement("tr");
    tr.className = "pf-row";
    tr.dataset.tradeId = t.id;
    tr.innerHTML = `
      <td><span class="pf-token-cell">${escapeHtml(t.tokenSymbol)}</span></td>
      <td>${formatDate(t.entryTimestamp)}</td>
      <td>${t.exitTimestamp ? formatDate(t.exitTimestamp) : "—"}</td>
      <td>${t.status === "closed" ? PaperFlipStats.formatDuration(t.holdMs) : "—"}</td>
      <td>${formatUsd(t.amountUsd)}</td>
      <td class="${pnlClass(pnlUsd)}">${formatUsd(pnlUsd)}${isOpen ? ' <span class="pf-live-tag">live</span>' : ""}</td>
      <td class="${pnlClass(pnlPercent)}">${formatPct(pnlPercent)}</td>
      <td>${SITE_LABELS[t.site] || t.site}</td>
      <td><span class="pf-status-pill pf-status-${t.status}">${t.status}</span></td>
    `;
    tr.addEventListener("click", () => toggleExpand(t.id));
    el.tbody.appendChild(tr);

    if (expandedRowId === t.id) {
      el.tbody.appendChild(buildDetailRow(t));
    }
  }

  updateSortIndicators();
}

function buildDetailRow(t) {
  const tr = document.createElement("tr");
  tr.className = "pf-detail-row";
  tr.innerHTML = `
    <td colspan="9">
      <div class="pf-detail-grid">
        <div><span>Token Address</span><span>${escapeHtml(t.tokenAddress) || "—"}</span></div>
        <div><span>Chain</span><span>${CHAIN_LABELS[t.chain] || t.chain}</span></div>
        <div><span>Entry Price</span><span>${formatPriceSmall(t.entryPrice)}</span></div>
        <div><span>Exit Price</span><span>${t.exitPrice != null ? formatPriceSmall(t.exitPrice) : "—"}</span></div>
        <div><span>Amount Tokens</span><span>${(t.amountTokens || 0).toLocaleString(undefined, { maximumFractionDigits: 4 })}</span></div>
        <div><span>Take Profit</span><span>${t.takeProfitPercent != null ? `${t.takeProfitPercent}%` : "not set"}</span></div>
        <div><span>Stop Loss</span><span>${t.stopLossPercent != null ? `${t.stopLossPercent}%` : "not set"}</span></div>
        <div><span>Trade ID</span><span>${t.id}</span></div>
      </div>
    </td>
  `;
  return tr;
}

function toggleExpand(id) {
  expandedRowId = expandedRowId === id ? null : id;
  renderTable();
}

// ---------- PnL calendar ----------

function renderCalendar() {
  const year = calendarMonth.getFullYear();
  const month = calendarMonth.getMonth();
  el.calMonthLabel.textContent = calendarMonth.toLocaleDateString(undefined, { month: "long", year: "numeric" });

  const pnlByDay = PaperFlipStats.pnlByCalendarDay(allTrades);
  const startWeekday = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const todayKey = PaperFlipStats.dayKey(Date.now());

  el.calendarGrid.innerHTML = "";
  for (let i = 0; i < startWeekday; i++) {
    const empty = document.createElement("div");
    empty.className = "pf-cal-day pf-cal-day-empty";
    el.calendarGrid.appendChild(empty);
  }

  for (let day = 1; day <= daysInMonth; day++) {
    const key = PaperFlipStats.dayKey(new Date(year, month, day).getTime());
    const info = pnlByDay.get(key);
    const cell = document.createElement("div");
    cell.className = "pf-cal-day";
    if (key === todayKey) cell.classList.add("pf-cal-day-today");
    cell.innerHTML = `
      <span class="pf-cal-day-num">${day}</span>
      ${info ? `<span class="pf-cal-day-pnl ${pnlClass(info.pnlUsd)}">${formatUsd(info.pnlUsd)}</span>` : ""}
    `;
    if (info) {
      cell.classList.add("pf-cal-day-trades", info.pnlUsd >= 0 ? "pf-cal-day-win" : "pf-cal-day-loss");
      if (key === selectedDay) cell.classList.add("pf-cal-day-selected");
      cell.title = `${info.trades} trade${info.trades === 1 ? "" : "s"} — ${formatUsd(info.pnlUsd)} (${info.wins}W/${info.losses}L)`;
      cell.addEventListener("click", () => {
        selectedDay = selectedDay === key ? null : key;
        filterState.day = selectedDay;
        el.calClearFilter.hidden = !selectedDay;
        renderCalendar();
        renderTable();
      });
    }
    el.calendarGrid.appendChild(cell);
  }
}

// ---------- wallet manager ----------

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

async function openWalletModal() {
  el.walletModal.hidden = false;
  el.walletInstabuyInput.value = allSettings.instaBuyAmountSol;
  await renderWalletCurrent();
}

async function renderWalletCurrent() {
  el.walletCurrentUsd.textContent = formatUsd(allSettings.currentBalance);
  const price = await getSolPriceUsd();
  el.walletCurrentSolSub.textContent = price
    ? `≈ ${(allSettings.currentBalance / price).toFixed(3)} SOL @ ${formatUsd(price)}`
    : "SOL price unavailable — showing USD only";
  await updateWalletPreview();
}

async function updateWalletPreview() {
  const amount = Number(el.walletInputAmount.value) || 0;
  if (!amount) {
    el.walletPreview.textContent = "";
    return;
  }
  const price = await getSolPriceUsd();
  if (el.walletInputUnit.value === "sol") {
    el.walletPreview.textContent = price ? `≈ ${formatUsd(amount * price)}` : "SOL price unavailable — try USD instead";
  } else {
    el.walletPreview.textContent = price ? `≈ ${(amount / price).toFixed(3)} SOL` : "";
  }
}

async function resolveWalletUsdAmount() {
  const amount = Number(el.walletInputAmount.value) || 0;
  if (amount <= 0) return null;
  if (el.walletInputUnit.value === "usd") return amount;
  const price = await getSolPriceUsd();
  return price ? amount * price : null;
}

/** Two-step confirm: first click arms the button, second click (within 3s) fires. */
function armButton(button, idleLabel, confirmLabel, onConfirm) {
  let armed = false;
  let timer = null;
  button.addEventListener("click", async () => {
    if (!armed) {
      armed = true;
      button.textContent = confirmLabel;
      timer = setTimeout(() => {
        armed = false;
        button.textContent = idleLabel;
      }, 3000);
      return;
    }
    clearTimeout(timer);
    armed = false;
    button.textContent = idleLabel;
    await onConfirm();
  });
}

function updateSortIndicators() {
  el.table.querySelectorAll("th[data-sort]").forEach((th) => {
    th.classList.toggle("pf-sorted", th.dataset.sort === sortState.key);
    th.dataset.arrow = sortState.dir === "asc" ? "▲" : "▼";
  });
}

// ---------- dev tools: mock data seeding ----------

const MOCK_SYMBOLS = ["DOGE", "PEPE", "WIF", "BONK", "FLOKI", "MEW", "POPCAT", "MOG", "TURBO", "BRETT", "SLERF", "BOME"];
const MOCK_SITES = Object.keys(SITE_LABELS);
const MOCK_CHAINS = Object.keys(CHAIN_LABELS);

function randomOf(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

function randomHoldMs() {
  const roll = Math.random();
  if (roll < 0.4) return Math.floor(Math.random() * 5 * 60 * 1000); // scalp <5min
  if (roll < 0.7) return 5 * 60 * 1000 + Math.floor(Math.random() * 55 * 60 * 1000); // 5-60min
  if (roll < 0.9) return 60 * 60 * 1000 + Math.floor(Math.random() * 23 * 60 * 60 * 1000); // 1-24h
  return 24 * 60 * 60 * 1000 + Math.floor(Math.random() * 3 * 24 * 60 * 60 * 1000); // >24h
}

/**
 * Generates a realistic-looking (fat-tailed, memecoin-flavored) mock trade
 * set, purely for visually exercising the dashboard. Rebuilds the account
 * from scratch: resets balance, then replays trade entry/exit events in
 * chronological order to produce a consistent equity curve.
 */
async function seedMockData(count = 40) {
  const startingBalance = 10000;
  const now = Date.now();
  const events = []; // {timestamp, deltaUsd}
  const trades = [];

  for (let i = 0; i < count; i++) {
    const holdMs = randomHoldMs();
    const isOpen = i >= count - 4;
    // Open positions must have entered recently enough that they haven't
    // "exited" yet; closed trades are spread across the last 14 days.
    const entryTimestamp = isOpen
      ? now - Math.floor(Math.random() * Math.min(holdMs, 60 * 60 * 1000))
      : now - holdMs - Math.floor(Math.random() * 14 * 24 * 60 * 60 * 1000);
    const exitTimestamp = entryTimestamp + holdMs;

    const amountUsd = Math.round((25 + Math.random() * 475) * 100) / 100;
    const entryPrice = Math.random() * 0.01 + 0.0000001;
    const isWin = Math.random() < 0.45;
    const pnlPercent = isWin ? 10 + Math.random() * 290 : -(10 + Math.random() * 70);

    const trade = {
      id: PaperFlipStorage.generateId(),
      tokenAddress: `Mock${i.toString(36)}${Math.random().toString(36).slice(2, 8)}`,
      tokenSymbol: randomOf(MOCK_SYMBOLS),
      chain: randomOf(MOCK_CHAINS),
      site: randomOf(MOCK_SITES),
      entryPrice,
      entryTimestamp,
      exitPrice: null,
      exitTimestamp: null,
      amountUsd,
      amountTokens: amountUsd / entryPrice,
      status: "open",
      pnlUsd: 0,
      pnlPercent: 0,
      takeProfitPercent: Math.random() < 0.5 ? Math.round(50 + Math.random() * 150) : null,
      stopLossPercent: Math.random() < 0.5 ? -Math.round(10 + Math.random() * 30) : null,
    };

    events.push({ timestamp: entryTimestamp, deltaUsd: -amountUsd });

    if (!isOpen) {
      const pnlUsd = Math.round(amountUsd * (pnlPercent / 100) * 100) / 100;
      trade.status = "closed";
      trade.exitTimestamp = exitTimestamp;
      trade.exitPrice = entryPrice * (1 + pnlPercent / 100);
      trade.pnlUsd = pnlUsd;
      trade.pnlPercent = pnlPercent;
      events.push({ timestamp: exitTimestamp, deltaUsd: amountUsd + pnlUsd });
    }

    trades.push(trade);
  }

  events.sort((a, b) => a.timestamp - b.timestamp);
  const balanceHistory = [{ timestamp: events[0]?.timestamp ?? now, balance: startingBalance }];
  let balance = startingBalance;
  for (const e of events) {
    balance += e.deltaUsd;
    balanceHistory.push({ timestamp: e.timestamp, balance: Math.round(balance * 100) / 100 });
  }

  await PaperFlipStorage.setTrades(trades);
  await PaperFlipStorage.setBalanceHistory(balanceHistory);
  await PaperFlipStorage.setSettings({ startingBalance, currentBalance: Math.round(balance * 100) / 100 });
}

async function wipeAllTrades() {
  await PaperFlipStorage.resetAccount();
}

// ---------- wiring ----------

function wireEvents() {
  el.devToggle.addEventListener("click", async () => {
    await PaperFlipStorage.setSettings({ devMode: !allSettings.devMode });
    await refresh();
  });
  el.seedData.addEventListener("click", async () => {
    el.seedData.disabled = true;
    try {
      await seedMockData(40);
      await refresh();
    } finally {
      el.seedData.disabled = false;
    }
  });
  el.clearData.addEventListener("click", async () => {
    if (!confirm("Wipe all trades and reset the virtual balance? This cannot be undone.")) return;
    await wipeAllTrades();
    await refresh();
  });

  el.filterSearch.addEventListener("input", () => {
    filterState.search = el.filterSearch.value;
    renderTable();
  });
  el.filterSite.addEventListener("change", () => {
    filterState.site = el.filterSite.value;
    renderTable();
  });
  el.filterChain.addEventListener("change", () => {
    filterState.chain = el.filterChain.value;
    renderTable();
  });
  el.filterStatus.addEventListener("change", () => {
    filterState.status = el.filterStatus.value;
    renderTable();
  });

  el.table.querySelectorAll("th[data-sort]").forEach((th) => {
    th.addEventListener("click", () => {
      const key = th.dataset.sort;
      if (sortState.key === key) {
        sortState.dir = sortState.dir === "asc" ? "desc" : "asc";
      } else {
        sortState = { key, dir: "desc" };
      }
      renderTable();
    });
  });

  el.calPrev.addEventListener("click", () => {
    calendarMonth = new Date(calendarMonth.getFullYear(), calendarMonth.getMonth() - 1, 1);
    renderCalendar();
  });
  el.calNext.addEventListener("click", () => {
    calendarMonth = new Date(calendarMonth.getFullYear(), calendarMonth.getMonth() + 1, 1);
    renderCalendar();
  });
  el.calClearFilter.addEventListener("click", () => {
    selectedDay = null;
    filterState.day = null;
    el.calClearFilter.hidden = true;
    renderCalendar();
    renderTable();
  });

  el.walletOpen.addEventListener("click", openWalletModal);
  el.walletClose.addEventListener("click", () => {
    el.walletModal.hidden = true;
  });
  el.walletModal.addEventListener("click", (e) => {
    if (e.target === el.walletModal) el.walletModal.hidden = true;
  });
  el.walletInputAmount.addEventListener("input", updateWalletPreview);
  el.walletInputUnit.addEventListener("change", updateWalletPreview);
  el.walletInstabuySave.addEventListener("click", async () => {
    const amt = Number(el.walletInstabuyInput.value) || 100;
    await PaperFlipStorage.setSettings({ instaBuyAmountSol: amt });
    await refresh();
  });

  armButton(el.walletApply, "Set Balance (resets trade history)", "Confirm — wipes trades?", async () => {
    const usd = await resolveWalletUsdAmount();
    if (usd == null) return;
    await PaperFlipStorage.resetAccount(usd);
    el.walletInputAmount.value = "";
    await refresh();
    el.walletModal.hidden = true;
  });

  armButton(el.walletQuickReset, "Quick Reset (same balance, wipes trade history)", "Confirm reset?", async () => {
    await PaperFlipStorage.resetAccount();
    await refresh();
    el.walletModal.hidden = true;
  });

  PaperFlipStorage.subscribe(() => refresh());
}

document.addEventListener("DOMContentLoaded", async () => {
  Chart.defaults.color = CHART_COLORS.dim;
  Chart.defaults.borderColor = CHART_COLORS.grid;
  wireEvents();
  await refresh();
});
