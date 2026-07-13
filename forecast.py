"""
Probabilistic price forecast (v2 backlog).

A geometric-Brownian-motion projection: estimate drift + volatility from the
symbol's log-returns, then project a forecast *cone* — the median path plus 68%
and 95% confidence bands that widen with √time. Honest about uncertainty (it's a
distribution, not a point call) and dependency-free (no Prophet/Stan needed).
Reuses market_data, so it works on US/India equities and Hyperliquid crypto.
"""

from __future__ import annotations

import numpy as np

import market_data

TRADING_DAYS = 252
Z68, Z95 = 1.0, 1.96   # ~1σ and ~2σ band multipliers


def forecast(source: str, symbol: str, interval: str = "1d", horizon: int = 30) -> dict:
    df = market_data.get_ohlc_df(source, symbol, interval)
    if df is None or df.empty or len(df) < 40:
        raise ValueError("not enough price history to forecast (need ≥ 40 bars)")

    close = df["Close"].astype(float)
    logret = np.log(close / close.shift(1)).dropna()
    mu = float(logret.mean())          # drift per bar
    sigma = float(logret.std())        # volatility per bar
    s0 = float(close.iloc[-1])

    times = [int(t.timestamp()) for t in df.index]
    step = (times[-1] - times[-2]) if len(times) >= 2 else 86400

    history = [{"time": t, "value": round(float(v), 4)}
               for t, v in zip(times[-140:], close.iloc[-140:])]

    fc = []
    for i in range(1, int(horizon) + 1):
        drift = mu * i
        vol = sigma * np.sqrt(i)
        fc.append({
            "time": times[-1] + i * step,
            "median": round(float(s0 * np.exp(drift)), 4),
            "u68": round(float(s0 * np.exp(drift + Z68 * vol)), 4),
            "l68": round(float(s0 * np.exp(drift - Z68 * vol)), 4),
            "u95": round(float(s0 * np.exp(drift + Z95 * vol)), 4),
            "l95": round(float(s0 * np.exp(drift - Z95 * vol)), 4),
        })

    # scale per-bar stats to annual only for daily bars; otherwise report per-bar
    ann = interval in ("1d", "1wk")
    factor = TRADING_DAYS if interval == "1d" else (52 if interval == "1wk" else 1)
    return {
        "ok": True,
        "symbol": symbol.strip().upper(),
        "interval": interval,
        "spot": round(s0, 4),
        "driftAnnPct": round(mu * factor * 100, 2) if ann else round(mu * 100, 4),
        "volAnnPct": round(sigma * np.sqrt(factor) * 100, 2) if ann else round(sigma * 100, 4),
        "annualized": ann,
        "history": history,
        "forecast": fc,
    }
