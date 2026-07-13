"""
QuantStats performance reports (v2 feature).

Turns a backtest equity curve (or any equity series) into daily returns, then
produces both a compact key-metrics dict for inline display and a full HTML
tearsheet (Sharpe/Sortino, drawdown analysis, monthly-returns heatmap, …).

quantstats assumes daily periodicity, so intraday equity curves are resampled to
daily before analysis — daily-interval backtests give the most accurate tearsheet.
"""

from __future__ import annotations

import os
import tempfile
import warnings

import numpy as np
import pandas as pd

warnings.filterwarnings("ignore")


def equity_to_returns(equity_points: list[dict]) -> pd.Series:
    """[{time (unix s), value}] equity curve → daily % returns series."""
    if not equity_points:
        return pd.Series(dtype=float)
    s = pd.Series(
        [p["value"] for p in equity_points],
        index=pd.to_datetime([p["time"] for p in equity_points], unit="s"),
    ).sort_index()
    daily = s.resample("D").last().dropna()
    return daily.pct_change().dropna()


def key_metrics(returns: pd.Series) -> dict:
    """Compact, JSON-safe headline metrics from quantstats."""
    import quantstats as qs

    if returns is None or len(returns) < 2:
        return {}

    def g(fn, pct=False):
        try:
            v = float(fn(returns))
            if np.isnan(v) or np.isinf(v):
                return None
            return round(v * 100, 2) if pct else round(v, 3)
        except Exception:
            return None

    return {
        "CAGR [%]":         g(qs.stats.cagr, pct=True),
        "Sharpe":           g(qs.stats.sharpe),
        "Sortino":          g(qs.stats.sortino),
        "Volatility [%]":   g(qs.stats.volatility, pct=True),
        "Max Drawdown [%]": g(qs.stats.max_drawdown, pct=True),
        "Calmar":           g(qs.stats.calmar),
        "Win Rate [%]":     g(qs.stats.win_rate, pct=True),
    }


def html_tearsheet(returns: pd.Series, title: str = "Strategy Tearsheet") -> str:
    """Full quantstats HTML report as a string (with embedded plots)."""
    import quantstats as qs

    if returns is None or len(returns) < 2:
        return "<h2>Not enough data for a tearsheet.</h2>"

    fd, path = tempfile.mkstemp(suffix=".html")
    os.close(fd)
    try:
        qs.reports.html(returns, output=path, title=title, benchmark=None)
        with open(path, "r", encoding="utf-8") as f:
            return f.read()
    finally:
        try:
            os.remove(path)
        except OSError:
            pass
