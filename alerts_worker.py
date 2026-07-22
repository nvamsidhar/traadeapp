"""Background worker that polls active alerts and fires Telegram notifications.

Runs forever in a daemon thread started from app.py. Every POLL_INTERVAL seconds:
  - Loads the current alert list from alerts_store
  - For each ENABLED alert that isn't in cooldown:
      - Fetches the latest candles for (source, symbol, interval) — cached briefly
      - Evaluates the alert's condition
      - If triggered, marks firedAt and POSTs a Telegram message via app._send_telegram

The worker does its own per-(source, symbol, interval) candle cache (~15s TTL)
so multiple alerts on the same symbol don't trigger redundant fetches.
"""
from __future__ import annotations

import threading
import time
from typing import Any

import requests

from alerts_store import all_alerts, update_alert

POLL_INTERVAL = 30                  # seconds between polling iterations
_CANDLE_CACHE_TTL = 15              # seconds

_thread: threading.Thread | None = None
_stop_event = threading.Event()

_candle_cache: dict[str, tuple[list, float]] = {}
_candle_cache_lock = threading.Lock()


# ── Candle fetching ────────────────────────────────────────────────────────────

_HL_LOOKBACK_DAYS = {
    "1m": 1, "5m": 3, "15m": 7, "30m": 14,
    "1h": 30, "4h": 60, "1d": 180, "1wk": 365,
}


def _fetch_hl_candles(coin: str, interval: str) -> list[dict]:
    """Hyperliquid REST candleSnapshot for server-side crypto polling."""
    days = _HL_LOOKBACK_DAYS.get(interval, 30)
    now_ms = int(time.time() * 1000)
    start_ms = now_ms - days * 86400_000
    try:
        r = requests.post(
            "https://api.hyperliquid.xyz/info",
            json={
                "type": "candleSnapshot",
                "req":  {"coin": coin, "interval": interval, "startTime": start_ms, "endTime": now_ms},
            },
            timeout=8,
        )
        if r.status_code != 200:
            return []
        arr = r.json() or []
        out = []
        for c in arr:
            if not c.get("t"):
                continue
            out.append({
                "time":   int(int(c["t"]) / 1000),
                "open":   float(c["o"]),
                "high":   float(c["h"]),
                "low":    float(c["l"]),
                "close":  float(c["c"]),
                "volume": float(c.get("v", 0)),
            })
        return out
    except Exception:
        return []


def _fetch_candles(source: str, symbol: str, interval: str) -> list[dict]:
    """Source-dispatching candle fetch with a short TTL cache."""
    key = f"{source}:{symbol}:{interval}"
    with _candle_cache_lock:
        cached = _candle_cache.get(key)
        if cached and time.time() - cached[1] < _CANDLE_CACHE_TTL:
            return cached[0]
    try:
        if source == "crypto":
            data = _fetch_hl_candles(symbol, interval)
        elif source == "coinbase":
            from data_source import get_coinbase_candles
            data = get_coinbase_candles(symbol, interval) or []
        else:
            # Lazy import to avoid circular references at module load
            from data_source import DATA_SOURCE
            data = DATA_SOURCE["get_candles"](symbol, interval) or []
    except Exception:
        data = []
    with _candle_cache_lock:
        _candle_cache[key] = (data, time.time())
    return data


# ── Indicator math (Python ports of the JS calc functions) ─────────────────────

def _ema(closes: list[float], period: int) -> list[float | None]:
    n = len(closes)
    if n < period:
        return [None] * n
    out: list[float | None] = [None] * (period - 1)
    sma = sum(closes[:period]) / period
    out.append(sma)
    prev = sma
    k = 2 / (period + 1)
    for v in closes[period:]:
        prev = v * k + prev * (1 - k)
        out.append(prev)
    return out


