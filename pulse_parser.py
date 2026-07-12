"""
Parse an Unusual Whales "Options Market Pulse" .docx into the PULSE data dict.

The report's *section headers* are stable ("Market Tide - SPY", "Gamma Map",
"Darkpool Flow", "Net Buys", …) but the prose between them changes every day.
So extraction keys off those headers, not off any particular sentence, and the
numeric parsers tolerate K/M/B units and +/- signs. Anything a given report
doesn't contain (e.g. some days omit the Fear & Greed category breakdown) is
simply left out of the returned dict.

Two things live only in the report's *images* and can't be read from text:
  • Top Net Impact bar magnitudes  -> approximated by rank (tickers are real).
  • Sector Flow numbers            -> supplied live by pulse_sources.fetch_sectors().
"""

from __future__ import annotations

import html
import re
import zipfile
from pathlib import Path


# ── raw text extraction ──────────────────────────────────────────────────────

def _docx_paragraphs(path: str | Path) -> list[str]:
    """Return non-empty paragraph strings from a .docx file."""
    with zipfile.ZipFile(path) as z:
        xml = z.read("word/document.xml").decode("utf-8", "ignore")
    paras: list[str] = []
    for chunk in xml.split("</w:p>"):
        # NB: `<w:t(?:\s[^>]*)?>` — the (?:\s…) guard stops this from also
        # matching border tags like <w:top .../> that start with "<w:t".
        texts = re.findall(r"<w:t(?:\s[^>]*)?>(.*?)</w:t>", chunk, re.S)
        line = html.unescape("".join(texts)).strip()
        if line:
            paras.append(line)
    return paras


def _between(text: str, start: str, end: str | None) -> str:
    """Text between anchor `start` and anchor `end` (or to the end)."""
    i = text.find(start)
    if i < 0:
        return ""
    i += len(start)
    if end:
        j = text.find(end, i)
        if j >= 0:
            return text[i:j]
    return text[i:]


def _sentences(seg: str) -> list[str]:
    """Split a segment into cleaned sentence-ish paragraphs."""
    seg = re.sub(r"\s+", " ", seg).strip(" .\n")
    if not seg:
        return []
    parts = re.split(r"(?<=[.!?])\s+", seg)
    return [p.strip() for p in parts if len(p.strip()) > 2]


def _group(sentences: list[str], per: int) -> list[str]:
    """Group short sentences into paragraph-ish blocks of `per`."""
    out, buf = [], []
    for s in sentences:
        buf.append(s)
        if len(buf) >= per:
            out.append(" ".join(buf)); buf = []
    if buf:
        out.append(" ".join(buf))
    return out


def _clean_prose(sentences: list[str]) -> list[str]:
    """Drop ticker-list lines, keep real prose sentences."""
    out = []
    for s in sentences:
        caps = re.findall(r"\b[A-Z]{1,6}\b", s)
        words = s.split()
        if words and len(caps) >= max(3, len(words) * 0.5):
            continue  # looks like a ticker row
        if len(s) > 15 and any(c.islower() for c in s):
            out.append(s)
    return out


# ── numeric helpers ──────────────────────────────────────────────────────────

def _to_millions(num: str, unit: str) -> float:
    v = float(num)
    u = (unit or "M").upper()
    if u == "K":
        return round(v / 1000, 4)
    if u == "B":
        return round(v * 1000, 2)
    return v  # already millions


def _npp_ncp(seg: str) -> tuple[float, float] | None:
    """First 'NPP: <n><unit> NCP: <n><unit>' in a segment, normalised to millions."""
    m = re.search(
        r"NPP:\s*([+\-]?[\d.]+)\s*([KMB]?)\s*NCP:\s*([+\-]?[\d.]+)\s*([KMB]?)", seg)
    if not m:
        return None
    return _to_millions(m.group(1), m.group(2)), _to_millions(m.group(3), m.group(4))


def _rank_magnitudes(tickers: list[str], sign: int, top: float, tail: float) -> list[dict]:
    """Approximate net-impact bars for a ticker list (real values are image-only)."""
    n = len(tickers)
    out = []
    for i, sym in enumerate(tickers):
        frac = 1 - (i / (n - 1)) if n > 1 else 1
        out.append({"sym": sym, "val": sign * round(tail + (top - tail) * frac)})
    return out


def _leading_tickers(seg: str) -> list[str]:
    """Consecutive ALL-CAPS tokens at the start of a segment (stops at prose)."""
    out = []
    for tok in seg.split():
        t = tok.strip(".,")
        if re.fullmatch(r"[A-Z]{1,6}", t):
            out.append(t)
        else:
            break
    return out


def _darkpool(seg: str) -> list[dict]:
    out = []
    for sym, num, unit in re.findall(r"\b([A-Z]{1,6})\s+([\d.]+)\s*([BM])\b", seg):
        out.append({"sym": sym, "val": _to_millions(num, unit)})
    return out


