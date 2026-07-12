"""
Flask backend — bridges yfinance into the browser.
Run:  python app.py
Then open http://127.0.0.1:5000
"""

from __future__ import annotations

import json
import os
import threading
import time

import requests
from dotenv import load_dotenv
from flask import Flask, jsonify, render_template, request
from flask_cors import CORS

from data_source import (
    DATA_SOURCE, INDIAN_STOCKS, US_STOCKS, CRYPTO_SYMBOLS, TIMEFRAMES,
    INDIAN_STOCKS_NAMES, US_STOCKS_NAMES,
    get_yfinance_news,
)
from alerts_store  import all_alerts, add_alert, delete_alert
from alerts_worker import start_worker
from pulse_data    import PULSE
import pulse_builder
from pulse_scheduler import start_pulse_scheduler

load_dotenv()  # reads .env in project root if present

TELEGRAM_BOT_TOKEN = os.environ.get("TELEGRAM_BOT_TOKEN", "").strip()
TELEGRAM_CHAT_ID   = os.environ.get("TELEGRAM_CHAT_ID",   "").strip()

app = Flask(__name__)
CORS(app)

# ── Simple TTL cache (avoids hammering yfinance on every keystroke) ───────────

_cache: dict[str, tuple[list, float]] = {}
_cache_lock = threading.Lock()
_CACHE_TTL = 30  # seconds

# News cache — longer TTL since headlines change much less often than prices
_news_cache: dict[str, tuple[list, float]] = {}
_news_cache_lock = threading.Lock()
_NEWS_CACHE_TTL = 300  # 5 minutes


def _cached_news(symbol: str) -> list:
    with _news_cache_lock:
        if symbol in _news_cache:
            data, ts = _news_cache[symbol]
            if time.time() - ts < _NEWS_CACHE_TTL:
                return data
    data = get_yfinance_news(symbol)
    with _news_cache_lock:
        _news_cache[symbol] = (data, time.time())
    return data


def _cached_candles(symbol: str, interval: str) -> list:
    key = f"{symbol}:{interval}"
    with _cache_lock:
        if key in _cache:
            data, ts = _cache[key]
            if time.time() - ts < _CACHE_TTL:
                return data

    data = DATA_SOURCE["get_candles"](symbol, interval)

    with _cache_lock:
        _cache[key] = (data, time.time())
    return data


# ── Routes ────────────────────────────────────────────────────────────────────

@app.route("/")
def index():
    return render_template(
        "index.html",
        indian_stocks=INDIAN_STOCKS,
        us_stocks=US_STOCKS,
        crypto_symbols=CRYPTO_SYMBOLS,
        timeframes=TIMEFRAMES,
        indian_stocks_names=INDIAN_STOCKS_NAMES,
        us_stocks_names=US_STOCKS_NAMES,
    )


@app.route("/pulse")
@app.route("/pulse/<slug>")
def pulse(slug: str | None = None):
    # Prefer a built report (parsed doc + live sectors); fall back to the
    # static July-1 snapshot in pulse_data so the page always renders.
    data = pulse_builder.load(slug) or (None if slug else PULSE)
    if data is None:
        # requested a specific date we don't have — show latest instead
        data = pulse_builder.load(None) or PULSE
    return render_template(
        "pulse.html",
        pulse=data,
        pulse_json=json.dumps(data),
        archive=pulse_builder.available_dates(),
        current=slug,
    )


@app.route("/api/pulse/live")
def pulse_live():
    """Fast-refreshing numbers the page polls in place (no full rebuild)."""
    import pulse_sources
    out: dict = {"ok": True, "time": time.strftime("%Y-%m-%d %H:%M:%S")}
    q = pulse_sources.fetch_quote("SPY")
    if q:
        out["spy"] = q["price"]
        out["change_pct"] = q["change_pct"]
    fg = pulse_sources.fetch_fear_greed()
    if fg:
        out["fear_greed"] = round(fg["score"])
    return jsonify(out)


@app.route("/api/pulse/rebuild", methods=["POST", "GET"])
def pulse_rebuild():
    """Rebuild the latest report from the newest Downloads doc + live data."""
    try:
        data = pulse_builder.build(live=True)
        pulse_builder.save(data)
        return jsonify({"ok": True, "date": (data.get("meta") or {}).get("date"),
                        "sectors_live": data.get("sectors_live", False)})
    except Exception as exc:
        return jsonify({"ok": False, "error": str(exc)}), 500


