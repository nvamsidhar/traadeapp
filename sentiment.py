"""
VADER news-sentiment scoring (v2 backlog).

Scores the headlines the dashboard already fetches (yfinance) with VADER — a
lexicon tuned for short, punchy text like news titles — and returns a per-item
compound score plus a portfolio-style aggregate for the symbol.
"""

from __future__ import annotations

from vaderSentiment.vaderSentiment import SentimentIntensityAnalyzer

_analyzer = SentimentIntensityAnalyzer()

# VADER is tuned for general English and misreads market slang ("crushes",
# "beats", "tops" as violence/negatives). Override the lexicon with finance
# meanings (scores roughly -4…+4) so headlines score the way a trader reads them.
_FINANCE_LEXICON = {
    "beat": 2.0, "beats": 2.0, "crushes": 2.6, "crush": 2.2, "crushed": 2.2, "tops": 1.8,
    "surge": 2.5, "surges": 2.5, "surged": 2.5, "soar": 2.6, "soars": 2.6, "soared": 2.6,
    "rally": 2.0, "rallies": 2.0, "jumps": 2.0, "rockets": 2.6, "record": 1.3, "high": 0.8,
    "upgrade": 2.2, "upgraded": 2.2, "upgrades": 2.2, "outperform": 2.2, "bullish": 2.6, "gains": 1.6,
    "raises": 1.2, "boosts": 1.6, "lifts": 1.2, "downgrades": -2.2, "cut": -1.3,
    "rebound": 1.8, "boom": 2.0, "strong": 1.6, "growth": 1.4, "profit": 1.6, "dividend": 1.0,
    "miss": -2.0, "misses": -2.0, "missed": -2.0, "plunge": -2.6, "plunges": -2.6, "plummet": -2.8,
    "slump": -2.2, "slumps": -2.2, "tumble": -2.2, "tumbles": -2.2, "sinks": -2.2, "crash": -2.8,
    "downgrade": -2.2, "downgraded": -2.2, "bearish": -2.6, "probe": -1.6, "lawsuit": -1.8,
    "fraud": -2.8, "bankruptcy": -3.0, "warns": -1.8, "warning": -1.5, "cuts": -1.3, "layoffs": -2.0,
    "recall": -1.8, "weak": -1.6, "loss": -1.5, "losses": -1.6, "selloff": -2.2, "slashes": -2.0,
    "halts": -1.6, "delays": -1.3, "investigation": -1.6, "default": -2.4,
}
_analyzer.lexicon.update(_FINANCE_LEXICON)


def _label(c: float) -> str:
    return "bullish" if c >= 0.2 else "bearish" if c <= -0.2 else "neutral"


def annotate(items: list[dict]) -> tuple[list[dict], dict]:
    """Add {sentiment, sentimentLabel} to each item; return (items, aggregate)."""
    out: list[dict] = []
    total = 0.0
    for it in items or []:
        c = _analyzer.polarity_scores(it.get("title", "") or "")["compound"]
        out.append({**it, "sentiment": round(c, 3), "sentimentLabel": _label(c)})
        total += c
    n = len(out)
    avg = round(total / n, 3) if n else 0.0
    agg = {
        "avg": avg,
        "label": "bullish" if avg >= 0.08 else "bearish" if avg <= -0.08 else "neutral",
        "count": n,
    }
    return out, agg
