/*
 * PaperFlip — background.js (MV3 service worker)
 *
 * Responsibilities:
 *  1. Relay price-fetch requests from content scripts (see
 *     lib/price-api.js registerBackgroundRelay — content scripts can be
 *     blocked from cross-origin fetch by a host page's CSP, the service
 *     worker never is).
 *  2. Poll live prices for open positions on a chrome.alarms interval and
 *     paint the toolbar badge with live unrealized+realized PnL.
 *
 * Purely local simulation — no wallets, no real funds, no transactions are
 * ever sent anywhere. The only network calls this extension makes are
 * read-only GETs to the public DexScreener price API.
 */

importScripts("lib/storage.js", "lib/price-api.js", "lib/stats-calculations.js");

const ALARM_NAME = "paperflip-price-poll";
const POLL_PERIOD_MINUTES = 1;

PaperFlipPriceApi.registerBackgroundRelay();

chrome.runtime.onInstalled.addListener(() => {
  chrome.alarms.create(ALARM_NAME, { periodInMinutes: POLL_PERIOD_MINUTES });
  updateBadge();
});

chrome.runtime.onStartup.addListener(() => {
  chrome.alarms.create(ALARM_NAME, { periodInMinutes: POLL_PERIOD_MINUTES });
  updateBadge();
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === ALARM_NAME) updateBadge();
});

// Recompute the badge immediately whenever a trade opens/closes or the
// balance changes, instead of waiting for the next polling tick.
PaperFlipStorage.subscribe((changes) => {
  if (changes.trades || changes.settings) updateBadge();
});

async function updateBadge() {
  try {
    const trades = await PaperFlipStorage.getTrades();
    const open = trades.filter((t) => t.status === "open");
    const realizedPnl = PaperFlipStats.totalRealizedPnl(trades).usd;

    let unrealizedPnl = 0;
    if (open.length) {
      const prices = await PaperFlipPriceApi.getTokenPrices(open.map((t) => t.tokenAddress));
      for (const t of open) {
        const info = prices.get(t.tokenAddress);
        if (info && info.priceUsd) {
          unrealizedPnl += t.amountTokens * info.priceUsd - t.amountUsd;
        }
      }
    }

    const totalPnl = realizedPnl + unrealizedPnl;
    await chrome.action.setBadgeText({ text: formatBadgePnl(totalPnl) });
    await chrome.action.setBadgeBackgroundColor({ color: totalPnl >= 0 ? "#2ed573" : "#ff4757" });
  } catch (err) {
    // Price API hiccup or no trades yet — leave the badge as-is rather than
    // showing a misleading error state.
    console.warn("[PaperFlip] badge update skipped:", err.message);
  }
}

function formatBadgePnl(usd) {
  if (!usd) return "";
  const abs = Math.abs(usd);
  const sign = usd >= 0 ? "+" : "-";
  const text = abs >= 1000 ? `${(abs / 1000).toFixed(1)}k` : abs.toFixed(0);
  // Chrome badges are ~4 chars wide before truncation; keep it tight.
  return `${sign}${text}`.slice(0, 6);
}
