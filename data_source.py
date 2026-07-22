"""
Pluggable data source — swap DATA_SOURCE to connect a different broker.

To add Alpaca / Binance / Zerodha / Polygon / etc., implement:
    get_candles(symbol: str, interval: str) -> list[dict]
    get_price(symbol: str)                 -> float | None

…then reassign DATA_SOURCE at the bottom of this file.
"""

from __future__ import annotations

import requests
import yfinance as yf
import pandas as pd

# ── Interval → lookback period mapping ───────────────────────────────────────

_PERIOD: dict[str, str] = {
    "1m":  "7d",
    "5m":  "60d",
    "15m": "60d",
    "30m": "60d",
    "1h":  "730d",
    "4h":  "730d",  # fetched as 1h and resampled — see get_yfinance_candles
    "1d":  "5y",
    "1wk": "10y",
}

# ── yfinance implementation ───────────────────────────────────────────────────

def get_yfinance_candles(symbol: str, interval: str) -> list[dict]:
    """Return OHLCV candle list from yfinance (Indian stocks, US stocks, ETFs…)."""
    period = _PERIOD.get(interval, "60d")
    # yfinance has no native 4h interval — fetch 1h candles and resample below.
    fetch_interval = "1h" if interval == "4h" else interval
    df = yf.download(
        symbol,
        period=period,
        interval=fetch_interval,
        progress=False,
        auto_adjust=True,
        threads=False,
    )
    if df.empty:
        return []

    df = df.dropna()

    # Flatten MultiIndex columns introduced in yfinance ≥ 0.2.x
    if isinstance(df.columns, pd.MultiIndex):
        df.columns = df.columns.get_level_values(0)

    # Aggregate 1h bars into 4h bars when 4h was requested.
    if interval == "4h":
        df = df.resample("4h").agg({
            "Open":   "first",
            "High":   "max",
            "Low":    "min",
            "Close":  "last",
            "Volume": "sum",
        }).dropna()

    candles: list[dict] = []
    for ts, row in df.iterrows():
        # Strip timezone so .timestamp() is consistent
        t = ts.tz_localize(None) if getattr(ts, "tzinfo", None) else ts
        candles.append({
            "time":   int(t.timestamp()),
            "open":   round(float(row["Open"]),   4),
            "high":   round(float(row["High"]),   4),
            "low":    round(float(row["Low"]),    4),
            "close":  round(float(row["Close"]),  4),
            "volume": round(float(row["Volume"]), 2),
        })
    return candles


def get_yfinance_news(symbol: str) -> list[dict]:
    """Return recent news headlines for a symbol via yfinance.
    Defensive against yfinance's occasionally-changing news shape — tries multiple
    key paths and skips items missing a title or link.
    """
    try:
        items = yf.Ticker(symbol).news or []
    except Exception:
        return []
    out: list[dict] = []
    for n in items:
        content = n.get("content") or {}
        title     = n.get("title")            or content.get("title")
        link      = n.get("link")             or (content.get("canonicalUrl") or {}).get("url")
        publisher = n.get("publisher")        or (content.get("provider")     or {}).get("displayName")
        ts        = n.get("providerPublishTime") or n.get("provider_publish_time")
        if ts is None:
            pub_date = content.get("pubDate")
            if pub_date:
                try:
                    from datetime import datetime
                    ts = int(datetime.fromisoformat(pub_date.replace("Z", "+00:00")).timestamp())
                except Exception:
                    ts = None
        if not title or not link:
            continue
        out.append({
            "title":     title,
            "publisher": publisher or "Yahoo Finance",
            "link":      link,
            "time":      ts or 0,
        })
    out.sort(key=lambda x: x["time"], reverse=True)
    return out


def get_yfinance_price(symbol: str) -> float | None:
    """Return the latest trade price for a yfinance symbol."""
    try:
        return float(yf.Ticker(symbol).fast_info.last_price)
    except Exception:
        return None


# ── Symbol lists ──────────────────────────────────────────────────────────────

INDIAN_STOCKS: list[str] = [
    "RELIANCE.NS", "TCS.NS", "HDFCBANK.NS", "INFY.NS", "ICICIBANK.NS",
    "HINDUNILVR.NS", "SBIN.NS", "BAJFINANCE.NS", "BHARTIARTL.NS", "KOTAKBANK.NS",
    "WIPRO.NS", "AXISBANK.NS", "ASIANPAINT.NS", "MARUTI.NS", "TITAN.NS",
    "SUNPHARMA.NS", "ULTRACEMCO.NS", "NESTLEIND.NS", "TECHM.NS", "POWERGRID.NS",
    "LTIM.NS", "HCLTECH.NS", "ONGC.NS", "COALINDIA.NS", "NTPC.NS",
    "ADANIENT.NS", "ADANIPORTS.NS", "JSWSTEEL.NS", "TATASTEEL.NS", "M&M.NS",
]

