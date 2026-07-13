"""
Server-side backtesting via backtesting.py (v2 feature).

Strategies: SMA crossover, EMA crossover (a.k.a. XO Trend), RSI reversion, and
MACD crossover — all long-only, with realistic commission/slippage. Returns rich
stats (Sharpe, Sortino, CAGR, max drawdown, profit factor, exposure…), the full
equity curve, and the trade list.

Notes
-----
* backtesting.py sizes positions in *whole units*, so a $10k account can't buy a
  $100k BTC candle. We therefore run the simulation on a large internal cash base
  (INTERNAL_CASH) for fine granularity, then linearly rescale absolute equity back
  to the user's initial capital. All %-based metrics are scale-invariant, so this
  is exact for them and a faithful approximation for the equity curve.
"""

from __future__ import annotations

import math

import numpy as np
import pandas as pd
from backtesting import Backtest, Strategy
from backtesting.lib import crossover

INTERNAL_CASH = 100_000_000.0   # simulation cash base (see module docstring)


# ── indicator helpers (return arrays aligned to the price series) ─────────────

def _sma(arr, n):
    return pd.Series(arr).rolling(int(n)).mean().to_numpy()

def _ema(arr, n):
    return pd.Series(arr).ewm(span=int(n), adjust=False).mean().to_numpy()

def _rsi(arr, n=14):
    s = pd.Series(arr).astype(float)
    delta = s.diff()
    gain = delta.clip(lower=0)
    loss = -delta.clip(upper=0)
    avg_gain = gain.ewm(alpha=1 / int(n), adjust=False).mean()
    avg_loss = loss.ewm(alpha=1 / int(n), adjust=False).mean()
    rs = avg_gain / avg_loss.replace(0, np.nan)
    return (100 - 100 / (1 + rs)).to_numpy()

def _macd_line(arr, fast=12, slow=26):
    s = pd.Series(arr).astype(float)
    return (s.ewm(span=int(fast), adjust=False).mean()
            - s.ewm(span=int(slow), adjust=False).mean()).to_numpy()

def _macd_signal(arr, fast=12, slow=26, signal=9):
    line = pd.Series(_macd_line(arr, fast, slow))
    return line.ewm(span=int(signal), adjust=False).mean().to_numpy()


# ── strategies (long-only, exclusive orders) ─────────────────────────────────

class SmaCross(Strategy):
    fast = 20
    slow = 50
    def init(self):
        c = self.data.Close
        self.ma_fast = self.I(_sma, c, self.fast)
        self.ma_slow = self.I(_sma, c, self.slow)
    def next(self):
        if crossover(self.ma_fast, self.ma_slow):
            self.buy()
        elif crossover(self.ma_slow, self.ma_fast):
            self.position.close()


class EmaCross(Strategy):
    """EMA fast/slow crossover — the server-side twin of the app's XO Trend."""
    fast = 12
    slow = 25
    def init(self):
        c = self.data.Close
        self.ma_fast = self.I(_ema, c, self.fast)
        self.ma_slow = self.I(_ema, c, self.slow)
    def next(self):
        if crossover(self.ma_fast, self.ma_slow):
            self.buy()
        elif crossover(self.ma_slow, self.ma_fast):
            self.position.close()


class RsiReversion(Strategy):
    period = 14
    lower = 30
    upper = 70
    def init(self):
        self.rsi = self.I(_rsi, self.data.Close, self.period)
    def next(self):
        r = self.rsi[-1]
        if math.isnan(r):
            return
        if not self.position and r < self.lower:
            self.buy()
        elif self.position and r > self.upper:
            self.position.close()


class MacdCross(Strategy):
    fast = 12
    slow = 26
    signal = 9
    def init(self):
        c = self.data.Close
        self.macd = self.I(_macd_line, c, self.fast, self.slow)
        self.sig = self.I(_macd_signal, c, self.fast, self.slow, self.signal)
    def next(self):
        if crossover(self.macd, self.sig):
            self.buy()
        elif crossover(self.sig, self.macd):
            self.position.close()


# ── strategy registry + tunable-param specs (also drives the UI form) ─────────

STRATEGY_SPECS: dict[str, dict] = {
    "ema": {
        "label": "EMA Crossover (XO Trend)",
        "cls": EmaCross,
        "params": [
            {"key": "fast", "label": "Fast EMA", "default": 12, "min": 2, "max": 200},
            {"key": "slow", "label": "Slow EMA", "default": 25, "min": 3, "max": 400},
        ],
        "optimize": {"fast": range(5, 21, 3), "slow": range(20, 61, 5)},
    },
    "sma": {
        "label": "SMA Crossover",
        "cls": SmaCross,
        "params": [
            {"key": "fast", "label": "Fast SMA", "default": 20, "min": 2, "max": 200},
            {"key": "slow", "label": "Slow SMA", "default": 50, "min": 3, "max": 400},
        ],
        "optimize": {"fast": range(10, 31, 5), "slow": range(40, 101, 10)},
    },
    "rsi": {
        "label": "RSI Reversion",
        "cls": RsiReversion,
        "params": [
            {"key": "period", "label": "RSI period", "default": 14, "min": 2, "max": 100},
            {"key": "lower", "label": "Buy below", "default": 30, "min": 5, "max": 50},
            {"key": "upper", "label": "Sell above", "default": 70, "min": 50, "max": 95},
        ],
        "optimize": {"period": range(7, 22, 7), "lower": range(20, 41, 10)},
    },
    "macd": {
        "label": "MACD Crossover",
        "cls": MacdCross,
        "params": [
            {"key": "fast", "label": "Fast", "default": 12, "min": 2, "max": 100},
            {"key": "slow", "label": "Slow", "default": 26, "min": 3, "max": 200},
            {"key": "signal", "label": "Signal", "default": 9, "min": 2, "max": 100},
        ],
        "optimize": {"fast": range(8, 17, 4), "slow": range(20, 33, 6)},
    },
}


