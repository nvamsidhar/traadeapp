"""
Hyperliquid perpetuals analytics (v2 feature).

The dashboard already streams Hyperliquid *candles*; this taps the same free API
for the perp-specific signal it wasn't using: funding rates, open interest,
mark/oracle premium, 24h volume, and cross-venue funding (HL vs Binance/Bybit).

Endpoints (POST https://api.hyperliquid.xyz/info):
    metaAndAssetCtxs  -> per-coin funding/OI/premium/volume for the whole universe
    predictedFundings -> funding across HL / Binance / Bybit (arb + next-funding time)
    fundingHistory    -> historical hourly funding for one coin (for the chart)
"""

from __future__ import annotations

import time

import requests

HL_REST_URL = "https://api.hyperliquid.xyz/info"
_HEADERS = {"Content-Type": "application/json"}

# HL funds hourly; annualize an hourly rate over 24 * 365 hours.
_HOURS_PER_YEAR = 24 * 365


def _post(body: dict) -> object:
    r = requests.post(HL_REST_URL, json=body, headers=_HEADERS, timeout=15)
    r.raise_for_status()
    return r.json()


def _f(x, default: float = 0.0) -> float:
    try:
        return float(x)
    except (TypeError, ValueError):
        return default


def _predicted_map() -> dict:
    """coin -> {venue: {fundingRate, nextFundingTime, fundingIntervalHours}}."""
    try:
        out = {}
        for coin, venues in _post({"type": "predictedFundings"}):
            out[coin] = {v: info for v, info in venues}
        return out
    except Exception:
        return {}


def _annualized(rate: float, interval_hours: float) -> float:
    """Funding rate for one interval → % APR."""
    if not interval_hours:
        return 0.0
    return rate * (_HOURS_PER_YEAR / interval_hours) * 100


def fetch_perp_table() -> list[dict]:
    """One row per Hyperliquid perp with the headline analytics."""
    meta, ctxs = _post({"type": "metaAndAssetCtxs"})
    predicted = _predicted_map()
    rows: list[dict] = []

    for m, c in zip(meta.get("universe", []), ctxs):
        if not c:
            continue
        coin = m.get("name")
        mark = _f(c.get("markPx"))
        if mark <= 0:
            continue
        prev = _f(c.get("prevDayPx")) or mark
        oi_coin = _f(c.get("openInterest"))
        funding_hr = _f(c.get("funding"))          # hourly fraction

        row = {
            "coin": coin,
            "mark": mark,
            "oracle": _f(c.get("oraclePx")),
            "change24h": (mark - prev) / prev * 100 if prev else 0.0,
            "fundingHr": funding_hr * 100,                     # % / hour
            "fundingApr": funding_hr * _HOURS_PER_YEAR * 100,  # % / year
            "oiUsd": oi_coin * mark,
            "oiCoin": oi_coin,
            "volUsd": _f(c.get("dayNtlVlm")),
            "premium": _f(c.get("premium")) * 100,             # %
            "maxLev": m.get("maxLeverage"),
        }

        pv = predicted.get(coin, {})
        hl = pv.get("HlPerp")
        if hl and hl.get("nextFundingTime"):
            row["nextFunding"] = int(hl["nextFundingTime"])   # ms
        binp = pv.get("BinPerp")
        if binp:
            bin_apr = _annualized(_f(binp.get("fundingRate")),
                                  _f(binp.get("fundingIntervalHours"), 8))
            row["binFundingApr"] = bin_apr
            row["fundingSpread"] = row["fundingApr"] - bin_apr  # HL − Binance (APR)
        rows.append(row)

    rows.sort(key=lambda r: r["oiUsd"], reverse=True)
    return rows


def fetch_funding_history(coin: str, days: int = 14) -> list[dict]:
    """Hourly funding history for one coin → [{time (s), rateHr%, apr%}]."""
    start = int(time.time() * 1000) - days * 86_400_000
    data = _post({"type": "fundingHistory", "coin": coin.upper(), "startTime": start})
    out = []
    for d in data or []:
        rate = _f(d.get("fundingRate"))
        out.append({
            "time": int(d.get("time", 0)) // 1000,
            "rateHr": rate * 100,
            "apr": rate * _HOURS_PER_YEAR * 100,
        })
    return out


def market_summary(rows: list[dict]) -> dict:
    """Aggregate stats for the header strip."""
    if not rows:
        return {}
    total_oi = sum(r["oiUsd"] for r in rows)
    total_vol = sum(r["volUsd"] for r in rows)
    liquid = [r for r in rows if r["oiUsd"] > 1_000_000]
    avg_funding = (sum(r["fundingApr"] for r in liquid) / len(liquid)) if liquid else 0.0
    hottest = max(rows, key=lambda r: r["fundingApr"])
    coldest = min(rows, key=lambda r: r["fundingApr"])
    return {
        "totalOiUsd": total_oi,
        "totalVolUsd": total_vol,
        "coins": len(rows),
        "avgFundingApr": avg_funding,
        "hottest": {"coin": hottest["coin"], "apr": hottest["fundingApr"]},
        "coldest": {"coin": coldest["coin"], "apr": coldest["fundingApr"]},
    }
