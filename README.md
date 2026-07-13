# Live Multi-Chart Trading Dashboard

A self-hosted, browser-based trading dashboard that shows up to 8 live candlestick charts side-by-side across three asset classes — Indian equities, US equities, and crypto perpetuals on Hyperliquid — with a full suite of technical indicators, Telegram alerts, a watchlist, drawing tools, and a backtest engine.

Runs locally on Python + Flask, with all charting, indicator math, alert detection, and backtest simulation done client-side in the browser.

---

## What it does

- **Multi-pane chart grid** of independent charts (1, 2, 4, 6, or 8 panes).
- **Three data sources**, switchable per pane:
  - Hyperliquid perpetuals (live WebSocket trades + REST candle history)
  - US stocks via Yahoo Finance (yfinance)
  - Indian stocks (NSE) via Yahoo Finance
- **Live price updates** — streaming trades for crypto, 5-second polling for stocks.
- **20+ technical indicators** across five categories: Strategy, Trend, Price Action, Volume, Oscillators.
- **Telegram alerts** — price thresholds, % moves, RSI/MACD crosses, price-vs-SMA50, all delivered to your phone.
- **Watchlist strip** at the bottom: track many symbols at a glance, click any tile to load it into the active pane.
- **Drawing tools** — horizontal price lines for support/resistance, per-pane and per-symbol persistence.
- **Compare overlay** — pin a second symbol on the same chart, rebased to the main symbol's anchor price.
- **Backtest mode** — replay XO Trend strategy on historical candles, see trade-by-trade P&L and stats.
- **Dark / light theme** with one-click toggle, persists across reloads.
- **Manual color picker** per indicator (click any swatch to recolor).
- **Crosshair sync** across all open panes (move mouse on one, others mirror it).
- **Full-screen mode** — double-click any pane to maximize.
- **Per-pane persistence** — source, symbol, interval, indicators, colors, drawings, comparison, theme, watchlist, alerts all survive reloads.
- **Mobile responsive** — usable on tablets and phones; phone view stacks panes vertically.

---

## Indicators

All indicator math runs in JavaScript on the browser using the candle data; the server only fetches OHLCV.

### Strategy (overlay)

| Indicator | Notes |
|---|---|
| **XO Trend (12, 25)** | Ported from the Trader XO Macro Trend Scanner Pine script. EMA 12 vs EMA 25 crossover — both lines render green when fast is above slow, red when below. Adds ▲ Bull / ▼ Bear arrow markers at fresh crossovers. Per-bar candle coloring (from the original Pine) is skipped due to `lightweight-charts` v4 limitations. |

### Trend (overlay)

| Indicator | Notes |
|---|---|
| **SMA 20, SMA 50** | Simple moving averages |
| **EMA 12, EMA 26** | Exponential moving averages |
| **Bollinger Bands** | 20-period, 2σ |
| **VWAP** | Resets each session (daily) |
| **Supertrend (10, 3)** | ATR-based trailing stop, two-color line that flips at trend changes |
| **Ichimoku Cloud** | Tenkan-sen, Kijun-sen, Senkou A/B (projected forward 26 bars). Cloud rendered as two dashed lines (not filled — v4 has no native band-fill primitive) |
| **Pivot Points** | Classic floor-trader pivots (P, R1–R3, S1–S3) from the last completed candle's H/L/C, drawn as horizontal price lines with axis labels |

### Price Action (custom canvas overlay)

| Indicator | Notes |
|---|---|
| **Fair Value Gaps (FVG)** | Three-candle imbalances: bull (green) where `candle[i-1].high < candle[i+1].low`, bear (red) inverse. Boxes stretch from gap candle to the right edge |
| **Volume Profile (POC/VA)** | Horizontal histogram pinned to the right edge, 50 price bins. POC bin in yellow, Value Area (70% of total volume) in green, rest in grey |

Both are drawn on a custom `<canvas>` layered on top of the chart, and repaint on zoom, scroll, resize, and every live-tick update.

### Volume

| Indicator | Notes |
|---|---|
| **Volume** | Histogram colored by candle direction (green up, red down), drawn in the bottom 28% of the chart |

### Oscillators (sub-pane in bottom 28% of chart)