def strategy_menu() -> list[dict]:
    """JSON-safe strategy metadata for the frontend (no class objects)."""
    return [
        {"key": k, "label": s["label"], "params": s["params"]}
        for k, s in STRATEGY_SPECS.items()
    ]


# ── helpers ──────────────────────────────────────────────────────────────────

def _clean(v):
    """NaN/inf → None; numpy scalars → python; so the result is JSON-safe."""
    if v is None:
        return None
    if isinstance(v, (np.integer,)):
        return int(v)
    if isinstance(v, (np.floating, float)):
        f = float(v)
        return None if (math.isnan(f) or math.isinf(f)) else round(f, 4)
    return v


def _equity_series(stats, scale: float) -> list[dict]:
    eq = stats["_equity_curve"]["Equity"]
    # keep the payload light — cap at ~1500 points
    if len(eq) > 1500:
        eq = eq.iloc[:: max(1, len(eq) // 1500)]
    return [
        {"time": int(ts.timestamp()), "value": round(float(v) * scale, 2)}
        for ts, v in eq.items()
        if not (math.isnan(v) or math.isinf(v))
    ]


def _trades(stats, scale: float) -> list[dict]:
    tr = stats["_trades"]
    out = []
    for _, t in tr.iterrows():
        out.append({
            "entryTime": int(pd.Timestamp(t["EntryTime"]).timestamp()),
            "exitTime":  int(pd.Timestamp(t["ExitTime"]).timestamp()),
            "entryPrice": _clean(t["EntryPrice"]),
            "exitPrice":  _clean(t["ExitPrice"]),
            "pnlPct":     _clean(t["ReturnPct"] * 100),
            "pnl":        _clean(t["PnL"] * scale),
        })
    return out


def _format(stats, name: str, params: dict, user_cash: float,
            commission_pct: float, interval: str) -> dict:
    scale = float(user_cash) / INTERNAL_CASH
    keys = [
        "Return [%]", "Buy & Hold Return [%]", "CAGR [%]", "Return (Ann.) [%]",
        "Volatility (Ann.) [%]", "Sharpe Ratio", "Sortino Ratio", "Calmar Ratio",
        "Max. Drawdown [%]", "Avg. Drawdown [%]", "Win Rate [%]", "# Trades",
        "Best Trade [%]", "Worst Trade [%]", "Avg. Trade [%]", "Profit Factor",
        "Expectancy [%]", "Exposure Time [%]", "SQN",
    ]
    metrics = {k: _clean(stats.get(k)) for k in keys}
    return {
        "ok": True,
        "strategy": name,
        "params": params,
        "interval": interval,
        "commissionPct": commission_pct,
        "initialCapital": round(float(user_cash), 2),
        "finalEquity": round(float(stats.get("Equity Final [$]", INTERNAL_CASH)) * scale, 2),
        "metrics": metrics,
        "equity": _equity_series(stats, scale),
        "trades": _trades(stats, scale),
    }


# ── public API ────────────────────────────────────────────────────────────────

def run_backtest(df: pd.DataFrame, strategy_key: str, params: dict | None = None,
                 cash: float = 10_000, commission_pct: float = 0.2,
                 interval: str = "1d", optimize: bool = False) -> dict:
    if strategy_key not in STRATEGY_SPECS:
        raise ValueError(f"unknown strategy '{strategy_key}'")
    spec = STRATEGY_SPECS[strategy_key]
    if df is None or df.empty or len(df) < 30:
        raise ValueError("not enough candle data to backtest (need ≥ 30 bars)")

    defaults = {p["key"]: p["default"] for p in spec["params"]}
    chosen = {**defaults, **{k: int(v) for k, v in (params or {}).items()
                             if k in defaults and v is not None}}
    commission = max(0.0, float(commission_pct)) / 100.0

    bt = Backtest(df, spec["cls"], cash=INTERNAL_CASH, commission=commission,
                  exclusive_orders=True, finalize_trades=True)

    if optimize:
        try:
            stats = bt.optimize(maximize="Sharpe Ratio", **spec["optimize"])
            chosen = {k: int(getattr(stats["_strategy"], k)) for k in defaults}
        except Exception:
            stats = bt.run(**chosen)          # fall back to a single run
    else:
        stats = bt.run(**chosen)

    out = _format(stats, spec["label"], chosen, cash, commission_pct, interval)
    out["optimized"] = bool(optimize)
    return out