@app.route("/api/candles")
def candles():
    symbol   = request.args.get("symbol",   "RELIANCE.NS")
    interval = request.args.get("interval", "1d")
    try:
        data = _cached_candles(symbol, interval)
        return jsonify({"ok": True, "data": data})
    except Exception as exc:
        return jsonify({"ok": False, "error": str(exc)}), 500


@app.route("/api/price")
def price():
    symbol = request.args.get("symbol", "RELIANCE.NS")
    try:
        p = DATA_SOURCE["get_price"](symbol)
        return jsonify({"ok": True, "price": p})
    except Exception as exc:
        return jsonify({"ok": False, "error": str(exc)}), 500


@app.route("/api/news")
def news():
    symbol = request.args.get("symbol", "").strip()
    source = request.args.get("source", "us")
    if source == "crypto":
        return jsonify({
            "ok": True, "items": [],
            "info": "News headlines aren't wired up for crypto symbols yet — Hyperliquid doesn't have a news endpoint.",
        })
    if not symbol:
        return jsonify({"ok": False, "error": "missing symbol"}), 400
    try:
        items = _cached_news(symbol)
        return jsonify({"ok": True, "items": items})
    except Exception as exc:
        return jsonify({"ok": False, "error": str(exc)}), 500


@app.route("/api/symbols")
def symbols():
    return jsonify({
        "indian":       INDIAN_STOCKS,
        "us":           US_STOCKS,
        "crypto":       CRYPTO_SYMBOLS,
        "timeframes":   TIMEFRAMES,
        "indian_names": INDIAN_STOCKS_NAMES,
        "us_names":     US_STOCKS_NAMES,
    })


# ── Telegram alert proxy ─────────────────────────────────────────────────────

def _send_telegram(text: str) -> tuple[bool, str]:
    if not TELEGRAM_BOT_TOKEN or not TELEGRAM_CHAT_ID:
        return False, "TELEGRAM_BOT_TOKEN or TELEGRAM_CHAT_ID missing in .env"
    try:
        r = requests.post(
            f"https://api.telegram.org/bot{TELEGRAM_BOT_TOKEN}/sendMessage",
            json={"chat_id": TELEGRAM_CHAT_ID, "text": text, "parse_mode": "HTML"},
            timeout=8,
        )
        if r.status_code == 200:
            return True, "ok"
        return False, f"telegram returned {r.status_code}: {r.text[:200]}"
    except Exception as exc:
        return False, str(exc)


@app.route("/api/notify", methods=["POST"])
def notify():
    text = (request.get_json(silent=True) or {}).get("text", "").strip()
    if not text:
        return jsonify({"ok": False, "error": "missing text"}), 400
    ok, info = _send_telegram(text)
    return jsonify({"ok": ok, "info": info}), (200 if ok else 500)


@app.route("/api/notify/test")
def notify_test():
    ok, info = _send_telegram("✅ Trading Dashboard — Telegram alerts are working.")
    return jsonify({"ok": ok, "info": info, "configured": bool(TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID)})


@app.route("/api/notify/status")
def notify_status():
    return jsonify({"configured": bool(TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID)})


# ── Server-side alerts (24/7 — fires Telegram even with no browser open) ─────

@app.route("/api/alerts", methods=["GET"])
def alerts_list():
    return jsonify({"ok": True, "items": all_alerts()})


@app.route("/api/alerts", methods=["POST"])
def alerts_create():
    body = request.get_json(silent=True) or {}
    if not body.get("rawSymbol") or not body.get("type"):
        return jsonify({"ok": False, "error": "missing rawSymbol or type"}), 400
    alert = add_alert(body)
    return jsonify({"ok": True, "item": alert})


@app.route("/api/alerts/<alert_id>", methods=["DELETE"])
def alerts_delete(alert_id: str):
    removed = delete_alert(alert_id)
    return jsonify({"ok": removed})


# Spin up the background polling worker exactly once. With use_reloader=False
# this fires on the only process; with the reloader on, Werkzeug forks twice
# and you'd get two workers — we deliberately don't use the reloader.
start_worker()

# Auto-rebuild the Market Pulse report daily (and on boot if it's stale) so the
# live sections refresh without a manual click. Safe with use_reloader=False.
start_pulse_scheduler()


# ── Entry point ───────────────────────────────────────────────────────────────

if __name__ == "__main__":
    print("\n  Trading Dashboard -> http://127.0.0.1:5000\n")
    app.run(debug=True, port=5000, use_reloader=False)
