"""
Live data sources for the Market Pulse page (Tier 1 — no subscription needed).

    fetch_sectors()     -> Sector Flow table from yfinance (SPY + 11 SPDR sectors)
    fetch_fear_greed()  -> CNN Fear & Greed index (free public endpoint)

These cover the parts of the report that free data can reproduce faithfully.
The options-flow / gamma / darkpool sections come from the daily doc instead
(see pulse_parser.py). Every function degrades gracefully: on any failure it
returns None so the builder can fall back to whatever it already has.
"""

from __future__ import annotations

import math
from datetime import datetime, timedelta, timezone

import requests
import yfinance as yf
import pandas as pd

# SPY first (index reference row), then the 11 SPDR sector ETFs in the same
# order the report lists them.
_SECTOR_TICKERS: list[tuple[str, str]] = [
    ("SPY",  "S&P 500 Index"),
    ("XLC",  "Communication"),
    ("XLF",  "Financials"),
    ("XLY",  "Consumer Disc"),
    ("XLV",  "Health Care"),
    ("XLB",  "Materials"),
    ("XLRE", "Real Estate"),
    ("XLP",  "Consumer Staples"),
    ("XLE",  "Energy"),
    ("XLI",  "Industrials"),
    ("XLU",  "Utilities"),
    ("XLK",  "Technology"),
]


def _fmt_vol(v: float | None) -> str:
    if not v:
        return "—"
    if v >= 1e9:
        return f"{v/1e9:.2f}B"
    if v >= 1e6:
        return f"{v/1e6:.2f}M"
    if v >= 1e3:
        return f"{v/1e3:.1f}K"
    return f"{v:.0f}"


def fetch_sectors() -> list[dict] | None:
    """Return the Sector Flow rows from live yfinance data.

    Each row: {sym, name, price, chg (% day), vol, low (52w), high (52w),
               call_pct}. call_pct is *not* real options data — free feeds
               don't expose call/put premium split — so we leave it at 50 as a
               neutral placeholder; the doc parser overrides it when available.
    """
    symbols = [t for t, _ in _SECTOR_TICKERS]
    try:
        df = yf.download(
            symbols, period="1y", interval="1d",
            group_by="ticker", auto_adjust=False,
            progress=False, threads=True,
        )
    except Exception as exc:
        print(f"[pulse_sources] sector download failed: {exc}")
        return None
    if df is None or df.empty:
        return None

    rows: list[dict] = []
    for sym, name in _SECTOR_TICKERS:
        try:
            sub = df[sym].dropna() if sym in df.columns.get_level_values(0) else None
            if sub is None or sub.empty:
                continue
            close = sub["Close"]
            last = float(close.iloc[-1])
            prev = float(close.iloc[-2]) if len(close) > 1 else last
            chg = (last - prev) / prev * 100 if prev else 0.0
            hi = float(sub["High"].max())
            lo = float(sub["Low"].min())
            vol = float(sub["Volume"].iloc[-1]) if "Volume" in sub else None
            rows.append({
                "sym": sym, "name": name,
                "price": round(last, 2),
                "chg": round(chg, 2),
                "vol": _fmt_vol(vol),
                "low": round(lo, 2), "high": round(hi, 2),
                "call_pct": 50,
            })
        except Exception as exc:
            print(f"[pulse_sources] {sym} parse failed: {exc}")
            continue
    return rows or None


# ── CNN Fear & Greed ─────────────────────────────────────────────────────────
# Public JSON used by CNN's own widget. Needs a browser-like User-Agent.
_CNN_URL = "https://production.datastore.cnn.com/index/fearandgreed/graphdata"
_CNN_HEADERS = {
    "User-Agent": ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
                   "AppleWebKit/537.36 (KHTML, like Gecko) "
                   "Chrome/122.0 Safari/537.36"),
    "Accept": "application/json",
}

# CNN indicator key -> label shown in the report's "Indicator Sentiment" list.
_CNN_INDICATORS = {
    "market_momentum_sp125":  "Market Momentum",
    "stock_price_strength":   "Stock Price Strength",
    "stock_price_breadth":    "Market Breadth",
    "put_call_options":       "Put Call Ratio",
    "market_volatility_vix":  "VIX",
    "junk_bond_demand":       "Junk Bond Demand",
    "safe_haven_demand":      "Safe Haven Demand",
}


