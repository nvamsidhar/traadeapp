"""
Server-side OHLCV as pandas DataFrames — for the v2 backtest engine.

Stocks (US / India) reuse the yfinance path from data_source; crypto pulls real
OHLCV from Hyperliquid's `candleSnapshot` endpoint (the same source the browser
dashboard uses in fetchHLCandles). Both are normalised to a DataFrame indexed by
a DatetimeIndex with columns Open / High / Low / Close / Volume — the exact shape
backtesting.py expects.
"""

from __future__ import annotations

import time

import requests
import pandas as pd

from data_source import get_yfinance_candles

HL_REST_URL = "https://api.hyperliquid.xyz/info"

# interval → lookback window in days (mirrors the frontend HL_LOOKBACK table)
_HL_LOOKBACK_DAYS: dict[str, int] = {
    "1m": 3, "5m": 14, "15m": 30, "30m": 60,
    "1h": 180, "4h": 720, "1d": 730, "1wk": 1460,
}

# our interval labels → Hyperliquid's interval labels ("1wk" is "1w" there)
_HL_INTERVAL: dict[str, str] = {
    "1m": "1m", "5m": "5m", "15m": "15m", "30m": "30m",
    "1h": "1h", "4h": "4h", "1d": "1d", "1wk": "1w",
}


def get_hyperliquid_candles(coin: str, interval: str) -> list[dict]:
    """Fetch OHLCV for a Hyperliquid perp via the public candleSnapshot endpoint."""
    hl_int = _HL_INTERVAL.get(interval, "1h")
    lookback_days = _HL_LOOKBACK_DAYS.get(interval, 180)
    now_ms = int(time.time() * 1000)
    start_ms = now_ms - lookback_days * 86_400_000
    resp = requests.post(
        HL_REST_URL,
        json={
            "type": "candleSnapshot",
            "req": {"coin": coin, "interval": hl_int,
                    "startTime": start_ms, "endTime": now_ms},
        },
        timeout=15,
    )
    resp.raise_for_status()
    rows = resp.json() or []
    out: list[dict] = []
    for r in rows:
        out.append({
            "time":   int(r["t"]) // 1000,   # ms → s
            "open":   float(r["o"]),
            "high":   float(r["h"]),
            "low":    float(r["l"]),
            "close":  float(r["c"]),
            "volume": float(r["v"]),
        })
    return out


def get_candles(source: str, symbol: str, interval: str) -> list[dict]:
    """Unified candle fetch. source ∈ {crypto, us, india}."""
    if source == "crypto":
        return get_hyperliquid_candles(symbol.strip().upper(), interval)
    sym = symbol.strip().upper()
    if source == "india" and not sym.endswith(".NS"):
        sym = sym + ".NS"
    return get_yfinance_candles(sym, interval)


def candles_to_df(candles: list[dict]) -> pd.DataFrame:
    """Normalise a [{time,open,high,low,close,volume}] list to a backtesting.py DF."""
    if not candles:
        return pd.DataFrame()
    df = pd.DataFrame(candles)
    df["dt"] = pd.to_datetime(df["time"], unit="s")
    df = df.set_index("dt").sort_index()
    df = df.rename(columns={
        "open": "Open", "high": "High", "low": "Low",
        "close": "Close", "volume": "Volume",
    })
    df = df[["Open", "High", "Low", "Close", "Volume"]].dropna()
    df = df[~df.index.duplicated(keep="last")]
    return df


def get_ohlc_df(source: str, symbol: str, interval: str) -> pd.DataFrame:
    """Fetch + normalise in one call."""
    return candles_to_df(get_candles(source, symbol, interval))