def _rsi(candles: list[dict], period: int = 14) -> list[float | None]:
    closes = [c["close"] for c in candles]
    n = len(closes)
    if n < period + 1:
        return [None] * n
    gain = sum(max(closes[i] - closes[i - 1], 0) for i in range(1, period + 1))
    loss = sum(max(closes[i - 1] - closes[i], 0) for i in range(1, period + 1))
    avg_g = gain / period
    avg_l = loss / period
    out: list[float | None] = [None] * period
    out.append(100 - 100 / (1 + (avg_g / (avg_l or 1e-12))))
    for i in range(period + 1, n):
        ch = closes[i] - closes[i - 1]
        g = max(ch, 0)
        l = max(-ch, 0)
        avg_g = (avg_g * (period - 1) + g) / period
        avg_l = (avg_l * (period - 1) + l) / period
        out.append(100 - 100 / (1 + (avg_g / (avg_l or 1e-12))))
    return out


def _macd(candles: list[dict], fast: int = 12, slow: int = 26, signal: int = 9):
    closes = [c["close"] for c in candles]
    ef = _ema(closes, fast)
    es = _ema(closes, slow)
    line = [
        (ef[i] - es[i]) if (ef[i] is not None and es[i] is not None) else None
        for i in range(len(closes))
    ]
    sig_input = [v if v is not None else 0 for v in line]
    sig = _ema(sig_input, signal)
    return line, sig


def _sma(candles: list[dict], period: int = 50) -> list[float | None]:
    closes = [c["close"] for c in candles]
    n = len(closes)
    if n < period:
        return [None] * n
    out: list[float | None] = [None] * (period - 1)
    for i in range(period - 1, n):
        out.append(sum(closes[i - period + 1: i + 1]) / period)
    return out


def _crossed(prev: float | None, cur: float | None, level: float, direction: str) -> bool:
    if prev is None or cur is None:
        return False
    if direction == "above":
        return prev <= level and cur > level
    if direction == "below":
        return prev >= level and cur < level
    return False


# ── Condition evaluation ──────────────────────────────────────────────────────

def _evaluate(alert: dict[str, Any], candles: list[dict]) -> tuple[bool, float]:
    """Returns (triggered, current_price)."""
    if len(candles) < 2:
        return False, 0.0
    t = alert.get("type", "")
    val_raw = alert.get("value")
    val = float(val_raw) if val_raw is not None else 0.0
    last = candles[-1]
    prev = candles[-2]
    cur_px = float(last["close"])
    prev_px = float(prev["close"])

    if t == "price_above":
        return _crossed(prev_px, cur_px, val, "above"), cur_px
    if t == "price_below":
        return _crossed(prev_px, cur_px, val, "below"), cur_px

    if t == "pct_move":
        n = max(1, int(alert.get("period") or 5))
        if len(candles) <= n:
            return False, cur_px
        ref = candles[-1 - n]["close"]
        if not ref:
            return False, cur_px
        pct = abs((cur_px - ref) / ref) * 100
        prev_ref = candles[-2 - n]["close"] if len(candles) > n + 1 else ref
        prev_pct = abs((prev_px - prev_ref) / prev_ref) * 100 if prev_ref else 0
        return (prev_pct < val and pct >= val), cur_px

    if t in ("rsi_above", "rsi_below"):
        r = _rsi(candles, 14)
        if len(r) < 2 or r[-1] is None or r[-2] is None:
            return False, cur_px
        return _crossed(r[-2], r[-1], val, "above" if t == "rsi_above" else "below"), cur_px

    if t in ("macd_bull", "macd_bear"):
        line, sig = _macd(candles)
        if len(line) < 2 or line[-1] is None or line[-2] is None or sig[-1] is None or sig[-2] is None:
            return False, cur_px
        l_p, l_c = line[-2], line[-1]
        s_p, s_c = sig[-2], sig[-1]
        if t == "macd_bull":
            return (l_p <= s_p and l_c > s_c), cur_px
        else:
            return (l_p >= s_p and l_c < s_c), cur_px

    if t in ("price_above_sma50", "price_below_sma50"):
        sm = _sma(candles, 50)
        if len(sm) < 2 or sm[-1] is None or sm[-2] is None:
            return False, cur_px
        if t == "price_above_sma50":
            return (prev_px <= sm[-2] and cur_px > sm[-1]), cur_px
        else:
            return (prev_px >= sm[-2] and cur_px < sm[-1]), cur_px

    return False, cur_px