def fetch_fear_greed() -> dict | None:
    """Return {score, rating, indicators:[{name,val}]} from CNN, or None."""
    try:
        r = requests.get(_CNN_URL, headers=_CNN_HEADERS, timeout=10)
        r.raise_for_status()
        data = r.json()
    except Exception as exc:
        print(f"[pulse_sources] CNN fear/greed failed: {exc}")
        return None

    fg = data.get("fear_and_greed") or {}
    score = fg.get("score")
    if score is None:
        return None

    indicators: list[dict] = []
    for key, label in _CNN_INDICATORS.items():
        block = data.get(key) or {}
        val = block.get("score") if isinstance(block, dict) else None
        if val is not None:
            indicators.append({"name": label, "val": round(float(val), 1)})

    return {
        "score": round(float(score), 1),
        "rating": fg.get("rating", ""),
        "indicators": indicators,
    }


# ── Live quote ───────────────────────────────────────────────────────────────

def fetch_quote(symbol: str = "SPY") -> dict | None:
    """Return {price, change_pct} from yfinance fast_info, or None."""
    try:
        fi = yf.Ticker(symbol).fast_info
        price = float(fi.last_price)
        prev = float(fi.previous_close)
        chg = (price - prev) / prev * 100 if prev else 0.0
        return {"price": round(price, 2), "change_pct": round(chg, 2)}
    except Exception as exc:
        print(f"[pulse_sources] quote {symbol} failed: {exc}")
        return None


# ── Live gamma exposure (GEX) from the options chain ─────────────────────────
# A standard dealer-gamma estimate: Black-Scholes gamma per contract, summed as
# (calls − puts). It's an *estimate* (assumes the common "dealers long calls /
# short puts" sign convention, flat 4% rate), not broker positioning — but it's
# real, live, options-chain math rather than transcribed numbers.

def _bs_gamma(S: float, K: float, T: float, iv: float, r: float = 0.04) -> float:
    if S <= 0 or K <= 0 or T <= 0 or iv <= 0:
        return 0.0
    d1 = (math.log(S / K) + (r + 0.5 * iv * iv) * T) / (iv * math.sqrt(T))
    pdf = math.exp(-0.5 * d1 * d1) / math.sqrt(2 * math.pi)
    return pdf / (S * iv * math.sqrt(T))


def _fmt_money(v: float) -> str:
    sign = "+" if v >= 0 else "-"
    a = abs(v)
    if a >= 1e9:
        return f"{sign}${a/1e9:.2f}B"
    if a >= 1e6:
        return f"{sign}${a/1e6:.2f}M"
    return f"{sign}${a:,.0f}"


def fetch_gamma(symbol: str = "SPY", n_expiries: int = 3) -> dict | None:
    """Compute live GEX from the nearest option expiries.

    Returns oi/volume gamma ($ per 1% move + net gamma exposure), plus
    call wall / put wall / gamma-flip levels and the resulting regime.
    """
    try:
        t = yf.Ticker(symbol)
        spot = float(t.fast_info.last_price)
        exps = list(t.options)[:n_expiries]
        if not spot or not exps:
            return None
    except Exception as exc:
        print(f"[pulse_sources] gamma init failed: {exc}")
        return None

    now = datetime.now(timezone.utc)
    oi_gex_dollar = oi_gex_shares = 0.0
    vol_gex_dollar = vol_gex_shares = 0.0
    call_oi: dict[float, float] = {}
    put_oi: dict[float, float] = {}
    strike_gex: dict[float, float] = {}       # net $GEX by strike (for flip)
    lo, hi = spot * 0.85, spot * 1.15

    for exp in exps:
        try:
            exp_dt = datetime.strptime(exp, "%Y-%m-%d").replace(tzinfo=timezone.utc)
            T = max((exp_dt - now).days, 0) / 365.0 + 1e-4
            chain = t.option_chain(exp)
        except Exception:
            continue
        for df, sign in ((chain.calls, +1), (chain.puts, -1)):
            for _, row in df.iterrows():
                def _f(x):  # NaN/None-safe float
                    try:
                        x = float(x)
                        return 0.0 if math.isnan(x) else x
                    except (TypeError, ValueError):
                        return 0.0
                K = _f(row["strike"])
                if K < lo or K > hi:
                    continue
                oi = _f(row.get("openInterest"))
                vol = _f(row.get("volume"))
                iv = _f(row.get("impliedVolatility"))
                g = _bs_gamma(spot, K, T, iv)
                if g == 0:
                    continue
                d_oi = sign * g * oi * 100 * spot * spot * 0.01
                s_oi = sign * g * oi * 100
                oi_gex_dollar += d_oi
                oi_gex_shares += s_oi
                vol_gex_dollar += sign * g * vol * 100 * spot * spot * 0.01
                vol_gex_shares += sign * g * vol * 100
                strike_gex[K] = strike_gex.get(K, 0.0) + d_oi
                if sign > 0:
                    call_oi[K] = call_oi.get(K, 0) + oi
                else:
                    put_oi[K] = put_oi.get(K, 0) + oi

    if not strike_gex:
        return None

    call_wall = max(call_oi, key=call_oi.get) if call_oi else None
    put_wall = max(put_oi, key=put_oi.get) if put_oi else None
    # gamma flip: lowest strike at/above which cumulative $GEX turns positive
    flip = None
    cum = 0.0
    for K in sorted(strike_gex):
        cum += strike_gex[K]
        if cum >= 0:
            flip = K
            break

    if flip is None:  # deeply one-sided gamma — approximate flip at spot
        flip = round(spot)

    regime = "Amplifying" if oi_gex_dollar < 0 else "Suppressing"
    out = {
        "oi": {"gpp": _fmt_money(oi_gex_dollar), "nge": f"{oi_gex_shares:,.0f}"},
        "volume": {"gpp": _fmt_money(vol_gex_dollar), "nge": f"{vol_gex_shares:,.0f}"},
        "regime": regime,
        "spot": round(spot, 2),
        "live": True,
    }
    if call_wall:  out["call_wall"] = int(round(call_wall))
    if put_wall:   out["accel_down"] = int(round(put_wall))
    if flip:       out["accel_up"] = int(round(flip))
    return out


