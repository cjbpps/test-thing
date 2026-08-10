/*
 * PaperFlip — lib/storage.js
 *
 * Thin wrapper around chrome.storage.local for the three top-level records:
 *   trades          -> Trade[]
 *   settings        -> Settings
 *   balanceHistory  -> {timestamp:number, balance:number}[]
 *
 * Every mutation goes through here so popup, stats page, content-script
 * overlays, and the background worker all read/write the same shape.
 * Live updates across those surfaces ride on chrome.storage.onChanged,
 * which fires in every extension context automatically — `subscribe()`
 * below is a thin, testable wrapper around that so callers don't need to
 * touch chrome.storage.onChanged directly.
 *
 * No real funds or wallets are ever involved — `currentBalance` is a
 * plain number tracked locally, never touching any blockchain or wallet API.
 */

(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory();
  } else {
    root.PaperFlipStorage = factory();
  }
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  const KEYS = {
    trades: "trades",
    settings: "settings",
    balanceHistory: "balanceHistory",
  };

  const DEFAULT_SETTINGS = {
    startingBalance: 10000,
    currentBalance: 10000,
    defaultSlippagePercent: 1,
    defaultTakeProfitPercent: null,
    defaultStopLossPercent: null,
    instaBuyAmountSol: 0.5,
    devMode: false,
    resetHistory: [], // [{timestamp, previousBalance, previousTradeCount}]
  };

  function hasChrome() {
    return typeof chrome !== "undefined" && chrome.storage && chrome.storage.local;
  }

  // In-memory fallback so this file is loadable/testable outside an extension.
  const memoryStore = {
    trades: [],
    settings: { ...DEFAULT_SETTINGS },
    balanceHistory: [],
  };

  async function storageGet(key, fallback) {
    if (!hasChrome()) return memoryStore[key] ?? fallback;
    const result = await chrome.storage.local.get(key);
    return result[key] !== undefined ? result[key] : fallback;
  }

  async function storageSet(key, value) {
    if (!hasChrome()) {
      memoryStore[key] = value;
      return;
    }
    await chrome.storage.local.set({ [key]: value });
  }

  function generateId() {
    if (typeof crypto !== "undefined" && crypto.randomUUID) return crypto.randomUUID();
    // RFC4122-ish fallback for environments without crypto.randomUUID.
    return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
      const r = (Math.random() * 16) | 0;
      const v = c === "x" ? r : (r & 0x3) | 0x8;
      return v.toString(16);
    });
  }

  // ---- trades -------------------------------------------------------------

  async function getTrades() {
    return storageGet(KEYS.trades, []);
  }

  async function setTrades(trades) {
    await storageSet(KEYS.trades, trades);
  }

  async function getTrade(id) {
    const trades = await getTrades();
    return trades.find((t) => t.id === id) || null;
  }

  /**
   * Opens a new paper position: builds the trade record, deducts amountUsd
   * from the virtual balance, and records a balanceHistory snapshot.
   */
  async function openTrade(input) {
    const settings = await getSettings();
    const amountUsd = Number(input.amountUsd) || 0;
    const entryPrice = Number(input.entryPrice) || 0;

    const trade = {
      id: generateId(),
      tokenAddress: input.tokenAddress || "",
      tokenSymbol: input.tokenSymbol || "UNKNOWN",
      chain: input.chain || "solana",
      site: input.site || "dexscreener",
      entryPrice,
      entryTimestamp: Date.now(),
      exitPrice: null,
      exitTimestamp: null,
      amountUsd,
      amountSol: input.amountSol != null ? Number(input.amountSol) : null,
      amountTokens: entryPrice > 0 ? amountUsd / entryPrice : 0,
      status: "open",
      pnlUsd: 0,
      pnlPercent: 0,
      takeProfitPercent: input.takeProfitPercent ?? settings.defaultTakeProfitPercent ?? null,
      stopLossPercent: input.stopLossPercent ?? settings.defaultStopLossPercent ?? null,
    };

    const trades = await getTrades();
    trades.push(trade);
    await setTrades(trades);

    await setSettings({ currentBalance: settings.currentBalance - amountUsd });
    await recordBalanceSnapshot();

    return trade;
  }

  /**
   * Closes an open position at exitPrice: computes PnL, credits the
   * proceeds back to the virtual balance, and snapshots balance history.
   */
  async function closeTrade(id, exitPrice) {
    const trades = await getTrades();
    const trade = trades.find((t) => t.id === id);
    if (!trade || trade.status !== "open") return null;

    const price = Number(exitPrice) || 0;
    const proceeds = trade.amountTokens * price;
    const pnlUsd = proceeds - trade.amountUsd;
    const pnlPercent = trade.amountUsd ? (pnlUsd / trade.amountUsd) * 100 : 0;

    trade.exitPrice = price;
    trade.exitTimestamp = Date.now();
    trade.status = "closed";
    trade.pnlUsd = pnlUsd;
    trade.pnlPercent = pnlPercent;

    await setTrades(trades);

    const settings = await getSettings();
    await setSettings({ currentBalance: settings.currentBalance + proceeds });
    await recordBalanceSnapshot();

    return trade;
  }

  async function updateTrade(id, patch) {
    const trades = await getTrades();
    const idx = trades.findIndex((t) => t.id === id);
    if (idx === -1) return null;
    trades[idx] = { ...trades[idx], ...patch };
    await setTrades(trades);
    return trades[idx];
  }

  async function deleteTrade(id) {
    const trades = await getTrades();
    await setTrades(trades.filter((t) => t.id !== id));
  }

  // ---- settings -------------------------------------------------------------

  async function getSettings() {
    const stored = await storageGet(KEYS.settings, null);
    return { ...DEFAULT_SETTINGS, ...(stored || {}) };
  }

  async function setSettings(patch) {
    const current = await getSettings();
    const next = { ...current, ...patch };
    await storageSet(KEYS.settings, next);
    return next;
  }

  // ---- balance history --------------------------------------------------

  async function getBalanceHistory() {
    return storageGet(KEYS.balanceHistory, []);
  }

  async function setBalanceHistory(history) {
    await storageSet(KEYS.balanceHistory, history);
  }

  async function recordBalanceSnapshot() {
    const settings = await getSettings();
    const history = await getBalanceHistory();
    history.push({ timestamp: Date.now(), balance: settings.currentBalance });
    await storageSet(KEYS.balanceHistory, history);
    return history;
  }

  /**
   * Wipes trades + balance history and resets the virtual balance to
   * `newStartingBalance` (defaults to the current startingBalance setting).
   * Used by the popup's "Reset balance" action, gated on user confirmation
   * in the UI layer.
   */
  async function resetAccount(newStartingBalance) {
    const settings = await getSettings();
    const trades = await getTrades();
    const startingBalance = Number(newStartingBalance) || settings.startingBalance;

    await setTrades([]);
    await storageSet(KEYS.balanceHistory, [{ timestamp: Date.now(), balance: startingBalance }]);
    await setSettings({
      startingBalance,
      currentBalance: startingBalance,
      resetHistory: [
        ...settings.resetHistory,
        { timestamp: Date.now(), previousBalance: settings.currentBalance, previousTradeCount: trades.length },
      ],
    });
  }

  // ---- pub/sub ------------------------------------------------------------

  /**
   * Subscribes to live changes on any of the storage keys this module owns.
   * callback receives (changeMap) where changeMap[key] = {oldValue, newValue}.
   * Returns an unsubscribe function.
   */
  function subscribe(callback) {
    if (!hasChrome() || !chrome.storage.onChanged) return () => {};
    const listener = (changes, areaName) => {
      if (areaName !== "local") return;
      const relevant = Object.keys(changes).filter((k) => Object.values(KEYS).includes(k));
      if (!relevant.length) return;
      const changeMap = {};
      for (const k of relevant) changeMap[k] = changes[k];
      callback(changeMap);
    };
    chrome.storage.onChanged.addListener(listener);
    return () => chrome.storage.onChanged.removeListener(listener);
  }

  return {
    KEYS,
    DEFAULT_SETTINGS,
    generateId,
    getTrades,
    setTrades,
    getTrade,
    openTrade,
    closeTrade,
    updateTrade,
    deleteTrade,
    getSettings,
    setSettings,
    getBalanceHistory,
    setBalanceHistory,
    recordBalanceSnapshot,
    resetAccount,
    subscribe,
  };
});