def _condition_label(alert: dict[str, Any]) -> str:
    t = alert.get("type", "")
    val = alert.get("value")
    if t == "price_above":       return f"Price > {val}"
    if t == "price_below":       return f"Price < {val}"
    if t == "pct_move":          return f"|Δ%| ≥ {val}% over {alert.get('period', 5)} bars"
    if t == "rsi_above":         return f"RSI(14) crosses above {val}"
    if t == "rsi_below":         return f"RSI(14) crosses below {val}"
    if t == "macd_bull":         return "MACD bullish cross"
    if t == "macd_bear":         return "MACD bearish cross"
    if t == "price_above_sma50": return "Price crosses above SMA 50"
    if t == "price_below_sma50": return "Price crosses below SMA 50"
    return t


# ── Strategy-signal alerts (Backtest Lab → Telegram bridge) ───────────────────

def _strategy_signal(candles: list[dict], strategy: str | None,
                     params: dict | None) -> tuple[str | None, int | None]:
    """Detect a *fresh* Buy/Sell signal on the latest bar for a backtest strategy.

    Mirrors backtest_engine's EMA/SMA/RSI/MACD crossovers so a strategy validated
    in the Backtest Lab fires the same signal live. Returns (direction, bar_time)
    where direction is "BUY" | "SELL" | None.
    """
    closes = [c["close"] for c in candles]
    if len(closes) < 3:
        return None, None
    p = params or {}

    def gi(key: str, default: int) -> int:
        try:
            return int(p.get(key, default))
        except (TypeError, ValueError):
            return default

    strat = (strategy or "ema").lower()
    direction: str | None = None

    if strat in ("ema", "sma"):
        fast_p = gi("fast", 12 if strat == "ema" else 20)
        slow_p = gi("slow", 26 if strat == "ema" else 50)
        fa, sa = (_ema(closes, fast_p), _ema(closes, slow_p)) if strat == "ema" \
            else (_sma(candles, fast_p), _sma(candles, slow_p))
        if None in (fa[-2], fa[-1], sa[-2], sa[-1]):
            return None, None
        if fa[-2] <= sa[-2] and fa[-1] > sa[-1]:
            direction = "BUY"
        elif fa[-2] >= sa[-2] and fa[-1] < sa[-1]:
            direction = "SELL"

    elif strat == "rsi":
        r = _rsi(candles, gi("period", 14))
        if r[-1] is None or r[-2] is None:
            return None, None
        if _crossed(r[-2], r[-1], gi("lower", 30), "below"):
            direction = "BUY"
        elif _crossed(r[-2], r[-1], gi("upper", 70), "above"):
            direction = "SELL"

    elif strat == "macd":
        line, sig = _macd(candles, gi("fast", 12), gi("slow", 26), gi("signal", 9))
        if None in (line[-2], line[-1], sig[-2], sig[-1]):
            return None, None
        if line[-2] <= sig[-2] and line[-1] > sig[-1]:
            direction = "BUY"
        elif line[-2] >= sig[-2] and line[-1] < sig[-1]:
            direction = "SELL"

    return direction, (int(candles[-1]["time"]) if direction else None)


