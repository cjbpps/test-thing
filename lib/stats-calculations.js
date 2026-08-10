/*
 * PaperFlip — stats-calculations.js
 *
 * Pure, dependency-free functions over a `trades` array. No chrome.* calls,
 * no DOM — safe to unit test in plain Node and to reuse from the stats page,
 * the popup, and the background worker's badge calculation.
 *
 * Trade shape (see lib/storage.js for the canonical schema):
 * {
 *   id, tokenAddress, tokenSymbol, chain, site,
 *   entryPrice, entryTimestamp, exitPrice, exitTimestamp,
 *   amountUsd, amountTokens, status: "open" | "closed",
 *   pnlUsd, pnlPercent, takeProfitPercent, stopLossPercent
 * }
 *
 * All money/PnL figures paper-trade only — no real funds or wallets involved.
 */

(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory();
  } else {
    root.PaperFlipStats = factory();
  }
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  function getClosedTrades(trades) {
    return (trades || []).filter((t) => t.status === "closed");
  }

  function getOpenTrades(trades) {
    return (trades || []).filter((t) => t.status === "open");
  }

  function sum(arr) {
    return arr.reduce((a, b) => a + b, 0);
  }

  function mean(arr) {
    return arr.length ? sum(arr) / arr.length : 0;
  }

  function median(arr) {
    if (!arr.length) return 0;
    const sorted = [...arr].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
  }

  function holdTimeMs(trade) {
    return Math.max(0, (trade.exitTimestamp || 0) - (trade.entryTimestamp || 0));
  }

  /**
   * winRate([{status:"closed",pnlUsd:10},{status:"closed",pnlUsd:-5},{status:"open"}])
   * => { wins: 1, losses: 1, total: 2, rate: 0.5 }
   */
  function winRate(trades) {
    const closed = getClosedTrades(trades);
    const wins = closed.filter((t) => t.pnlUsd > 0).length;
    const losses = closed.filter((t) => t.pnlUsd <= 0).length;
    return {
      wins,
      losses,
      total: closed.length,
      rate: closed.length ? wins / closed.length : 0,
    };
  }

  /**
   * formatDuration(4 * 3600 * 1000 + 12 * 60 * 1000) => "4h 12m"
   * formatDuration(2 * 86400000 + 3 * 3600000)        => "2d 3h"
   * formatDuration(45000)                             => "45s"
   */
  function formatDuration(ms) {
    if (!ms || ms < 0) return "0s";
    const s = Math.floor(ms / 1000);
    const days = Math.floor(s / 86400);
    const hours = Math.floor((s % 86400) / 3600);
    const mins = Math.floor((s % 3600) / 60);
    const secs = s % 60;
    if (days > 0) return `${days}d ${hours}h`;
    if (hours > 0) return `${hours}h ${mins}m`;
    if (mins > 0) return `${mins}m ${secs}s`;
    return `${secs}s`;
  }

  /**
   * avgHoldTimeMs([{entryTimestamp:0,exitTimestamp:60000,status:"closed"}]) => 60000
   */
  function avgHoldTimeMs(trades) {
    const closed = getClosedTrades(trades);
    return mean(closed.map(holdTimeMs));
  }

  function medianHoldTimeMs(trades) {
    const closed = getClosedTrades(trades);
    return median(closed.map(holdTimeMs));
  }

  /**
   * totalRealizedPnl([{status:"closed",pnlUsd:100,amountUsd:1000},{status:"closed",pnlUsd:-40,amountUsd:500}])
   * => { usd: 60, percent: 4 }   // 60 / (1000+500) * 100
   */
  function totalRealizedPnl(trades) {
    const closed = getClosedTrades(trades);
    const usd = sum(closed.map((t) => t.pnlUsd || 0));
    const invested = sum(closed.map((t) => t.amountUsd || 0));
    return { usd, percent: invested ? (usd / invested) * 100 : 0 };
  }

  function bestTrade(trades) {
    const closed = getClosedTrades(trades);
    if (!closed.length) return null;
    return closed.reduce((best, t) => ((t.pnlPercent || 0) > (best.pnlPercent || 0) ? t : best));
  }

  function worstTrade(trades) {
    const closed = getClosedTrades(trades);
    if (!closed.length) return null;
    return closed.reduce((worst, t) => ((t.pnlPercent || 0) < (worst.pnlPercent || 0) ? t : worst));
  }

  /**
   * currentStreak([...closed trades ordered any way...])
   * Looks at trades ordered by exitTimestamp (most recent first) and counts
   * consecutive wins or losses from the most recent trade backwards.
   * => { type: "win" | "loss" | "none", count: number }
   */
  function currentStreak(trades) {
    const closed = getClosedTrades(trades)
      .slice()
      .sort((a, b) => (b.exitTimestamp || 0) - (a.exitTimestamp || 0));
    if (!closed.length) return { type: "none", count: 0 };

    const isWin = (t) => t.pnlUsd > 0;
    const streakType = isWin(closed[0]) ? "win" : "loss";
    let count = 0;
    for (const t of closed) {
      if (isWin(t) === (streakType === "win")) count++;
      else break;
    }
    return { type: streakType, count };
  }

  /**
   * avgWinLoss([{status:"closed",pnlUsd:100},{status:"closed",pnlUsd:-50},{status:"closed",pnlUsd:-25}])
   * => { avgWin: 100, avgLoss: 37.5, winLossRatio: 2.666... }
   */
  function avgWinLoss(trades) {
    const closed = getClosedTrades(trades);
    const wins = closed.filter((t) => t.pnlUsd > 0).map((t) => t.pnlUsd);
    const losses = closed.filter((t) => t.pnlUsd < 0).map((t) => Math.abs(t.pnlUsd));
    const avgWin = mean(wins);
    const avgLoss = mean(losses);
    return { avgWin, avgLoss, winLossRatio: avgLoss ? avgWin / avgLoss : avgWin > 0 ? Infinity : 0 };
  }

  /**
   * profitFactor([{status:"closed",pnlUsd:100},{status:"closed",pnlUsd:-50}]) => 2
   * grossProfit / grossLoss. Returns Infinity if there are wins and zero losses,
   * 0 if there are neither wins nor losses.
   */
  function profitFactor(trades) {
    const closed = getClosedTrades(trades);
    const grossProfit = sum(closed.filter((t) => t.pnlUsd > 0).map((t) => t.pnlUsd));
    const grossLoss = Math.abs(sum(closed.filter((t) => t.pnlUsd < 0).map((t) => t.pnlUsd)));
    if (grossLoss === 0) return grossProfit > 0 ? Infinity : 0;
    return grossProfit / grossLoss;
  }

  function countBy(trades, key) {
    const out = {};
    for (const t of trades || []) {
      const k = t[key] || "unknown";
      out[k] = (out[k] || 0) + 1;
    }
    return out;
  }

  /** tradesBySite([{site:"axiom"},{site:"axiom"},{site:"gmgn"}]) => {axiom:2, gmgn:1} */
  function tradesBySite(trades) {
    return countBy(trades, "site");
  }

  /** tradesByChain([{chain:"solana"},{chain:"base"}]) => {solana:1, base:1} */
  function tradesByChain(trades) {
    return countBy(trades, "chain");
  }

  /** avgPositionSize([{amountUsd:100},{amountUsd:300}]) => 200 */
  function avgPositionSize(trades) {
    return mean((trades || []).map((t) => t.amountUsd || 0));
  }

  const HOLD_BUCKETS = [
    { key: "scalp", label: "<5min", maxMs: 5 * 60 * 1000 },
    { key: "short", label: "5-60min", maxMs: 60 * 60 * 1000 },
    { key: "medium", label: "1-24h", maxMs: 24 * 60 * 60 * 1000 },
    { key: "long", label: ">24h", maxMs: Infinity },
  ];

  function bucketForHoldTime(ms) {
    return HOLD_BUCKETS.find((b) => ms < b.maxMs) || HOLD_BUCKETS[HOLD_BUCKETS.length - 1];
  }

  /**
   * pnlByHoldBucket([{status:"closed",entryTimestamp:0,exitTimestamp:60000,pnlUsd:10}])
   * => [{key:"scalp",label:"<5min",trades:1,pnlUsd:10,winRate:1}, {key:"short",...,trades:0,...}, ...]
   */
  function pnlByHoldBucket(trades) {
    const closed = getClosedTrades(trades);
    const buckets = HOLD_BUCKETS.map((b) => ({ ...b, trades: 0, pnlUsd: 0, wins: 0 }));
    for (const t of closed) {
      const bucket = buckets.find((b) => b.key === bucketForHoldTime(holdTimeMs(t)).key);
      bucket.trades += 1;
      bucket.pnlUsd += t.pnlUsd || 0;
      if (t.pnlUsd > 0) bucket.wins += 1;
    }
    return buckets.map(({ maxMs, wins, ...rest }) => ({
      ...rest,
      winRate: rest.trades ? wins / rest.trades : 0,
    }));
  }

  /** dayKey(new Date(2026, 0, 5).getTime()) => "2026-01-05" (local calendar day) */
  function dayKey(timestamp) {
    const d = new Date(timestamp);
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return `${y}-${m}-${day}`;
  }

  /**
   * pnlByCalendarDay([{status:"closed",exitTimestamp:<ts>,pnlUsd:50}, ...])
   * => Map("2026-01-05" -> {pnlUsd:50, trades:1, wins:1, losses:0})
   * Grouped by the local calendar day a trade was *closed* on (when its PnL
   * was realized) — used to render the Stats page's PnL calendar heatmap.
   */
  function pnlByCalendarDay(trades) {
    const closed = getClosedTrades(trades);
    const byDay = new Map();
    for (const t of closed) {
      const key = dayKey(t.exitTimestamp);
      const entry = byDay.get(key) || { pnlUsd: 0, trades: 0, wins: 0, losses: 0 };
      entry.pnlUsd += t.pnlUsd || 0;
      entry.trades += 1;
      if (t.pnlUsd > 0) entry.wins += 1;
      else entry.losses += 1;
      byDay.set(key, entry);
    }
    return byDay;
  }

  function openPositionsCount(trades) {
    return getOpenTrades(trades).length;
  }

  function totalTradesCount(trades) {
    return (trades || []).length;
  }

  /**
   * Builds every stat the Stats page needs in one pass, so callers don't have
   * to remember to invoke each function individually.
   */
  function computeAllStats(trades) {
    const closed = getClosedTrades(trades);
    return {
      winRate: winRate(trades),
      avgHoldTimeMs: avgHoldTimeMs(trades),
      avgHoldTimeLabel: formatDuration(avgHoldTimeMs(trades)),
      medianHoldTimeMs: medianHoldTimeMs(trades),
      medianHoldTimeLabel: formatDuration(medianHoldTimeMs(trades)),
      totalRealizedPnl: totalRealizedPnl(trades),
      bestTrade: bestTrade(trades),
      worstTrade: worstTrade(trades),
      currentStreak: currentStreak(trades),
      avgWinLoss: avgWinLoss(trades),
      profitFactor: profitFactor(trades),
      tradesBySite: tradesBySite(trades),
      tradesByChain: tradesByChain(trades),
      avgPositionSize: avgPositionSize(trades),
      pnlByHoldBucket: pnlByHoldBucket(trades),
      openPositionsCount: openPositionsCount(trades),
      totalTradesCount: totalTradesCount(trades),
      closedTradesCount: closed.length,
    };
  }

  return {
    getClosedTrades,
    getOpenTrades,
    holdTimeMs,
    formatDuration,
    winRate,
    avgHoldTimeMs,
    medianHoldTimeMs,
    totalRealizedPnl,
    bestTrade,
    worstTrade,
    currentStreak,
    avgWinLoss,
    profitFactor,
    tradesBySite,
    tradesByChain,
    avgPositionSize,
    HOLD_BUCKETS,
    bucketForHoldTime,
    pnlByHoldBucket,
    dayKey,
    pnlByCalendarDay,
    openPositionsCount,
    totalTradesCount,
    computeAllStats,
  };
});
