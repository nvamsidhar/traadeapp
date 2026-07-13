"""
Portfolio analytics (v2 backlog): correlation matrix, per-asset annualised
stats, and an efficient-frontier (max-Sharpe) suggestion via PyPortfolioOpt.

Holdings live in the browser (localStorage); this module just crunches the
numbers for a given set of symbols, reusing market_data for OHLC (so it works
across US/India equities and Hyperliquid crypto).
"""

from __future__ import annotations

import numpy as np
import pandas as pd

import market_data

TRADING_DAYS = 252


def _closes(source: str, symbol: str) -> pd.Series | None:
    df = market_data.get_ohlc_df(source, symbol, "1d")
    if df is None or df.empty:
        return None
    s = df["Close"].copy()
    s.name = symbol.strip().upper()
    # normalise index to date (drops intraday/tz differences so crypto & stocks align)
    s.index = pd.to_datetime(s.index).normalize()
    return s[~s.index.duplicated(keep="last")]


def analyze(holdings: list[dict]) -> dict:
    """holdings: [{source, symbol}] → correlation, per-asset stats, optimal weights."""
    series: dict[str, pd.Series] = {}
    prices: dict[str, float] = {}
    for h in holdings or []:
        sym = (h.get("symbol") or "").strip().upper()
        src = h.get("source") or "us"
        if not sym or sym in series:
            continue
        s = _closes(src, sym)
        if s is None or len(s) < 30:
            continue
        series[sym] = s
        prices[sym] = round(float(s.iloc[-1]), 6)

    if not series:
        raise ValueError("no holdings had enough price data to analyse")

    px = pd.DataFrame(series).dropna()
    if len(px) < 20:
        raise ValueError("not enough overlapping history across these holdings")
    rets = px.pct_change().dropna()
    syms = list(px.columns)

    stats = {
        s: {
            "annReturn": round(float(rets[s].mean() * TRADING_DAYS * 100), 2),
            "annVol": round(float(rets[s].std() * np.sqrt(TRADING_DAYS) * 100), 2),
        }
        for s in syms
    }

    corr = rets.corr()
    corr_matrix = [[round(float(corr.iloc[i, j]), 2) for j in range(len(syms))]
                   for i in range(len(syms))]

    out: dict = {
        "ok": True,
        "symbols": syms,
        "prices": prices,
        "stats": stats,
        "corr": corr_matrix,
        "days": len(px),
    }

    if len(syms) >= 2:
        try:
            from pypfopt import EfficientFrontier, expected_returns, risk_models
            mu = expected_returns.mean_historical_return(px)
            S = risk_models.sample_cov(px)
            ef = EfficientFrontier(mu, S)
            ef.max_sharpe()
            weights = ef.clean_weights()
            exp_ret, vol, sharpe = ef.portfolio_performance()
            out["optimal"] = {
                "weights": {k: round(float(v), 4) for k, v in weights.items()},
                "expReturn": round(float(exp_ret) * 100, 2),
                "vol": round(float(vol) * 100, 2),
                "sharpe": round(float(sharpe), 2),
            }
        except Exception as exc:
            out["optimalError"] = str(exc)

    return out