# Company names — used to render "TICKER — Company Name" entries in the symbol
# datalist so users can pick by either ticker or company name.
INDIAN_STOCKS_NAMES: dict[str, str] = {
    "RELIANCE.NS":   "Reliance Industries",
    "TCS.NS":        "Tata Consultancy Services",
    "HDFCBANK.NS":   "HDFC Bank",
    "INFY.NS":       "Infosys",
    "ICICIBANK.NS":  "ICICI Bank",
    "HINDUNILVR.NS": "Hindustan Unilever",
    "SBIN.NS":       "State Bank of India",
    "BAJFINANCE.NS": "Bajaj Finance",
    "BHARTIARTL.NS": "Bharti Airtel",
    "KOTAKBANK.NS":  "Kotak Mahindra Bank",
    "WIPRO.NS":      "Wipro",
    "AXISBANK.NS":   "Axis Bank",
    "ASIANPAINT.NS": "Asian Paints",
    "MARUTI.NS":     "Maruti Suzuki",
    "TITAN.NS":      "Titan Company",
    "SUNPHARMA.NS":  "Sun Pharmaceutical",
    "ULTRACEMCO.NS": "UltraTech Cement",
    "NESTLEIND.NS":  "Nestle India",
    "TECHM.NS":      "Tech Mahindra",
    "POWERGRID.NS":  "Power Grid Corp",
    "LTIM.NS":       "LTIMindtree",
    "HCLTECH.NS":    "HCL Technologies",
    "ONGC.NS":       "Oil & Natural Gas Corp",
    "COALINDIA.NS":  "Coal India",
    "NTPC.NS":       "NTPC Limited",
    "ADANIENT.NS":   "Adani Enterprises",
    "ADANIPORTS.NS": "Adani Ports",
    "JSWSTEEL.NS":   "JSW Steel",
    "TATASTEEL.NS":  "Tata Steel",
    "M&M.NS":        "Mahindra & Mahindra",
}

US_STOCKS: list[str] = [
    "AAPL", "MSFT", "GOOGL", "AMZN", "NVDA", "META", "TSLA", "BRK-B",
    "JPM", "V", "UNH", "JNJ", "WMT", "MA", "PG", "HD", "XOM", "CVX",
    "KO", "PEP", "ABBV", "MRK", "COST", "AVGO", "LLY", "ADBE", "CRM",
    "AMD", "NFLX", "INTC", "CSCO", "QCOM", "TXN", "ORCL", "IBM",
    "DIS", "NKE", "BA", "CAT", "GS", "MS", "PYPL", "SQ", "UBER", "ABNB",
    "COIN", "RIVN", "PLTR", "SNOW", "SOFI",
]

US_STOCKS_NAMES: dict[str, str] = {
    "AAPL":  "Apple",
    "MSFT":  "Microsoft",
    "GOOGL": "Alphabet (Google)",
    "AMZN":  "Amazon",
    "NVDA":  "NVIDIA",
    "META":  "Meta Platforms",
    "TSLA":  "Tesla",
    "BRK-B": "Berkshire Hathaway",
    "JPM":   "JPMorgan Chase",
    "V":     "Visa",
    "UNH":   "UnitedHealth",
    "JNJ":   "Johnson & Johnson",
    "WMT":   "Walmart",
    "MA":    "Mastercard",
    "PG":    "Procter & Gamble",
    "HD":    "Home Depot",
    "XOM":   "Exxon Mobil",
    "CVX":   "Chevron",
    "KO":    "Coca-Cola",
    "PEP":   "PepsiCo",
    "ABBV":  "AbbVie",
    "MRK":   "Merck",
    "COST":  "Costco",
    "AVGO":  "Broadcom",
    "LLY":   "Eli Lilly",
    "ADBE":  "Adobe",
    "CRM":   "Salesforce",
    "AMD":   "AMD",
    "NFLX":  "Netflix",
    "INTC":  "Intel",
    "CSCO":  "Cisco",
    "QCOM":  "Qualcomm",
    "TXN":   "Texas Instruments",
    "ORCL":  "Oracle",
    "IBM":   "IBM",
    "DIS":   "Disney",
    "NKE":   "Nike",
    "BA":    "Boeing",
    "CAT":   "Caterpillar",
    "GS":    "Goldman Sachs",
    "MS":    "Morgan Stanley",
    "PYPL":  "PayPal",
    "SQ":    "Block (Square)",
    "UBER":  "Uber",
    "ABNB":  "Airbnb",
    "COIN":  "Coinbase",
    "RIVN":  "Rivian",
    "PLTR":  "Palantir",
    "SNOW":  "Snowflake",
    "SOFI":  "SoFi",
}

