"""
NSE option chain (v2 backlog) — NIFTY/BANKNIFTY and equity option chains from
nseindia.com's public JSON, with PCR and max-pain.

⚠️ NSE actively blocks non-browser / non-India / datacenter traffic (it 404/401s
from most cloud IPs). This was written against NSE's known schema but could NOT
be verified from the build environment — it should work when the dashboard runs
from an Indian residential IP. Every failure is surfaced cleanly to the caller.
"""

from __future__ import annotations

import requests

_INDICES = {"NIFTY", "BANKNIFTY", "FINNIFTY", "MIDCPNIFTY", "NIFTYNXT50"}

_HEADERS = {
    "User-Agent": ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
                   "(KHTML, like Gecko) Chrome/122.0 Safari/537.36"),
    "Accept": "application/json, text/plain, */*",
    "Accept-Language": "en-US,en;q=0.9",
    "Referer": "https://www.nseindia.com/option-chain",
}


def _session() -> requests.Session:
    s = requests.Session()
    s.headers.update(_HEADERS)
    # seed cookies by visiting the option-chain page first (NSE requires this)
    s.get("https://www.nseindia.com/option-chain", timeout=10)
    return s


def _n(x):
    return x if isinstance(x, (int, float)) else None


def _max_pain(rows: list[dict]) -> float | None:
    """Strike that minimises total option-writer payout (classic max-pain)."""
    strikes = [r["strikePrice"] for r in rows if r.get("strikePrice") is not None]
    if not strikes:
        return None
    ce = {r["strikePrice"]: ((r.get("CE") or {}).get("openInterest") or 0) for r in rows}
    pe = {r["strikePrice"]: ((r.get("PE") or {}).get("openInterest") or 0) for r in rows}
    best, best_loss = None, float("inf")
    for expiry_px in strikes:
        loss = 0.0
        for k in strikes:
            loss += ce.get(k, 0) * max(0.0, expiry_px - k)   # calls ITM below expiry
            loss += pe.get(k, 0) * max(0.0, k - expiry_px)   # puts ITM above expiry
        if loss < best_loss:
            best_loss, best = loss, expiry_px
    return best


def fetch_option_chain(symbol: str = "NIFTY", window: int = 20) -> dict:
    symbol = (symbol or "NIFTY").strip().upper()
    path = "option-chain-indices" if symbol in _INDICES else "option-chain-equities"
    s = _session()
    r = s.get(f"https://www.nseindia.com/api/{path}?symbol={symbol}", timeout=12)
    if r.status_code != 200:
        raise RuntimeError(f"NSE returned HTTP {r.status_code} (often means it blocked "
                           f"this IP — works from an Indian residential connection)")
    data = r.json()
    rec = data.get("records") or {}
    underlying = rec.get("underlyingValue")
    expiries = rec.get("expiryDates") or []
    expiry = expiries[0] if expiries else None

    expiry_rows = [x for x in (rec.get("data") or []) if x.get("expiryDate") == expiry]
    if not expiry_rows:
        raise RuntimeError("NSE returned no option data for the nearest expiry")

    tot_ce = tot_pe = 0
    parsed = []
    for x in expiry_rows:
        ce, pe = x.get("CE") or {}, x.get("PE") or {}
        tot_ce += ce.get("openInterest") or 0
        tot_pe += pe.get("openInterest") or 0
        parsed.append({
            "strike": x.get("strikePrice"),
            "ce": {"oi": _n(ce.get("openInterest")), "chgOi": _n(ce.get("changeinOpenInterest")),
                   "iv": _n(ce.get("impliedVolatility")), "ltp": _n(ce.get("lastPrice"))},
            "pe": {"oi": _n(pe.get("openInterest")), "chgOi": _n(pe.get("changeinOpenInterest")),
                   "iv": _n(pe.get("impliedVolatility")), "ltp": _n(pe.get("lastPrice"))},
        })
    parsed.sort(key=lambda r: r["strike"] if r["strike"] is not None else 0)

    atm = None
    if underlying and parsed:
        atm = min((p["strike"] for p in parsed), key=lambda k: abs(k - underlying))
        strikes = [p["strike"] for p in parsed]
        i = strikes.index(atm)
        parsed = parsed[max(0, i - window): i + window + 1]

    return {
        "ok": True,
        "symbol": symbol,
        "underlying": underlying,
        "expiry": expiry,
        "expiries": expiries[:8],
        "atm": atm,
        "pcr": round(tot_pe / tot_ce, 3) if tot_ce else None,
        "maxPain": _max_pain(expiry_rows),
        "totalCeOi": tot_ce,
        "totalPeOi": tot_pe,
        "rows": parsed,
    }
