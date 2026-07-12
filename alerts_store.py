"""Thread-safe persistence layer for server-side alerts.

Alerts live in `alerts.json` next to app.py. All access is gated by a single
re-entrant lock; the cache is invalidated on every write so concurrent reads
always see the latest state.

Alert shape (compatible with the existing browser-side schema):
{
    "id":            "al_xxxxxxxx",
    "source":        "crypto" | "us" | "india",
    "rawSymbol":     "BTC",
    "resolvedSymbol":"BTC",       # crypto: same; india: with .NS suffix
    "type":          "price_above" | "price_below" | "pct_move" |
                     "rsi_above" | "rsi_below" |
                     "macd_bull" | "macd_bear" |
                     "price_above_sma50" | "price_below_sma50",
    "value":         <number or null>,
    "period":        <number or null>,   # pct_move lookback bars
    "interval":      "1h" | "1d" | ...,  # which candle interval to evaluate on
    "enabled":       true,
    "repeating":     false,
    "cooldownMs":    300000,
    "firedAt":       null,
    "lastError":     null,
    "createdAt":     <unix-ms>,
}
"""
from __future__ import annotations

import json
import os
import secrets
import threading
import time
from typing import Any

ALERTS_FILE = os.path.join(os.path.dirname(os.path.abspath(__file__)), "alerts.json")

_lock = threading.RLock()
_cache: list[dict[str, Any]] | None = None


def _load_locked() -> list[dict[str, Any]]:
    global _cache
    if _cache is not None:
        return _cache
    try:
        with open(ALERTS_FILE, "r", encoding="utf-8") as f:
            data = json.load(f)
        _cache = data if isinstance(data, list) else []
    except (FileNotFoundError, json.JSONDecodeError):
        _cache = []
    return _cache


def _save_locked(data: list[dict[str, Any]]) -> None:
    global _cache
    tmp = ALERTS_FILE + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2, default=str)
    os.replace(tmp, ALERTS_FILE)
    _cache = data


def _new_id() -> str:
    return "al_" + secrets.token_hex(4)


def all_alerts() -> list[dict[str, Any]]:
    """Return a copy of all alerts. Safe to iterate without further locking."""
    with _lock:
        return list(_load_locked())


def add_alert(spec: dict[str, Any]) -> dict[str, Any]:
    with _lock:
        data = _load_locked()
        alert: dict[str, Any] = {
            "id":            _new_id(),
            "source":        spec.get("source", "us"),
            "rawSymbol":     (spec.get("rawSymbol") or "").strip().upper(),
            "resolvedSymbol":(spec.get("resolvedSymbol") or "").strip().upper(),
            "type":          spec.get("type"),
            "value":         spec.get("value"),
            "period":        spec.get("period"),
            "interval":      spec.get("interval") or _default_interval(spec.get("source", "us")),
            "enabled":       True,
            "repeating":     bool(spec.get("repeating", False)),
            "cooldownMs":    int(spec.get("cooldownMs") or 5 * 60 * 1000),
            "firedAt":       None,
            "lastError":     None,
            "createdAt":     int(time.time() * 1000),
        }
        data.append(alert)
        _save_locked(data)
        return alert


def delete_alert(alert_id: str) -> bool:
    with _lock:
        data = _load_locked()
        new_data = [a for a in data if a.get("id") != alert_id]
        if len(new_data) == len(data):
            return False
        _save_locked(new_data)
        return True


def update_alert(alert_id: str, updates: dict[str, Any]) -> dict[str, Any] | None:
    with _lock:
        data = _load_locked()
        for i, a in enumerate(data):
            if a.get("id") == alert_id:
                a.update(updates)
                data[i] = a
                _save_locked(data)
                return a
    return None


def _default_interval(source: str) -> str:
    # Crypto can poll cheaply at 1h; stocks default to 1d because yfinance
    # rate-limits aggressively on intraday intervals from cloud IPs.
    return "1h" if source == "crypto" else "1d"