| Indicator | Notes |
|---|---|
| **RSI (14)** | Wilder's smoothing |
| **MACD (12, 26, 9)** | Two lines + histogram (histogram colored green/red by sign) |
| **Stochastic (14, 3, 3)** | %K and %D |
| **Stoch RSI (14, 14, 3, 3)** | Stochastic applied to RSI values (not price) — generally more sensitive, fires earlier than plain Stochastic |
| **ATR (14)** | Wilder's smoothing |
| **ADX (14)** | ADX, +DI, −DI |
| **CCI (20)** | Commodity Channel Index |
| **OBV** | Cumulative On-Balance Volume |
| **MFI (14)** | Money Flow Index |
| **Williams %R** | 14-period |

Each oscillator gets its own internal price scale, so the curve is correctly scaled when displayed alone. Enabling multiple at once works but the scales overlap visually — best used one or two at a time.

### Active indicator legend

A row of small chips appears in the **top-left corner of each chart** showing every active indicator. Each chip has a colored dot matching the swatch from the menu, plus a short label (e.g. `● SMA 20`, `● RSI 14`, `● XO Trend`). Wraps to multiple rows if many are active. Click-through (doesn't intercept mouse).

### Manual color picker

Every colored swatch in the indicator menu is clickable. Click → OS color picker opens. Pick a color → every pane re-renders instantly with the new color. Choices are global (one color per indicator across all panes) and persisted in `localStorage` (`td_ind_colors`). Multi-line indicators let you control the **primary line** color (BB → all 3 lines, Supertrend / XO Trend → up segment, Ichimoku → Tenkan, MACD → main line, Stoch / Stoch RSI → %K, ADX → ADX). Pivot Points, FVG, Volume Profile keep semantic colors.

---

## Telegram alerts

Browser-side detection that fires push notifications to Telegram on configurable conditions. The bot token is read server-side from a `.env` file and never leaves the Flask backend.

### Alert types

| Type | Triggers on |
|---|---|
| **Price >** / **Price <** | Cross above/below a threshold price |
| **% move ≥ X% over N bars** | Volatility spike — magnitude of % change over the last N candles exceeds X |
| **RSI(14) crosses above/below X** | Overbought/oversold transitions (e.g., 70 / 30) |
| **MACD bullish / bearish cross** | Line crosses above/below signal |
| **Price crosses above / below SMA 50** | Trend-break confirmation |

All conditions are **edge-triggered** (transition from false → true), so they don't spam while the condition stays met.

### UI

- **ALERTS** button in the topbar shows a badge count of armed alerts.
- Click → modal with: Telegram-status pill, **Test message** button, new-alert form, list of current alerts.
- Each alert can be **one-shot** (fires once, then disabled) or **repeating** (re-fires after a 5-minute cooldown).

### Constraints

- **The dashboard tab must be open** — detection runs in the browser on every live tick.
- **The symbol must have a pane open** — that's where the live candle data lives.
- **24/7 alerts (with the tab closed)** require a server-side worker — see "Roadmap" below.

### Setup

See "Telegram setup" under [Running it](#running-it).

---

## Watchlist

A collapsible horizontal strip at the bottom of the screen, showing one tile per symbol with current price and today's % change (color-coded).

- **Add**: pick a source, type a symbol, hit `+` or Enter
- **Click a tile** → loads the symbol into the **active pane** (the pane you last clicked, highlighted in blue)
- **Right-click a tile** → removes it from the watchlist
- **▾ button** collapses the strip
- **Auto-refresh** every 30 seconds. % change is computed from the current daily candle's open vs current close.
- Persisted to `localStorage` (`td_watchlist`)

---

## Drawing tools

Click the **DRAW** button on any pane → cursor turns into a crosshair → next click on the chart drops a horizontal price line at the exact y-coordinate's price. Each line gets an axis label with the price value.

- Click DRAW again to exit draw mode
- **Right-click** on or near an existing line (when not in draw mode) → deletes the nearest line (hit-zone is 1% of the price)
- Lines are **persisted per (pane, symbol)** — switching the pane to a different symbol hides them; switching back restores them. Survives page reload.

---

## Compare overlay

Click the **VS** button on a pane → small popup with source + symbol fields → adds a second symbol's price line on top of the candlesticks.

- The compared series is **rebased**: scaled so its first close equals the main symbol's first close. Both series then diverge based on their relative % changes — you see *relative performance* at a glance.
- A chip (`vs ETH ×`) appears next to VS. Click `×` to remove.
- Persists per pane; auto-refetches when the main symbol or interval changes.
- One comparison at a time per pane.

---

## Backtest

Replays a strategy's signals through the loaded candles, simulating trades and reporting stats. **Use for evaluating indicator behaviour — not for real trading decisions.**

- **BACKTEST** button in the topbar → modal with strategy / pane / initial-capital pickers + Run button.
- Currently supports **XO Trend (12, 25)** only.
- Simulation: long-only, full-balance trades, no slippage, no commission, no leverage. Buys on every Bull signal, exits on every Bear signal. Mark-to-market on any open position at the last candle.
- Output:
  - **Stats panel**: Total Return %, Trade Count, Win Rate %, Max Drawdown %, Initial → Final Equity, Best Trade %, Worst Trade %
  - **Trade table**: last 20 trades — entry time, exit time, entry/exit price, P&L %

The heavier, more realistic version of all this lives in the server-side **Backtest Lab** (below).

---

## Backtest Lab (server-side — v2)

A full backtesting engine that runs on the server via [backtesting.py](https://github.com/kernc/backtesting.py), reachable from the **BACKTEST LAB ↗** link in the topbar or at `/backtest`.

- **Strategies**: EMA crossover (XO Trend), SMA crossover, RSI reversion, MACD crossover — each with tunable parameters.
- **Realistic costs**: fees + slippage charged per side (as a % commission on entry and exit).
- **Optional optimizer**: grid-searches the strategy parameters to maximise Sharpe ratio.
- **Assets**: US & India equities (yfinance) and Hyperliquid crypto (real `candleSnapshot` OHLCV) — the same universe as the dashboard.
- **Output**:
  - **Stats grid**: Total Return %, Buy & Hold %, CAGR, Sharpe, Sortino, Max Drawdown %, Win Rate %, Trades, Profit Factor, Exposure %, Best/Worst trade.
  - **Equity curve** (lightweight-charts) + full trade list.
  - **QuantStats tearsheet**: a one-click full HTML performance report (drawdown analysis, monthly-returns heatmap, rolling Sharpe…) via [quantstats](https://github.com/ranaroussi/quantstats).
- **Architecture**: the heavy libs are lazy-imported inside the Flask handlers, so the dashboard still boots fast. New modules: `market_data.py`, `backtest_engine.py`, `reports.py`. Endpoints: `POST /api/backtest`, `GET /api/report`.
- **🔔 Arm for live alerts**: one click on a backtest result creates a 24/7 server alert (via the existing alert worker) that pings **Telegram** on a fresh Buy/Sell cross on live candles. New alert `type: "strategy"`; the worker's signal detection mirrors the backtest strategies and self-dedupes by signal-bar time.

> QuantStats annualises from **daily** returns, so a `1d` interval gives the most accurate risk metrics. Still not trading advice — compare strategy *behaviour*, don't size real positions off it.

---

## Perp Radar (Hyperliquid funding & OI — v2)

A live analytics board for Hyperliquid perpetuals at `/perp` (or **PERP RADAR ↗** in the topbar), tapping the same free API the charts already use — for the perp signal the dashboard wasn't surfacing:

- **Funding rates** (hourly + annualised APR) for all ~230 perps, with a next-funding countdown.
- **Open interest** (USD) and 24h volume — sortable, searchable, filterable by OI.
- **Cross-venue spread**: HL funding APR − Binance funding APR (from `predictedFundings`) — the carry between venues.
- **Funding extremes**: crowded-longs / shorts-paying leaderboards (a squeeze radar).
- **Per-coin funding-history** chart (14d) + premium, with a zero-funding baseline.
- Auto-refreshes every 30s. Module: `perp_data.py`; endpoints `GET /api/perp/contexts`, `GET /api/perp/funding`. **No new dependencies** — pure Hyperliquid REST.

---

## Portfolio, Earnings & Sentiment (v2 backlog)

- **Portfolio Lab** (`/portfolio`) — track holdings (kept in your browser), live P&L and allocation, a **correlation heatmap** across your book, and a **max-Sharpe rebalance** suggestion (PyPortfolioOpt). Module: `portfolio.py`; `POST /api/portfolio/analyze`.
- **Earnings Calendar** (`/calendar`) — upcoming earnings dates + last surprise for your names, fetched concurrently from yfinance (no API key). Module: `earnings.py`; `POST /api/calendar/earnings`.
- **News sentiment** — the per-symbol News modal now shows a VADER badge per headline + an overall tone, using a **finance-tuned lexicon** (so "beats / crushes / soars" read bullish, not violent). Module: `sentiment.py`.

---

## Themes

A **THEME** dropdown in the topbar toggles between **Dark** (default) and **Light** instantly.

- The choice is saved to `localStorage` (`td_theme`) and applied before the first chart paints (no flash).
- CSS is driven by tokens on `:root` / `:root[data-theme="light"]`, so every panel, control, and modal re-themes coherently.
- Chart canvases re-theme too — background, grid, axis borders, crosshair. Existing chart data isn't reloaded; only styling changes.
- Semantic colors (green/red for up/down, indicator swatches) stay the same in both themes.

---

## Interaction QoL

- **Crosshair sync** — moving the mouse over one chart shows a synchronized vertical line at the same time slice on every other open pane. Each pane shows its own price at that time on the horizontal label.
- **Full-screen** — double-click anywhere on a pane (except the controls row) → expands to fill the screen. Double-click again, or press Escape, to exit.
- **Active pane** — the last pane you clicked is highlighted in blue and becomes the target for watchlist clicks. Defaults to pane 1 on load.
- **Esc key** has a priority order: exit fullscreen first if any, otherwise close any open modal.

---

## Persistence

The dashboard saves these to `localStorage` so they survive reloads:

| Key | Contents |
|---|---|
| `td_count` | Number of chart panes |
| `td_panes` | Per-pane: source, symbol, interval, active indicators, drawings, comparison |
| `td_theme` | `'dark'` or `'light'` |
| `td_ind_colors` | User-overridden indicator colors |
| `td_watchlist` | List of watchlist symbols |
| `td_alerts` | Alert definitions |

Alert definitions and the Telegram bot token are the only two pieces of "state" that aren't fully local — the token lives in a server-side `.env` file (see Running it).

---

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│  Browser (templates/index.html + static/js/dashboard.js)    │
│  ┌─────────────────────────────────────────────────────┐    │
│  │  N Pane instances (one per chart slot)              │    │
│  │  ├─ lightweight-charts canvas (candles + lines)     │    │
│  │  ├─ custom <canvas> overlay (FVG, Volume Profile)   │    │
│  │  ├─ on-chart legend chips (active indicators)       │    │
│  │  ├─ drawing tool (horizontal price lines)           │    │
│  │  ├─ compare overlay (rebased second symbol)         │    │
│  │  └─ All indicator math (calcRSI, calcMACD, …)       │    │
│  ├─ Watchlist tiles (poll /api/candles every 30s)      │    │
│  ├─ Alerts engine (browser-side detection on each tick)│    │
│  ├─ Backtest engine (replays XO Trend signals)         │    │
│  └─ Crosshair sync, fullscreen, theme, color overrides │    │
└──────┬──────────────────────────────┬───────────────────────┘
       │                              │
   REST: /api/candles            WS:  wss://api.hyperliquid.xyz/ws
   REST: /api/price              REST: api.hyperliquid.xyz/info
   POST: /api/notify             (crypto data, direct from browser)
   GET:  /api/notify/status
       │
       ▼
┌──────────────────────────┐         ┌──────────────────────────┐
│  Flask backend (app.py)  │ ──────▶ │  Telegram Bot API        │
│  ├─ 30s TTL cache        │         │  api.telegram.org        │
│  ├─ /api/notify proxy    │         └──────────────────────────┘
│  ├─ Reads .env via       │
│  │   python-dotenv       │
│  └─ data_source.py       │
│       ├─ yfinance        │
│       └─ Hyperliquid     │
│            symbol list   │
└──────────┬───────────────┘
           │
           ▼
┌──────────────────────────┐
│  Yahoo Finance (yfinance)│
│  - US + Indian stocks    │
│  - OHLCV history         │
│  - Last trade price      │
└──────────────────────────┘
```

**Key design choices:**

- **Crypto data bypasses Flask entirely.** Browser opens a direct WebSocket to Hyperliquid and pulls candle history via REST. Real-time tick latency is one network hop, and the Flask server doesn't need to scale with concurrent users.
- **Stocks go through Flask** because yfinance is a Python library. The Flask layer also adds a 30-second TTL cache so rapid edits don't hammer Yahoo.
- **All indicator computation, alert detection, and backtest simulation are client-side.** The server only ships candles. Browser computes RSI, MACD, etc., evaluates alert conditions on every tick, and replays strategies. Keeps the server stateless.
- **Telegram delivery is server-proxied.** Browser POSTs a message string to `/api/notify`; Flask reads the bot token + chat ID from `.env` and forwards to Telegram. The token never lives in the browser.
- **Pluggable data source.** `data_source.py` exposes a `DATA_SOURCE` dict (`get_candles`, `get_price`). Swap in Alpaca / Binance / Zerodha / Polygon by implementing those two functions and reassigning the dict.

---

## File layout

```
trading_dashboard/
├── app.py              # Flask routes + TTL cache + Telegram proxy
├── data_source.py      # yfinance adapter, symbol universes, Hyperliquid meta fetch
├── requirements.txt    # flask, flask-cors, yfinance, pandas, requests, python-dotenv
├── .env                # YOUR Telegram credentials (gitignore this — not in version control)
├── .env.example        # template for .env with setup instructions
├── README.md
├── templates/
│   └── index.html      # Page skeleton + topbar + grid + watchlist + modals + pane <template>
└── static/
    ├── css/style.css   # Theme tokens, dark+light variants, mobile media queries
    └── js/dashboard.js # Pane class, indicators, alerts, watchlist, backtest, compare, drawing
```

### What each file does

**`app.py`** — Routes:
- `GET /` — renders the dashboard HTML
- `GET /api/candles?symbol=X&interval=Y` — OHLCV history (cached 30s)
- `GET /api/price?symbol=X` — last trade price
- `GET /api/symbols` — symbol universes + supported timeframes
- `POST /api/notify` — proxies a message to the Telegram Bot API
- `GET /api/notify/test` — sends a test Telegram message
- `GET /api/notify/status` — reports whether `.env` is configured

**`data_source.py`** — Two concerns:
1. Data adapter: `get_yfinance_candles()` and `get_yfinance_price()`, plus an interval→lookback mapping (`1m` → 7 days, `1h` → 730 days, `1d` → 5 years, `1wk` → 10 years).
2. Symbol universes: 30 Indian stocks (`.NS` suffix), 50 US stocks. The Hyperliquid coin list is fetched dynamically at startup from `https://api.hyperliquid.xyz/info` with a hardcoded fallback.

**`.env`** — Telegram credentials, read at server startup by `python-dotenv`:
```
TELEGRAM_BOT_TOKEN=<your bot token from @BotFather>
TELEGRAM_CHAT_ID=<your chat id from @userinfobot>
```

**`templates/index.html`** — Static skeleton:
- Topbar: chart-count dropdown, theme dropdown, BACKTEST + ALERTS buttons, status pills, HL connection dot
- Empty grid container the JS fills
- Watchlist strip
- Alerts modal + Backtest modal
- `<template id="pane-template">` — per-pane controls (source / symbol / interval / VS button / DRAW button / indicator menu / ticker)
- Inline `<script>` block injects symbol lists from the server into the page

**`static/css/style.css`** — Theme variables, dropdown / pill / chart / modal / watchlist styling, mobile media queries.

**`static/js/dashboard.js`** — Everything client-side:
- 23 indicator calculation functions (`calcSMA`, `calcMACD`, `calcXOTrend`, `calcStochRSI`, `calcVolumeProfile`, `calcFVGs`, etc.)
- `HLSocket` singleton — Hyperliquid WebSocket with auto-reconnect and per-coin subscriber map
- `Pane` class — per-chart state (data fetching, live updates, indicators, drawings, compare, ticker, legend, crosshair-sync hook, fullscreen)
- `WatchTile` class + watchlist module — symbol list CRUD, 30s polling, click-to-load
- Alerts module — alert CRUD, browser-side detection, `notifyTelegram()` POST helper, modal wiring
- Backtest module — `simulateXOTrend()`, results rendering, modal wiring
- `setChartCount()` — tears down old panes, creates the grid, restores saved configs
- Boot: restore theme + watchlist + alerts + chart count → connect HL socket → attach event listeners

---

## Running it

```powershell
pip install -r requirements.txt
python app.py
```

Open `http://127.0.0.1:5000`.

### Telegram setup (one-time, optional)

1. Open Telegram → message `@BotFather` → `/newbot` → follow prompts → copy the bot **token**.
2. Send `/start` to your bot (required, otherwise the bot can't message you).
3. Get your **chat ID**: either message `@userinfobot` (it replies with your ID), or visit `https://api.telegram.org/bot<YOUR_TOKEN>/getUpdates` and look for `"chat":{"id":<NUMBER>}`.
4. Copy `.env.example` to `.env` and fill in both values:
   ```
   TELEGRAM_BOT_TOKEN=...
   TELEGRAM_CHAT_ID=...
   ```
5. Restart `python app.py` (Python code doesn't auto-reload — see note below).
6. Open the dashboard → ALERTS → **Test message** to verify.

### Server restart caveat

[app.py](app.py) starts with `use_reloader=False`. Edits to Python files (`app.py`, `data_source.py`, `.env`) **won't take effect until you Ctrl+C and restart**. Template / CSS / JS edits hot-reload — just refresh the browser.

---

## Known limitations

- **yfinance rate limits.** Yahoo throttles requests aggressively from shared cloud IPs. Runs fine locally; flaky if deployed to Render / Fly.io / etc. Crypto (Hyperliquid) is unaffected because it talks directly to the browser.
- **Browser-side alert detection.** Alerts only fire while the dashboard tab is open and the symbol has a pane visible. True 24/7 alerts require a server-side worker (on the roadmap).
- **Sub-minute timeframes not available.** Both yfinance and Hyperliquid's `candleSnapshot` endpoint bottom out at 1m. The Hyperliquid trade stream provides sub-second tick data live, but historical sub-minute candles don't exist.
- **Ichimoku cloud is not filled.** `lightweight-charts` v4 has no native band-fill between two line series. The two Senkou lines are drawn, but the area between them is not colored.
- **Pivot Points use the last completed candle, not the previous trading session.** Technically pivots are computed from the prior session's H/L/C; this implementation approximates by using the most recent bar.
- **Multiple oscillators overlap visually.** Each oscillator has its own internal price scale (correctly auto-fitting), but they all draw in the same bottom 28% strip. One or two at a time looks clean; five at once is messy.
- **Per-bar candle coloring** (from the XO Trend Pine script) isn't supported — `lightweight-charts` v4 candle series only takes one up/down color pair.
- **Drawing tools = horizontal lines only.** Trend lines and Fibonacci retracements are on the roadmap.
- **Backtest is MVP-only.** Long-only, full-balance trades, no slippage, no commission, no leverage. XO Trend strategy only. Use it to evaluate indicator behaviour, not to size real trades.
- **No authentication.** The Flask server has no login. Fine for `127.0.0.1`; do not expose to the internet without a reverse proxy + auth.

---

## Roadmap

Backlog of features discussed but not yet built:

- **Server-side alerts** — detection moves to a Flask background process so alerts fire even with the tab closed. Needs decisions on where alert state lives, how it coexists with browser-side detection, and how to get crypto data server-side.
- **More backtest strategies** — RSI, MACD, manual mix; slippage and commission models; position sizing; equity-curve chart overlay; signal markers on the source chart.
- **Drawing tools — trend lines and Fib retracements.** Needs proper hit-testing / drag system on top of the existing canvas overlay.
- **Server-side 24/7 monitoring** of the watchlist — currently it only polls while the tab is open.
- **Indicator parameter customization** — let the user change `(period, smooth)` etc. per indicator rather than hardcoded defaults.
- **Strategy editor** — define custom buy/sell conditions in a UI (e.g. "RSI < 30 AND price > SMA50" → enter; "RSI > 70" → exit).