def _strategy_label(alert: dict[str, Any]) -> str:
    s = (alert.get("strategy") or "ema").lower()
    p = alert.get("params") or {}
    if s in ("ema", "sma"):
        return f"{s.upper()} cross ({p.get('fast', '?')}/{p.get('slow', '?')})"
    if s == "rsi":
        return f"RSI({p.get('period', 14)}) {p.get('lower', 30)}/{p.get('upper', 70)}"
    if s == "macd":
        return f"MACD ({p.get('fast', 12)}/{p.get('slow', 26)}/{p.get('signal', 9)})"
    return s


# ── Worker loop ───────────────────────────────────────────────────────────────

def _send_telegram(text: str) -> bool:
    """Lazy import of app's Telegram helper (avoids import-time circularity)."""
    try:
        from app import _send_telegram as send
        ok, _info = send(text)
        return ok
    except Exception:
        return False


def _evaluate_all_once() -> None:
    alerts = all_alerts()
    now_ms = int(time.time() * 1000)
    for alert in alerts:
        if not alert.get("enabled"):
            continue
        fired_at = alert.get("firedAt")
        # Strategy-signal alerts self-dedupe by signal-bar time, so they bypass
        # the firedAt/cooldown gate (they should keep watching for new crosses).
        if fired_at and alert.get("type") != "strategy":
            if not alert.get("repeating"):
                continue
            if now_ms - int(fired_at) < int(alert.get("cooldownMs") or 5 * 60 * 1000):
                continue

        source = alert.get("source", "us")
        resolved = alert.get("resolvedSymbol") or alert.get("rawSymbol")
        if not resolved:
            continue
        interval = alert.get("interval") or ("1h" if source in ("crypto", "coinbase") else "1d")
        candles = _fetch_candles(source, resolved, interval)
        if not candles:
            continue

        # Strategy-signal alerts (Backtest Lab → Telegram): fire once per fresh
        # Buy/Sell cross, deduped by the signal bar's timestamp.
        if alert.get("type") == "strategy":
            try:
                direction, sig_ts = _strategy_signal(candles, alert.get("strategy"), alert.get("params"))
            except Exception as exc:
                update_alert(alert["id"], {"lastError": str(exc)})
                continue
            if direction and sig_ts and sig_ts != alert.get("lastSignalTs"):
                cur_px = float(candles[-1]["close"])
                update_alert(alert["id"], {"lastSignalTs": sig_ts, "firedAt": now_ms, "lastError": None})
                emoji = "🟢" if direction == "BUY" else "🔴"
                msg = (
                    f"{emoji} <b>{alert.get('rawSymbol')}</b> ({source}) — <b>{direction}</b>\n"
                    f"{_strategy_label(alert)} · {interval}\n"
                    f"Price: <b>{cur_px:.6f}</b>"
                )
                if not _send_telegram(msg):
                    update_alert(alert["id"], {"lastError": "telegram send failed"})
            continue

        try:
            triggered, price = _evaluate(alert, candles)
        except Exception as exc:
            update_alert(alert["id"], {"lastError": str(exc)})
            continue

        if not triggered:
            continue

        update_alert(alert["id"], {"firedAt": now_ms, "lastError": None})
        msg = (
            f"🔔 <b>{alert.get('rawSymbol')}</b> ({source})\n"
            f"{_condition_label(alert)}\n"
            f"Price: <b>{price:.6f}</b>"
        )
        if not _send_telegram(msg):
            update_alert(alert["id"], {"lastError": "telegram send failed"})


def _worker_loop() -> None:
    print(f"[alerts_worker] running, polling every {POLL_INTERVAL}s")
    while not _stop_event.is_set():
        try:
            _evaluate_all_once()
        except Exception as exc:
            print(f"[alerts_worker] iteration error: {exc}")
        _stop_event.wait(POLL_INTERVAL)


def start_worker() -> None:
    """Spin up the background polling thread. Idempotent."""
    global _thread
    if _thread and _thread.is_alive():
        return
    _stop_event.clear()
    _thread = threading.Thread(target=_worker_loop, daemon=True, name="alerts_worker")
    _thread.start()


def stop_worker() -> None:
    _stop_event.set()
