"""
Build a Market Pulse report and store it as JSON the /pulse page can serve.

Pipeline (Tier 1 + Tier 2):
    parsed doc (pulse_parser)      -> options flow / gamma / darkpool / sentiment / narrative
    live yfinance (pulse_sources)  -> Sector Flow table  (overrides / fills the sector section)
    static defaults (pulse_data)   -> anything still missing

Usage:
    python pulse_builder.py                      # newest *Market Pulse*.docx in Downloads
    python pulse_builder.py path/to/report.docx  # a specific file
    python pulse_builder.py --no-live            # skip the yfinance sector fetch

Output:
    pulse_reports/<YYYY-MM-DD>.json   (archived per day)
    pulse_reports/latest.json         (what /pulse serves)
"""

from __future__ import annotations

import glob
import json
import os
import re
import sys
from datetime import datetime
from pathlib import Path

from pulse_data import PULSE as DEFAULTS
from pulse_parser import parse_docx
import pulse_sources

REPORTS_DIR = Path(__file__).with_name("pulse_reports")
DOWNLOADS = Path(os.path.expanduser("~")) / "Downloads"


def _newest_report() -> Path | None:
    cands = glob.glob(str(DOWNLOADS / "*Market Pulse*.docx"))
    if not cands:
        return None
    return Path(max(cands, key=os.path.getmtime))


def _date_slug(meta_date: str) -> str:
    """'July 1, 2026' -> '2026-07-01' (falls back to today)."""
    for fmt in ("%B %d, %Y", "%b %d, %Y"):
        try:
            return datetime.strptime(meta_date.strip(), fmt).strftime("%Y-%m-%d")
        except (ValueError, AttributeError):
            continue
    return datetime.now().strftime("%Y-%m-%d")


def build(doc_path: str | Path | None = None, live: bool = True) -> dict:
    """Assemble the report dict from all available sources."""
    # 1) start from static defaults so the page is always complete
    data: dict = json.loads(json.dumps(DEFAULTS))

    # 2) overlay parsed doc (only keys it actually found)
    if doc_path is None:
        doc_path = _newest_report()
    if doc_path and Path(doc_path).exists():
        try:
            parsed = parse_docx(doc_path)
            data.update(parsed)
            print(f"[pulse_builder] parsed {Path(doc_path).name} "
                  f"({len(parsed)} sections)")
        except Exception as exc:
            print(f"[pulse_builder] parse failed ({exc}); using defaults")
    else:
        print("[pulse_builder] no report .docx found; using defaults")

    # 3) overlay everything free data can make live
    if live:
        # Sector Flow — real yfinance quotes beat image-transcribed numbers
        sectors = pulse_sources.fetch_sectors()
        if sectors:
            prior = {s["sym"]: s.get("call_pct", 50)
                     for s in data.get("sectors", [])}
            for row in sectors:
                row["call_pct"] = prior.get(row["sym"], 50)
            data["sectors"] = sectors
            data["sectors_live"] = True
            print(f"[pulse_builder] live sector table: {len(sectors)} rows")

        # Market Tide — live SPY price/change (NPP/NCP stay from the doc: UW-only)
        q = pulse_sources.fetch_quote("SPY")
        if q:
            mt = data.setdefault("market_tide", {})
            mt["spy"] = q["price"]
            mt["change_pct"] = q["change_pct"]
            mt["price_live"] = True
            print(f"[pulse_builder] live SPY: {q['price']} ({q['change_pct']:+}%)")

        # Gamma Map — OI-based GEX computed live from the SPY options chain.
        # We only trust the OI figure + walls/regime; the report's Volume and
        # Directionalized methodology can't be reproduced from free data, so
        # those two cards stay from the doc.
        gamma = pulse_sources.fetch_gamma("SPY")
        if gamma:
            g = data.setdefault("gamma", {})
            for k in ("oi", "regime", "spot", "call_wall", "accel_up", "accel_down", "live"):
                if k in gamma:
                    g[k] = gamma[k]
            print(f"[pulse_builder] live gamma: OI {gamma['oi']['gpp']} "
                  f"regime {gamma['regime']}")

        # Darkpool — FINRA off-exchange volume proxy (real prints need a paid
        # tick feed; this is daily off-exchange volume leaned by short ratio)
        dp = pulse_sources.fetch_darkpool()
        if dp and (dp["buys"] or dp["sells"]):
            data["darkpool_buys"] = dp["buys"]
            data["darkpool_sells"] = dp["sells"]
            data["darkpool_proxy"] = True
            data["darkpool_date"] = dp["date"]
            data["darkpool_note"] = [
                "Proxy view — FINRA does not publish directional net premium, so "
                "this ranks the heaviest off-exchange (dark pool + wholesaler) "
                "volume and leans each name by its short-volume ratio.",
                "Left = accumulation lean (low short %); right = distribution lean "
                "(high short %). Values are off-exchange volume in millions of shares. "
                "Leveraged/inverse ETFs can skew here and aren't clean signals.",
                "For UW-style directional net-premium prints, a paid tick feed "
                "(Polygon.io) or the Unusual Whales API is required.",
            ]
            print(f"[pulse_builder] live darkpool proxy (FINRA {dp['date']}): "
                  f"{len(dp['buys'])} buys / {len(dp['sells'])} sells")

        # Fear & Greed — CNN free endpoint
        fg = pulse_sources.fetch_fear_greed()
        if fg:
            s = data.setdefault("sentiment", {})
            s["fear_greed"] = round(fg["score"])
            if fg.get("indicators"):
                s["indicators"] = fg["indicators"]
            s["fear_greed_live"] = True
            print(f"[pulse_builder] live fear/greed: {fg['score']} ({fg['rating']})")

    now = datetime.now()
    data["_built_at"] = now.isoformat(timespec="seconds")
    # The hero date reflects when the data is as-of; the source doc's own date
    # is preserved separately so we can still show "source report: <date>".
    if live:
        meta = data.setdefault("meta", {})
        meta["report_date"] = meta.get("date", "")
        meta["date"] = now.strftime("%B %-d, %Y") if os.name != "nt" \
            else now.strftime("%B ") + str(now.day) + now.strftime(", %Y")
        meta["as_of"] = now.strftime("%Y-%m-%d %H:%M")
    return data


def save(data: dict) -> Path:
    REPORTS_DIR.mkdir(exist_ok=True)
    slug = _date_slug((data.get("meta") or {}).get("date", ""))
    dated = REPORTS_DIR / f"{slug}.json"
    latest = REPORTS_DIR / "latest.json"
    for p in (dated, latest):
        p.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"[pulse_builder] wrote {dated.name} and latest.json")
    return dated


def available_dates() -> list[str]:
    """Sorted (newest first) list of archived report dates."""
    if not REPORTS_DIR.exists():
        return []
    dates = [p.stem for p in REPORTS_DIR.glob("*.json")
             if re.fullmatch(r"\d{4}-\d{2}-\d{2}", p.stem)]
    return sorted(dates, reverse=True)


def load(slug: str | None = None) -> dict | None:
    """Load a report by date slug, or latest.json when slug is None."""
    fname = "latest.json" if not slug else f"{slug}.json"
    p = REPORTS_DIR / fname
    if not p.exists():
        return None
    try:
        return json.loads(p.read_text(encoding="utf-8"))
    except Exception:
        return None


if __name__ == "__main__":
    args = [a for a in sys.argv[1:] if a != "--no-live"]
    live = "--no-live" not in sys.argv
    path = args[0] if args else None
    save(build(path, live=live))