def _fetch_hyperliquid_symbols() -> list[str]:
    """Fetch the full symbol universe from Hyperliquid's meta endpoint."""
    _FALLBACK = [
        "BTC", "ETH", "SOL", "ARB", "AVAX", "BNB", "DOGE", "MATIC", "LINK",
        "UNI", "AAVE", "CRV", "GMX", "OP", "APT", "SUI", "WIF", "PEPE", "TIA", "INJ",
        "FET", "RUNE", "ATOM", "DOT", "ADA", "XRP", "LTC", "BCH", "FIL", "NEAR",
    ]
    try:
        resp = requests.post(
            "https://api.hyperliquid.xyz/info",
            json={"type": "meta"},
            timeout=10,
        )
        resp.raise_for_status()
        data = resp.json()
        universe = data.get("universe", [])
        symbols = sorted([coin["name"] for coin in universe])
        return symbols if symbols else _FALLBACK
    except Exception as exc:
        print(f"[data_source] Hyperliquid meta fetch failed ({exc}), using fallback list")
        return _FALLBACK


CRYPTO_SYMBOLS: list[str] = _fetch_hyperliquid_symbols()

TIMEFRAMES: list[str] = ["1m", "5m", "15m", "30m", "1h", "4h", "1d", "1wk"]


# ── Coinbase (Coinbase Exchange public market data — no API key) ─────────────
# A second crypto source alongside Hyperliquid, routed server-side through
# /api/candles (avoids browser CORS). Coinbase only serves 1m/5m/15m/1h/6h/1d
# natively, so 30m / 4h / 1wk are resampled from a finer granularity.

_COINBASE_URL = "https://api.exchange.coinbase.com"
_COINBASE_HDR = {"User-Agent": "TradingDashboard/1.0", "Accept": "application/json"}

_COINBASE_GRAN: dict[str, tuple[int, str | None]] = {
    "1m": (60, None),   "5m": (300, None),  "15m": (900, None),
    "30m": (900, "30min"), "1h": (3600, None), "4h": (3600, "4h"),
    "1d": (86400, None), "1wk": (86400, "1W"),
}

COINBASE_SYMBOLS: list[str] = [
    "BTC-USD", "ETH-USD", "SOL-USD", "XRP-USD", "DOGE-USD", "ADA-USD", "AVAX-USD",
    "LINK-USD", "DOT-USD", "MATIC-USD", "LTC-USD", "BCH-USD", "UNI-USD", "ATOM-USD",
    "XLM-USD", "ETC-USD", "APT-USD", "ARB-USD", "OP-USD", "AAVE-USD", "MKR-USD",
    "CRV-USD", "SUI-USD", "NEAR-USD", "INJ-USD", "FIL-USD", "ALGO-USD", "GRT-USD",
    "SHIB-USD", "PEPE-USD", "SAND-USD", "IMX-USD", "HBAR-USD", "STX-USD", "LDO-USD",
]


def _resample_candles(candles: list[dict], rule: str) -> list[dict]:
    """Aggregate a candle list into a coarser interval (e.g. 1h → 4h)."""
    if not candles:
        return candles
    df = pd.DataFrame(candles)
    df.index = pd.to_datetime(df["time"], unit="s")
    agg = df.resample(rule).agg({
        "open": "first", "high": "max", "low": "min", "close": "last", "volume": "sum",
    }).dropna()
    return [
        {"time": int(ts.timestamp()), "open": float(r.open), "high": float(r.high),
         "low": float(r.low), "close": float(r.close), "volume": float(r.volume)}
        for ts, r in agg.iterrows()
    ]


def get_coinbase_candles(product: str, interval: str) -> list[dict]:
    """OHLCV from Coinbase Exchange (product like 'BTC-USD'). ~300 bars/request."""
    gran, resample = _COINBASE_GRAN.get(interval, (3600, None))
    r = requests.get(f"{_COINBASE_URL}/products/{product}/candles",
                     params={"granularity": gran}, headers=_COINBASE_HDR, timeout=12)
    r.raise_for_status()
    rows = r.json() or []
    # Coinbase row order is [time, low, high, open, close, volume], newest first.
    candles = [
        {"time": int(t), "open": float(op), "high": float(hi),
         "low": float(lo), "close": float(cl), "volume": float(vol)}
        for t, lo, hi, op, cl, vol in rows
    ]
    candles.sort(key=lambda c: c["time"])
    return _resample_candles(candles, resample) if resample else candles


def get_coinbase_price(product: str) -> float | None:
    try:
        r = requests.get(f"{_COINBASE_URL}/products/{product}/ticker",
                         headers=_COINBASE_HDR, timeout=8)
        r.raise_for_status()
        return float(r.json()["price"])
    except Exception:
        return None


# ── Active data source (swap here to change broker) ───────────────────────────
#
# Example — to plug in Alpaca:
#   from alpaca_source import get_alpaca_candles, get_alpaca_price
#   DATA_SOURCE = {"get_candles": get_alpaca_candles, "get_price": get_alpaca_price}

DATA_SOURCE: dict = {
    "get_candles": get_yfinance_candles,
    "get_price":   get_yfinance_price,
}
