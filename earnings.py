"""
Earnings calendar (v2 backlog) — upcoming earnings dates + last surprise, from
yfinance (no API key). Symbols are fetched concurrently so a watchlist-sized
scan stays fast.
"""

from __future__ import annotations

import math
from concurrent.futures import ThreadPoolExecutor

import pandas as pd
import yfinance as yf


def _f(x):
    try:
        v = float(x)
        return None if math.isnan(v) else round(v, 4)
    except (TypeError, ValueError):
        return None


def _naive_utc(ts) -> pd.Timestamp:
    ts = pd.Timestamp(ts)
    if ts.tzinfo is not None:
        ts = ts.tz_convert("UTC").tz_localize(None)
    return ts


def _one(symbol: str) -> dict:
    sym = symbol.strip().upper()
    out = {"symbol": sym, "next": None, "last": None}
    try:
        ed = yf.Ticker(sym).get_earnings_dates(limit=16)
    except Exception:
        ed = None
    if ed is None or not len(ed):
        return out

    now = _naive_utc(pd.Timestamp.now(tz="UTC"))
    fut, past = [], []
    for dt, row in ed.iterrows():
        d = _naive_utc(dt)
        rec = {
            "date": d.strftime("%Y-%m-%d"),
            "ts": int(d.timestamp()),
            "epsEst": _f(row.get("EPS Estimate")),
            "epsAct": _f(row.get("Reported EPS")),
            "surprisePct": _f(row.get("Surprise(%)")),
        }
        (fut if d >= now else past).append((d, rec))

    if fut:
        fut.sort(key=lambda x: x[0])
        d, rec = fut[0]
        rec["daysUntil"] = (d - now).days
        out["next"] = rec
    if past:
        past.sort(key=lambda x: x[0], reverse=True)
        out["last"] = past[0][1]
    return out


def upcoming(symbols: list[str]) -> list[dict]:
    syms = [s.strip().upper() for s in (symbols or []) if s and s.strip()][:25]
    if not syms:
        return []
    with ThreadPoolExecutor(max_workers=8) as ex:
        results = list(ex.map(_one, syms))
    with_next = sorted((r for r in results if r.get("next")), key=lambda r: r["next"]["ts"])
    no_next = [r for r in results if not r.get("next")]
    return with_next + no_next