def _kv_scores(seg: str) -> list[dict]:
    return [{"name": n.strip(), "val": float(v)}
            for n, v in re.findall(r"([A-Za-z][A-Za-z ]+?):\s*([\d.]+)", seg)]


# ── main ─────────────────────────────────────────────────────────────────────

def parse_docx(path: str | Path) -> dict:
    full = " ".join(_docx_paragraphs(path))
    data: dict = {}

    # meta -------------------------------------------------------------------
    m = re.search(r"Market Pulse\s*-\s*([A-Za-z]+ \d{1,2},\s*\d{4})", full)
    m2 = re.search(r"Received:\s*(.+?GMT[^\)]*\))", full)
    data["meta"] = {
        "title": "Options Market Pulse",
        "subtitle": "Data-Based · Unusual Whales PRO",
        "date": m.group(1) if m else "",
        "received": m2.group(1).strip() if m2 else "",
    }

    # intro ------------------------------------------------------------------
    intro = _sentences(_between(full, "Indexes and Sectors", "Top Net Impact"))
    if intro:
        data["intro"] = _group(intro, 2)

    # Top Net Impact ---------------------------------------------------------
    pos_seg = _between(full, "Positive side:", "Negative side:")
    neg_seg = _between(full, "Negative side:", "Market Tide - SPY")
    pos = _leading_tickers(pos_seg)
    neg = _leading_tickers(neg_seg)
    if pos or neg:
        data["top_net_impact"] = (_rank_magnitudes(pos, +1, 155, 25)
                                  + _rank_magnitudes(neg, -1, 260, 18))
        data["top_net_impact_approx"] = True
    # commentary = prose after the (leading) ticker run
    tail = " ".join(neg_seg.split()[len(neg):])
    tail = re.sub(r"\s*(Market Tide|Top Net).*$", "", tail).strip()
    if tail and any(c.islower() for c in tail):
        data["top_net_impact_note"] = tail

    # Market Tide - SPY ------------------------------------------------------
    # Anchor on the header form ("Market Tide - SPY"), not bare "Market Tide",
    # which also appears in the intro prose ("on the Market Tide side …").
    tide_seg = _between(full, "Market Tide - SPY", "What do I expect")
    mt: dict = {}
    m = re.search(r"SPY [^.]*?at\s*([\d.]+),\s*(up|down)?\s*([+\-]?[\d.]+)%", full)
    if m:
        chg = float(m.group(3))
        if m.group(2) == "down" and chg > 0:
            chg = -chg
        mt["spy"], mt["change_pct"] = float(m.group(1)), chg
    pair = _npp_ncp(tide_seg)
    if pair:
        mt["npp"], mt["ncp"] = pair
    m = re.search(r"Vol:\s*([\d.]+[KMB])", full)
    mt["vol"] = m.group(1) if m else "—"
    notes_seg = re.sub(
        r"^\s*-?\s*(?:SPY\s*)?NPP:\s*[+\-]?[\d.]+\s*[KMB]?\s*NCP:\s*[+\-]?[\d.]+\s*[KMB]?",
        "", tide_seg)
    notes = _clean_prose(_sentences(notes_seg))
    if notes:
        mt["notes"] = notes
    if mt:
        data["market_tide"] = mt

    # Expectation / key levels ----------------------------------------------
    exp: dict = {}
    m = re.search(r"main (?:band|range)[^.\d]*?((?:SPY\s*)?\d{3}\s*[-–]\s*\d{3})", full)
    if m:
        band = m.group(1).strip()
        exp["band"] = band if band.upper().startswith("SPY") else "SPY " + band
    lvl_m = re.search(r"(?:key short term|short term key) levels:(.*?)"
                      r"(?:As long as|If SPY|Zero|Gamma Map|$)", full, re.I | re.S)
    levels = []
    if lvl_m:
        for px, label in re.findall(
                r"SPY\s*(\d{3}(?:[-–]\d{3})?)\s*:\s*(.*?)(?=\s*SPY\s*\d{3}\s*:|$)",
                lvl_m.group(1)):
            low = label.strip(" .").lower()
            if "spot" in low or "current" in low:
                kind = "spot"
            elif "resistance" in low or "call wall" in low:
                kind = "res"
            elif "support" in low or "put wall" in low or "down" in low or "accel down" in low:
                kind = "sup"
            else:
                kind = "res"
            levels.append({"px": px, "label": label.strip(" ."), "kind": kind})
    if levels:
        exp["levels"] = levels
    exp_narr = _clean_prose(_sentences(_between(full, "What do I expect", "Zero")))
    if exp_narr:
        exp["narrative"] = _group(exp_narr, 2)
    if exp:
        data["expectation"] = exp

    # Zero / Weekly DTE Tide -------------------------------------------------
    zw = []
    for name in ("Equity", "Index", "ETF", "All"):
        seg = _between(full, f"{name} Zero/Weekly DTE Tide", "Gamma Map")
        pair = _npp_ncp(seg)
        if not pair:
            continue
        m = re.search(r"NCP:\s*[+\-]?[\d.]+\s*[KMB]?", seg)
        note = ""
        if m:
            note = " ".join(_clean_prose(_sentences(seg[m.end():])))
        zw.append({"name": name, "npp": pair[0], "ncp": pair[1], "note": note})
    if zw:
        data["zero_weekly"] = zw
    m = re.search(r"(Short term flow[^.]+\.[^.]*\.)", full)
    if m:
        data["zero_weekly_note"] = m.group(1).strip()

    # Gamma Map --------------------------------------------------------------
    g_vals = re.findall(
        r"Gamma per 1% Price Change:\s*([+\-]?\$[\d.,]+[BM]?)\s*"
        r"Net Gamma Exposure:\s*([+\-]?[\d,]+)", full)
    gamma: dict = {}
    for i, k in enumerate(("oi", "volume", "directional")):
        if i < len(g_vals):
            gamma[k] = {"gpp": g_vals[i][0], "nge": g_vals[i][1]}
    m = re.search(r"[Vv]olatility [Rr]egime[:\s]+(\w+)", full)
    if not m:
        m = re.search(r"regime is still (\w+)", full)
    if m:
        gamma["regime"] = m.group(1).capitalize()
    for key, pat in (("accel_up", r"Accel up:\s*\$?(\d+)"),
                     ("call_wall", r"Call Wall:\s*\$?(\d+)"),
                     ("accel_down", r"Accel down:\s*\$?(\d+)")):
        m = re.search(pat, full)
        if m:
            gamma[key] = int(m.group(1))
    if mt.get("spy"):
        gamma["spot"] = mt["spy"]
    gseg = _between(full, "Directionalized Volume", "Darkpool Flow")
    gseg = re.sub(r"^\s*Gamma per 1%[^A-Za-z]*Net Gamma Exposure:\s*[+\-]?[\d,]+", "", gseg)
    gseg = re.sub(r"SPY Gamma Heat Zones", " ", gseg)
    gseg = re.sub(r"Volatility Regime:.*?Accel down:\s*\$?\d+", " ", gseg)
    g_narr = _clean_prose(_sentences(gseg))
    if g_narr:
        gamma["narrative"] = _group(g_narr, 2)
    if gamma:
        data["gamma"] = gamma

    # Darkpool ---------------------------------------------------------------
    buys = _darkpool(_between(full, "Net Buys", "Net Sells"))
    sells_seg = _between(full, "Net Sells", "Market Sentiment")
    sells = _darkpool(sells_seg)
    if buys:
        data["darkpool_buys"] = buys
    if sells:
        data["darkpool_sells"] = sells
    note_seg = re.sub(r"\b[A-Z]{1,6}\s+[\d.]+\s*[BM]\b", "", sells_seg)
    dp_note = _clean_prose(_sentences(note_seg))
    if dp_note:
        data["darkpool_note"] = dp_note

    # Sentiment --------------------------------------------------------------
    sent: dict = {}
    m = re.search(r"Fear & Greed Index:\s*(\d+)", full)
    if m:
        sent["fear_greed"] = int(m.group(1))
    cat = _kv_scores(_between(full, "Category Breakdown", "Indicator Sentiment"))
    ind = _kv_scores(_between(full, "Indicator Sentiment", "Sentiment is"))
    if cat:
        sent["category"] = cat
    if ind:
        sent["indicators"] = ind
    s_narr = _clean_prose(_sentences(_between(full, "Fear & Greed Index:", "Batman")))
    # drop the "Fear & Greed Index: NN" fragment itself
    s_narr = [re.sub(r"^\d+\s*", "", s) for s in s_narr if not re.fullmatch(r"\d+", s.strip())]
    if s_narr:
        sent["narrative"] = s_narr
    if sent:
        data["sentiment"] = sent

    # Batman -----------------------------------------------------------------
    bat = _sentences(_between(full, "Batman Commentary", "Probability Distribution"))
    if bat:
        data["batman"] = _group(bat, 2)

    # Probability ------------------------------------------------------------
    probs = []
    for label, pct in re.findall(r"([A-Za-z][^:]+?):\s*(\d+)%",
                                 _between(full, "Probability Distribution", None)):
        label = label.strip()
        kind = ("up" if re.search(r"above|call wall|reaccept|holds", label, re.I)
                else "down" if re.search(r"below|break|falls|weakens|down", label, re.I)
                else "neutral")
        probs.append({"label": label, "pct": int(pct), "kind": kind})
    if probs:
        data["probability"] = probs

    return data


if __name__ == "__main__":
    import json, sys
    if len(sys.argv) < 2:
        print("usage: python pulse_parser.py <report.docx>"); sys.exit(1)
    print(json.dumps(parse_docx(sys.argv[1]), indent=2, ensure_ascii=False))
