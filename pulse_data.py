"""
Options Market Pulse — report data.

Everything the /pulse page renders lives in the PULSE dict below. To publish a
new day's report, copy this file's values and edit them; the template is fully
data-driven, so no HTML changes are needed.

Values transcribed from the "Charles Unusual Whales PRO Data Based Options
Market Pulse - July 1, 2026" briefing. Intraday tide series aren't in the
source data, so those line charts are synthesized to end at the reported
NPP/NCP values (clearly illustrative, not tick-accurate).
"""

from __future__ import annotations

PULSE = {
    "meta": {
        "title": "Options Market Pulse",
        "subtitle": "Data-Based · Unusual Whales PRO",
        "date": "July 1, 2026",
        "received": "Wed Jul 01 2026 18:40:21 GMT-0400 (Eastern Daylight Time)",
    },

    # ── Indexes and Sectors intro ──────────────────────────────────────────
    "intro": [
        "SPY finished the day at 745.7, -0.13%, with a slightly negative and "
        "indecisive close. There is no major breakdown on the price side, but the "
        "intraday flow quality is not as clean as yesterday. Especially on the "
        "Market Tide side, NPP at +101M and NCP at -213M show call premium "
        "unwinding and renewed pressure on the put premium side in the main picture.",
        "Today, the market is not fully risk off; but yesterday's clear call "
        "dominance deteriorated today.",
        "On the macro side, the key headline of the day was Warsh's message. Fed "
        "Chair Kevin Warsh said inflation risks have eased, but also stated that the "
        "Fed is not compromising on its 2% target. The first sentence was for the "
        "market, the second sentence was for bond vigilantes.",
        "On the oil side, the geopolitical risk premium continues to ease.",
        "Sector structure showed rotation today. It is interesting that XLU and XLE "
        "were also negative. Normally, on risk off days, utilities can work as a "
        "defensive area; today, that was weak too. So today's picture is not a "
        "classic defensive rotation. It is more like sell tech, buy "
        "communication/financials, and keep the index balanced.",
        "That is why the sector read is mixed and selective. There is no broad risk "
        "on. But there is no panic risk off either.",
    ],

    # ── Market Tide - SPY ──────────────────────────────────────────────────
    "market_tide": {
        "spy": 745.65,
        "change_pct": -0.13,
        "vol": "530K",
        "npp": 101.0,    # Net Put Premium (millions)
        "ncp": -213.0,   # Net Call Premium (millions)
        "notes": [
            "There is clear unwinding on the call premium side, while active premium "
            "pressure has increased on the put side.",
            "Even though price made upside attempts intraday, call premium weakened "
            "toward the close and the put premium side strengthened.",
            "Neutral negative.",
        ],
    },

    # ── Top Net Impact (net premium, $M) ───────────────────────────────────
    # Approximate magnitudes read off the Top Net Impact chart.
    "top_net_impact": [
        {"sym": "QQQ",  "val":  155},
        {"sym": "META", "val":  120},
        {"sym": "MSFT", "val":   70},
        {"sym": "PLTR", "val":   30},
        {"sym": "TSLA", "val":   28},
        {"sym": "IWM",  "val":  -18},
        {"sym": "LRCX", "val":  -22},
        {"sym": "SMH",  "val":  -25},
        {"sym": "CRWV", "val":  -28},
        {"sym": "NVDA", "val":  -35},
        {"sym": "DRAM", "val":  -38},
        {"sym": "SPCX", "val":  -40},
        {"sym": "TSM",  "val":  -42},
        {"sym": "BE",   "val":  -48},
        {"sym": "AMD",  "val":  -70},
        {"sym": "SOXL", "val":  -75},
        {"sym": "SPY",  "val":  -80},
        {"sym": "SNDK", "val": -115},
        {"sym": "INTC", "val": -125},
        {"sym": "MU",   "val": -260},
    ],
    "top_net_impact_note": "Mega cap is selectively holding up, semis are under pressure.",

    # ── Sector Flow ────────────────────────────────────────────────────────
    "sectors": [
        {"sym": "SPY",  "name": "S&P 500 Index",   "price": 745.76, "chg": -0.13, "vol": "45.78M", "call_pct": 48, "low": 615.52, "high": 760.40},
        {"sym": "XLC",  "name": "Communication",   "price": 109.74, "chg":  2.44, "vol": "14.53M", "call_pct": 52, "low": 105.03, "high": 120.41},
        {"sym": "XLF",  "name": "Financials",      "price":  54.78, "chg":  2.18, "vol": "47.66M", "call_pct": 46, "low":  47.67, "high":  56.52},
        {"sym": "XLY",  "name": "Consumer Disc",   "price": 118.09, "chg":  0.69, "vol":  "9.72M", "call_pct": 74, "low": 105.19, "high": 125.01},
        {"sym": "XLV",  "name": "Health Care",     "price": 159.54, "chg":  0.56, "vol": "10.11M", "call_pct": 66, "low": 127.96, "high": 161.15},
        {"sym": "XLB",  "name": "Materials",       "price":  51.02, "chg":  0.37, "vol": "14.13M", "call_pct": 49, "low":  42.04, "high":  54.14},
        {"sym": "XLRE", "name": "Real Estate",     "price":  44.18, "chg":  0.34, "vol":  "7.94M", "call_pct": 50, "low":  39.73, "high":  45.65},
        {"sym": "XLP",  "name": "Consumer Staples", "price": 83.30, "chg":  0.28, "vol":  "12.2M", "call_pct": 47, "low":  75.16, "high":  90.14},
        {"sym": "XLE",  "name": "Energy",          "price":  52.81, "chg": -0.56, "vol": "33.55M", "call_pct": 77, "low":  52.09, "high":  63.46},
        {"sym": "XLI",  "name": "Industrials",     "price": 183.36, "chg": -1.01, "vol":  "8.11M", "call_pct": 42, "low": 146.91, "high": 186.09},
        {"sym": "XLU",  "name": "Utilities",       "price":  44.77, "chg": -1.26, "vol": "29.39M", "call_pct": 60, "low":  40.17, "high":  47.80},
        {"sym": "XLK",  "name": "Technology",      "price": 185.62, "chg": -2.57, "vol":   "9.9M", "call_pct": 55, "low": 124.63, "high": 198.73},
    ],

    # ── What I expect / key levels ─────────────────────────────────────────
    "expectation": {
        "band": "SPY 740–750",
        "narrative": [
            "SPY is around 745 and right in the decision zone. Above, there is 746 "
            "accel up and the 750 call wall. Below, the 740 accel down level is "
            "critical. Above 746, price can push toward 750. Acceptance above 750 "
            "would generate momentum again.",
            "As long as SPY stays above 740, today's weakness is not yet a trend "
            "breakdown; it can be read more as digestion below 750. But without "
            "sustained action above 746, there is no confirmation of new strong "
            "momentum either.",
            "If acceptance above 750 comes, the market may want to test the 755–760 "
            "band again. A break below 740, however, would quickly damage the picture "
            "and could expand selling because of the amplifying gamma regime.",
        ],
        "levels": [
            {"px": "750",     "label": "Call wall / main resistance", "kind": "res"},
            {"px": "746",     "label": "Upside accel / first momentum threshold", "kind": "res"},
            {"px": "745",     "label": "Current spot area", "kind": "spot"},
            {"px": "740",     "label": "Downside accel / critical support", "kind": "sup"},
            {"px": "735–734", "label": "Lower support band", "kind": "sup"},
        ],
    },

    # ── Zero / Weekly DTE Tide ─────────────────────────────────────────────
    "zero_weekly": [
        {"name": "Equity", "npp": -28.99, "ncp":  29.75, "note": "The equity side is better than the main Market Tide. NPP is negative, NCP is positive. This structure shows short term call premium support and put unwinding in single stocks. So the equity 0DTE/weekly side is not fully weak."},
        {"name": "Index",  "npp":  -1.21, "ncp": -27.81, "note": "The index side is weak."},
        {"name": "ETF",    "npp":   9.64, "ncp":   2.73, "note": "The ETF side is mixed."},
        {"name": "All",    "npp": -20.56, "ncp":   4.66, "note": "The total Zero/Weekly picture is more neutral compared with the main Market Tide."},
    ],
    "zero_weekly_note": "Short term flow has not fully deteriorated; but because the main premium structure weakened, upside momentum is waiting for confirmation.",

    # ── Gamma Map - SPY ────────────────────────────────────────────────────
    "gamma": {
        "oi":          {"gpp": "-$3.36B",   "nge": "-604,776"},
        "volume":      {"gpp": "-$106.23B", "nge": "-19,140,027"},
        "directional": {"gpp": "+$3.09B",   "nge": "+556,984"},
        "regime": "Amplifying",
        "accel_up": 746,
        "call_wall": 750,
        "accel_down": 740,
        "spot": 745.01,
        "narrative": [
            "The gamma side is mixed today, but risky. OI gamma is negative, volume "
            "gamma is negative. This shows that the dealer structure can amplify price "
            "moves rather than suppress them. Directionalized volume being positive is "
            "the only positive side; in other words, intraday directional flow is not "
            "completely downward. But the overall gamma floor is still fragile.",
            "On the SPY heat zone side, the amplifying regime continues. That is why "
            "the 746 and 740 levels are very important. Above 746, price can move "
            "toward the 750 call wall. Acceptance above 750 can open a new momentum area.",
            "But if there is a close below 740 or a sharp break lower, the downside "
            "move can accelerate because of the amplifying regime. That is why 740 is "
            "not only support; it is also a momentum breakdown threshold.",
            "In this structure, the market is squeezed between 740–750. 746 is the "
            "short term direction filter. 750 is resistance for trend continuation. "
            "740 is the risk control level.",
        ],
    },

    # ── Darkpool Flow ($) ──────────────────────────────────────────────────
    "darkpool_buys": [
        {"sym": "QQQ",  "val": 2210}, {"sym": "BND",  "val": 891.1}, {"sym": "IWD", "val": 568.9},
        {"sym": "VOO",  "val": 519.2}, {"sym": "IDEV", "val": 436.7}, {"sym": "IWF", "val": 401.4},
        {"sym": "QCOM", "val": 397.6}, {"sym": "XLC",  "val": 367.9}, {"sym": "TLT", "val": 310.5},
        {"sym": "RSP",  "val": 308.6}, {"sym": "SPYM", "val": 230.6}, {"sym": "VCIT", "val": 223.1},
        {"sym": "C",    "val": 218.9}, {"sym": "FBND", "val": 206.8}, {"sym": "IVV", "val": 187.3},
        {"sym": "WING", "val": 180.2}, {"sym": "SPTL", "val": 172.1}, {"sym": "BKNG", "val": 163.1},
        {"sym": "IEMG", "val": 141.5}, {"sym": "GS",   "val": 141.3}, {"sym": "SPY", "val": 134.7},
        {"sym": "SHV",  "val": 132.4}, {"sym": "IUSV", "val": 128.8}, {"sym": "IJT", "val": 125.7},
        {"sym": "FTI",  "val": 121.6},
    ],
    "darkpool_sells": [
        {"sym": "META", "val": 438.2}, {"sym": "BSV",  "val": 379.4}, {"sym": "MU",  "val": 299.0},
        {"sym": "CAT",  "val": 290.5}, {"sym": "SMH",  "val": 273.8}, {"sym": "MSFT", "val": 254.7},
        {"sym": "XLE",  "val": 245.7}, {"sym": "AMAT", "val": 226.8}, {"sym": "T",   "val": 220.3},
        {"sym": "PBUS", "val": 214.4}, {"sym": "AIG",  "val": 189.3}, {"sym": "AMZN", "val": 173.8},
        {"sym": "XLF",  "val": 167.3}, {"sym": "AMD",  "val": 151.6}, {"sym": "VZ",  "val": 149.9},
        {"sym": "HYG",  "val": 145.3}, {"sym": "BIL",  "val": 139.6}, {"sym": "SNDK", "val": 138.3},
        {"sym": "ASML", "val": 136.3}, {"sym": "IBM",  "val": 136.1}, {"sym": "STX", "val": 128.3},
        {"sym": "USHY", "val": 125.5}, {"sym": "IYM",  "val": 125.1}, {"sym": "IVW", "val": 119.4},
        {"sym": "ORLY", "val": 118.8},
    ],
    "darkpool_note": [
        "On the darkpool side, there is a barbell structure today. There is buying in "
        "broad index vehicles.",
        "But at the same time, there is significant buying in bond instruments such as "
        "BND, TLT, VCIT, FBND, and SHV. This shows that the market is not only risk on, "
        "but also doing risk balancing. In other words, institutional money is buying "
        "QQQ and index beta on one side, while hedging with bonds on the other side.",
        "On the sell side, there are technology and semiconductor names.",
    ],

    # ── Market Sentiment ───────────────────────────────────────────────────
    "sentiment": {
        "fear_greed": 41,
        "prev": 53,
        "category": [
            {"name": "Volatility",       "val": 70.0},
            {"name": "Market Data",      "val": 51.9},
            {"name": "Market Momentum",  "val": 50.0},
            {"name": "Options Sentiment", "val": 45.8},
            {"name": "Market Breadth",   "val": 25.9},
            {"name": "Bond And Risk",    "val": 19.1},
        ],
        "indicators": [
            {"name": "Put Call Ratio",          "val": 64.8},
            {"name": "Market Momentum",         "val": 50.0},
            {"name": "Premium Ratio",           "val": 0.0},
            {"name": "Stock Price Strength",    "val": 35.0},
            {"name": "Market Breadth",          "val": 15.8},
            {"name": "Premium Trend",           "val": 100.0},
            {"name": "Put Call",                "val": 34.4},
            {"name": "Insider Sentiment",       "val": 0.4},
            {"name": "VIX",                     "val": 70.0},
            {"name": "VIX Trend",               "val": 70.0},
            {"name": "Expiry Bias",             "val": 50.0},
            {"name": "OTM Skew",                "val": 0.0},
            {"name": "Volume Divergence",       "val": 25.0},
            {"name": "Market Breadth Sentiment", "val": 45.9},
            {"name": "Junk Bond Demand",        "val": 11.2},
            {"name": "Safe Haven Demand",       "val": 27.0},
            {"name": "Fifty Two Week Sentiment", "val": 79.7},
        ],
        "narrative": [
            "Sentiment is in the fear zone at 41. This is below yesterday's neutral "
            "reading of 53. So even though price did not fall sharply, caution "
            "increased on the sentiment side.",
            "There is still a broad participation and credit appetite problem in the "
            "market. The solution is the Fed.",
            "The price structure has not fully deteriorated, but internal quality "
            "remained weak.",
        ],
    },

    # ── Batman Commentary ──────────────────────────────────────────────────
    "batman": [
        "Today, the market did not deteriorate too much, but flow quality deteriorated.",
        "Yesterday, on the Market Tide side, we saw a call premium + put unwinding "
        "structure. Today, that structure reversed.",
        "We saw a failed momentum day and rotation.",
        "The gamma side is negative.",
        "The market is not panic. But it is not as bullish as yesterday either. Market "
        "Tide deteriorated. NPP is positive, NCP is negative. This means put premium "
        "pressure and call unwinding. The Zero/Weekly side is more neutral, but the "
        "main flow is weak. Gamma is amplifying and fragile.",
        "In short, we had a controlled caution session.",
    ],

    # ── Probability Distribution ───────────────────────────────────────────
    "probability": [
        {"label": "SPY reacceptance above 746 and test of the 750 call wall", "pct": 34, "kind": "up"},
        {"label": "Indecisive digestion / rotation between SPY 740–750",      "pct": 41, "kind": "neutral"},
        {"label": "Break below SPY 740 and acceleration toward the 735–734 band", "pct": 25, "kind": "down"},
    ],
}