# ── Darkpool proxy (FINRA Reg SHO off-exchange volume) ───────────────────────
# FINRA's free daily file aggregates FINRA-reported (off-exchange = dark pool +
# wholesaler) volume per ticker, split by short vs total. It is NOT UW's
# directional net-premium tape — it's a daily proxy: heavy off-exchange names,
# leaned by short-volume ratio (low short% ≈ buying/accumulation, high ≈
# selling/distribution).

_FINRA_URL = "http://cdn.finra.org/equity/regsho/daily/CNMSshvol{d}.txt"
_FINRA_HDR = {"User-Agent": "Mozilla/5.0 (compatible; TradingDashboard/1.0)"}


def fetch_darkpool(top: int = 25, lookback_days: int = 7) -> dict | None:
    """Return {buys, sells, date, proxy} from the latest FINRA Reg SHO file.

    buys/sells are [{sym, val}] where val is off-exchange volume in millions of
    shares; buys lean low-short%, sells lean high-short%.
    """
    text = date_used = None
    for back in range(1, lookback_days + 1):
        d = (datetime.now() - timedelta(days=back)).strftime("%Y%m%d")
        try:
            r = requests.get(_FINRA_URL.format(d=d), headers=_FINRA_HDR, timeout=12)
            if r.status_code == 200 and len(r.text) > 1000:
                text, date_used = r.text, d
                break
        except Exception as exc:
            print(f"[pulse_sources] FINRA {d} failed: {exc}")
    if not text:
        return None

    rows: list[tuple[str, float, float]] = []  # (sym, total_vol, short_ratio)
    for line in text.splitlines()[1:]:
        parts = line.split("|")
        if len(parts) < 5:
            continue
        sym = parts[1].strip()
        try:
            short = float(parts[2])
            total = float(parts[4])
        except ValueError:
            continue
        if not sym or total <= 0 or "." in sym[-2:] or len(sym) > 6:
            continue
        rows.append((sym, total, short / total))

    if not rows:
        return None

    # focus on the liquid, dark-pool-active universe, then split by short lean
    rows.sort(key=lambda x: x[1], reverse=True)
    liquid = rows[:200]
    buys = [(s, v) for s, v, sr in liquid if sr <= 0.45]
    sells = [(s, v) for s, v, sr in liquid if sr >= 0.55]
    buys.sort(key=lambda x: x[1], reverse=True)
    sells.sort(key=lambda x: x[1], reverse=True)

    def _pack(items):
        return [{"sym": s, "val": round(v / 1e6, 1)} for s, v in items[:top]]

    fmt_date = datetime.strptime(date_used, "%Y%m%d").strftime("%m/%d")
    return {"buys": _pack(buys), "sells": _pack(sells),
            "date": fmt_date, "proxy": True}


if __name__ == "__main__":
    import json
    print("Darkpool proxy:")
    dp = fetch_darkpool()
    if dp:
        print("date", dp["date"], "buys", dp["buys"][:5], "sells", dp["sells"][:5])
    print("Quote SPY:", fetch_quote("SPY"))
    print("\nGamma SPY:")
    print(json.dumps(fetch_gamma("SPY"), indent=2))
    print("\nSectors:")
    s = fetch_sectors()
    print(f"{len(s)} rows" if s else "none")
    print("\nFear & Greed:", fetch_fear_greed())
