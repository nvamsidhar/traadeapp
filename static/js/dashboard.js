'use strict';

// ── Constants ──────────────────────────────────────────────────────────────────

const LAYOUTS = {
  1: { cols: 1, rows: 1 },
  2: { cols: 2, rows: 1 },
  4: { cols: 2, rows: 2 },
  6: { cols: 3, rows: 2 },
  8: { cols: 4, rows: 2 },
};

const HL_WS_URL   = 'wss://api.hyperliquid.xyz/ws';
const HL_REST_URL = 'https://api.hyperliquid.xyz/info';
const FLASK_URL   = '';

const LS_COUNT = 'td_count';
const LS_PANES = 'td_panes';
const LS_THEME = 'td_theme';

// ── Chart themes (mirrors the CSS tokens for lightweight-charts options) ─────
const CHART_THEMES = {
  dark: {
    layout:    { background: { color: '#0c0c14' }, textColor: '#505068' },
    grid:      { vertLines: { color: '#12121e' }, horzLines: { color: '#12121e' } },
    crosshair: { vertLine: { color: '#334', labelBackgroundColor: '#3b5ff5' },
                 horzLine: { color: '#334', labelBackgroundColor: '#3b5ff5' } },
    scaleBorder: '#1a1a2e',
  },
  light: {
    layout:    { background: { color: '#ffffff' }, textColor: '#4a4a5a' },
    grid:      { vertLines: { color: '#eef0f4' }, horzLines: { color: '#eef0f4' } },
    crosshair: { vertLine: { color: '#b0b0c0', labelBackgroundColor: '#3b5ff5' },
                 horzLine: { color: '#b0b0c0', labelBackgroundColor: '#3b5ff5' } },
    scaleBorder: '#d8d8e0',
  },
};

function getActiveTheme() {
  return document.documentElement.getAttribute('data-theme') === 'light' ? 'light' : 'dark';
}

function applyDocumentTheme(name) {
  if (name === 'light') document.documentElement.setAttribute('data-theme', 'light');
  else                  document.documentElement.removeAttribute('data-theme');
  try { localStorage.setItem(LS_THEME, name); } catch {}
}

// Display labels + swatch colors for the on-chart "active indicators" legend
const INDICATOR_META = {
  sma20:      { label: 'SMA 20',      color: '#f59e0b' },
  sma50:      { label: 'SMA 50',      color: '#a855f7' },
  ema12:      { label: 'EMA 12',      color: '#06b6d4' },
  ema26:      { label: 'EMA 26',      color: '#ec4899' },
  bb:         { label: 'BB',          color: '#6366f1' },
  vwap:       { label: 'VWAP',        color: '#f97316' },
  supertrend: { label: 'Supertrend',  color: '#a855f7' },
  ichimoku:   { label: 'Ichimoku',    color: '#06b6d4' },
  pivots:     { label: 'Pivots',      color: '#888' },
  xo:         { label: 'XO Trend',    color: '#22c55e' },
  fvg:        { label: 'FVG',         color: '#eab308' },
  vp:         { label: 'Vol Profile', color: '#22c55e' },
  volume:     { label: 'Volume',      color: '#888' },
  rsi:        { label: 'RSI 14',      color: '#a855f7' },
  macd:       { label: 'MACD',        color: '#06b6d4' },
  stoch:      { label: 'Stoch',       color: '#f59e0b' },
  stochrsi:   { label: 'Stoch RSI',   color: '#d946ef' },
  atr:        { label: 'ATR',         color: '#22c55e' },
  adx:        { label: 'ADX',         color: '#ef4444' },
  cci:        { label: 'CCI',         color: '#f97316' },
  obv:        { label: 'OBV',         color: '#3b82f6' },
  mfi:        { label: 'MFI',         color: '#ef4444' },
  wr:         { label: 'Williams %R', color: '#e5e5e5' },
};

const LS_IND_COLORS  = 'td_ind_colors';
const LS_IND_PERIODS = 'td_ind_periods';
const LS_MAGNET      = 'td_magnet';

// Magnet Mode is global: a single flag in localStorage, mirrored across every
// pane's drawing toolbar. When ON, drawing-tool clicks snap to the nearest
// O / H / L / C of the candle under the cursor instead of the raw click price.
function isMagnetOn() {
  try { return localStorage.getItem(LS_MAGNET) === '1'; } catch { return false; }
}
function setMagnet(on) {
  try { localStorage.setItem(LS_MAGNET, on ? '1' : '0'); } catch {}
}

// Return whichever of candle.open/high/low/close is closest to `price`,
// plus a label (so callers can show which level was picked).
function snapToOHLC(candle, price) {
  if (!candle) return { price, label: null };
  const opts = [
    { name: 'O', value: candle.open  },
    { name: 'H', value: candle.high  },
    { name: 'L', value: candle.low   },
    { name: 'C', value: candle.close },
  ];
  let best = opts[0], bestD = Math.abs(opts[0].value - price);
  for (let i = 1; i < opts.length; i++) {
    const d = Math.abs(opts[i].value - price);
    if (d < bestD) { bestD = d; best = opts[i]; }
  }
  return { price: best.value, label: best.name };
}

// Default periods for indicators that accept user-tunable lookback windows.
// (Only the moving-average rows expose this in the UI for now; we can extend
// to RSI / Stoch / ATR / etc. later by adding period-inputs in the menu.)
const DEFAULT_PERIODS = { sma20: 20, sma50: 50, ema12: 12, ema26: 26 };

function getIndPeriod(key) {
  try {
    const o = JSON.parse(localStorage.getItem(LS_IND_PERIODS) ?? '{}');
    if (Number.isFinite(o[key])) return o[key];
  } catch {}
  return DEFAULT_PERIODS[key] ?? 14;
}
function setIndPeriod(key, period) {
  try {
    const o = JSON.parse(localStorage.getItem(LS_IND_PERIODS) ?? '{}');
    o[key] = period;
    localStorage.setItem(LS_IND_PERIODS, JSON.stringify(o));
  } catch {}
}

// User color overrides for indicators (localStorage-backed, shared across panes)
function getIndColor(key) {
  try {
    const o = JSON.parse(localStorage.getItem(LS_IND_COLORS) ?? '{}');
    if (o[key]) return o[key];
  } catch {}
  return INDICATOR_META[key]?.color ?? '#888';
}
function setIndColor(key, color) {
  try {
    const o = JSON.parse(localStorage.getItem(LS_IND_COLORS) ?? '{}');
    o[key] = color;
    localStorage.setItem(LS_IND_COLORS, JSON.stringify(o));
  } catch {}
}

// Singleton hidden <input type="color"> reused for every swatch click
let _colorPickerEl = null;
function openColorPicker(initial, onChange) {
  if (!_colorPickerEl) {
    _colorPickerEl = document.createElement('input');
    _colorPickerEl.type = 'color';
    _colorPickerEl.style.cssText = 'position:fixed;left:0;top:0;width:0;height:0;opacity:0;pointer-events:none;';
    document.body.appendChild(_colorPickerEl);
  }
  _colorPickerEl.value = initial;
  _colorPickerEl.oninput = () => onChange(_colorPickerEl.value);
  _colorPickerEl.click();
}

// Source → symbol list mapping
const SOURCE_SYMBOLS = {
  crypto: CRYPTO_SYMBOLS,
  us:     US_STOCKS,
  india:  INDIAN_STOCKS,
};

// ── Utilities ──────────────────────────────────────────────────────────────────

function fmtPrice(n) {
  if (n == null || isNaN(n)) return '--';
  const abs = Math.abs(n);
  const dec = abs >= 1000 ? 2 : abs >= 1 ? 3 : abs >= 0.01 ? 5 : 7;
  return n.toLocaleString('en-US', { minimumFractionDigits: dec, maximumFractionDigits: dec });
}

// Compact label formatter for the oscillator sub-pane right-axis labels.
// Volume / OBV → K/M/B suffix; RSI-style 0-100 → integer; everything else → ≤1 decimal.
function _formatSubPaneLabel(v, indicatorKey) {
  if (v == null || !isFinite(v)) return '';
  if (indicatorKey === 'volume' || indicatorKey === 'obv') {
    const a = Math.abs(v);
    if (a >= 1e9) return (v / 1e9).toFixed(2) + 'B';
    if (a >= 1e6) return (v / 1e6).toFixed(2) + 'M';
    if (a >= 1e3) return (v / 1e3).toFixed(1) + 'K';
    return v.toFixed(0);
  }
  if (['rsi','stoch','stochrsi','mfi'].includes(indicatorKey)) return v.toFixed(0);
  const abs = Math.abs(v);
  if (abs >= 100) return v.toFixed(0);
  if (abs >= 10)  return v.toFixed(1);
  if (abs >= 1)   return v.toFixed(2);
  return v.toFixed(3);
}

const INTERVAL_SECS = {
  '1m': 60, '5m': 300, '15m': 900, '30m': 1800,
  '1h': 3600, '4h': 14400, '1d': 86400, '1wk': 604800,
};

const HL_LOOKBACK = {
  '1m':  3   * 86400_000, '5m':  14  * 86400_000, '15m': 30  * 86400_000,
  '30m': 60  * 86400_000, '1h':  180 * 86400_000, '4h':  720 * 86400_000,
  '1d':  730 * 86400_000, '1wk': 1460* 86400_000,
};

/** Resolve what yfinance symbol to use given source + raw input. */
function resolveSymbol(source, raw) {
  const s = raw.trim().toUpperCase();
  if (!s) return '';
  if (source === 'crypto') return s;        // Hyperliquid coin name
  if (source === 'india')  return s.endsWith('.NS') ? s : s + '.NS';
  // US — plain ticker
  return s;
}

/** Determine whether a resolved symbol should use Hyperliquid or Flask. */
function isCrypto(source) { return source === 'crypto'; }

// ── Market hours detection ────────────────────────────────────────────────────

function isUSMarketOpen() {
  const et = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/New_York' }));
  const d = et.getDay();
  if (d === 0 || d === 6) return false;
  const m = et.getHours() * 60 + et.getMinutes();
  return m >= 570 && m < 960;
}

function isINMarketOpen() {
  const ist = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Kolkata' }));
  const d = ist.getDay();
  if (d === 0 || d === 6) return false;
  const m = ist.getHours() * 60 + ist.getMinutes();
  return m >= 555 && m < 930;
}

function updateMarketStatus() {
  const usOpen = isUSMarketOpen();
  const inOpen = isINMarketOpen();

  document.getElementById('usStatus').className = `status-dot ${usOpen ? 'open' : 'closed'}`;
  document.getElementById('inStatus').className = `status-dot ${inOpen ? 'open' : 'closed'}`;

  const usPill = document.getElementById('usPill');
  const inPill = document.getElementById('inPill');
  usPill.querySelector('.status-text').textContent = usOpen ? 'US market open' : 'US market closed';
  inPill.querySelector('.status-text').textContent = inOpen ? 'IN market open' : 'IN market closed';
  usPill.classList.toggle('live', usOpen);
  inPill.classList.toggle('live', inOpen);
}

// ── Technical Indicators ──────────────────────────────────────────────────────

function calcSMA(candles, period) {
  const r = [];
  for (let i = period - 1; i < candles.length; i++) {
    let sum = 0;
    for (let j = i - period + 1; j <= i; j++) sum += candles[j].close;
    r.push({ time: candles[i].time, value: sum / period });
  }
  return r;
}

function calcEMA(candles, period) {
  const r = [], k = 2 / (period + 1);
  let ema = null;
  for (let i = 0; i < candles.length; i++) {
    if (ema === null) {
      if (i < period - 1) continue;
      let sum = 0;
      for (let j = i - period + 1; j <= i; j++) sum += candles[j].close;
      ema = sum / period;
    } else {
      ema = candles[i].close * k + ema * (1 - k);
    }
    r.push({ time: candles[i].time, value: ema });
  }
  return r;
}

function calcBB(candles, period = 20, mult = 2) {
  const upper = [], mid = [], lower = [];
  for (let i = period - 1; i < candles.length; i++) {
    let sum = 0;
    for (let j = i - period + 1; j <= i; j++) sum += candles[j].close;
    const mean = sum / period;
    let sq = 0;
    for (let j = i - period + 1; j <= i; j++) sq += (candles[j].close - mean) ** 2;
    const std = Math.sqrt(sq / period);
    const t = candles[i].time;
    upper.push({ time: t, value: mean + mult * std });
    mid.push({ time: t, value: mean });
    lower.push({ time: t, value: mean - mult * std });
  }
  return { upper, mid, lower };
}

function calcVWAP(candles) {
  const r = [];
  let cumVol = 0, cumTPV = 0, lastDate = null;
  for (const c of candles) {
    const d = new Date(c.time * 1000);
    const ds = `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
    if (ds !== lastDate) { cumVol = 0; cumTPV = 0; lastDate = ds; }
    const tp = (c.high + c.low + c.close) / 3;
    const vol = c.volume || 1;
    cumTPV += tp * vol;
    cumVol += vol;
    r.push({ time: c.time, value: cumTPV / cumVol });
  }
  return r;
}

// ── Helpers used by ATR-based indicators ─────────────────────────────────────
function trueRange(c, prev) {
  if (!prev) return c.high - c.low;
  return Math.max(c.high - c.low, Math.abs(c.high - prev.close), Math.abs(c.low - prev.close));
}

function wilderSmooth(values, period) {
  const r = [];
  if (values.length < period) return r;
  let sum = 0;
  for (let i = 0; i < period; i++) sum += values[i];
  let prev = sum / period;
  r.push({ idx: period - 1, value: prev });
  for (let i = period; i < values.length; i++) {
    prev = (prev * (period - 1) + values[i]) / period;
    r.push({ idx: i, value: prev });
  }
  return r;
}

function calcATR(candles, period = 14) {
  const trs = candles.map((c, i) => trueRange(c, candles[i - 1]));
  const smoothed = wilderSmooth(trs, period);
  return smoothed.map(s => ({ time: candles[s.idx].time, value: s.value }));
}

// ── Supertrend (10, 3) — emits up_line + down_line so segments can be colored ─
function calcSupertrend(candles, period = 10, mult = 3) {
  const trs = candles.map((c, i) => trueRange(c, candles[i - 1]));
  const atr = [];
  let prevAtr = null;
  for (let i = 0; i < candles.length; i++) {
    if (i < period - 1) { atr.push(null); continue; }
    if (i === period - 1) {
      let s = 0; for (let j = 0; j <= i; j++) s += trs[j];
      prevAtr = s / period;
    } else {
      prevAtr = (prevAtr * (period - 1) + trs[i]) / period;
    }
    atr.push(prevAtr);
  }
  const up = [], down = [];
  let direction = 1;             // 1 = uptrend (line below price), -1 = downtrend
  let finalUpper = null, finalLower = null;
  for (let i = 0; i < candles.length; i++) {
    if (atr[i] == null) continue;
    const c = candles[i];
    const hl2 = (c.high + c.low) / 2;
    const basicUpper = hl2 + mult * atr[i];
    const basicLower = hl2 - mult * atr[i];
    const prev = candles[i - 1];
    if (finalUpper == null) { finalUpper = basicUpper; finalLower = basicLower; }
    else {
      finalUpper = (basicUpper < finalUpper || (prev && prev.close > finalUpper)) ? basicUpper : finalUpper;
      finalLower = (basicLower > finalLower || (prev && prev.close < finalLower)) ? basicLower : finalLower;
    }
    if (direction === 1 && c.close < finalLower) direction = -1;
    else if (direction === -1 && c.close > finalUpper) direction = 1;
    if (direction === 1) up.push({ time: c.time, value: finalLower });
    else down.push({ time: c.time, value: finalUpper });
  }
  return { up, down };
}

// ── Ichimoku ─────────────────────────────────────────────────────────────────
function _hhll(candles, i, n) {
  let hh = -Infinity, ll = Infinity;
  for (let j = Math.max(0, i - n + 1); j <= i; j++) {
    if (candles[j].high > hh) hh = candles[j].high;
    if (candles[j].low  < ll) ll = candles[j].low;
  }
  return [hh, ll];
}
function calcIchimoku(candles, tenkanP = 9, kijunP = 26, senkouBP = 52, shift = 26) {
  const tenkan = [], kijun = [], spanA = [], spanB = [], chikou = [];
  const intervalSec = candles.length >= 2 ? (candles[1].time - candles[0].time) : 86400;
  for (let i = 0; i < candles.length; i++) {
    const [hT, lT] = _hhll(candles, i, tenkanP);
    const [hK, lK] = _hhll(candles, i, kijunP);
    const [hB, lB] = _hhll(candles, i, senkouBP);
    const t = candles[i].time;
    if (i >= tenkanP - 1) tenkan.push({ time: t, value: (hT + lT) / 2 });
    if (i >= kijunP  - 1) kijun .push({ time: t, value: (hK + lK) / 2 });
    if (i >= kijunP  - 1) spanA .push({ time: t + shift * intervalSec, value: ((hT + lT) / 2 + (hK + lK) / 2) / 2 });
    if (i >= senkouBP - 1) spanB.push({ time: t + shift * intervalSec, value: (hB + lB) / 2 });
    if (i >= shift) chikou.push({ time: candles[i - shift].time, value: candles[i].close });
  }
  return { tenkan, kijun, spanA, spanB, chikou };
}

// ── Classic Pivot Points (from last completed candle's H/L/C) ────────────────
function calcPivots(candles) {
  if (!candles.length) return null;
  const last = candles[candles.length - 1];
  const { high: H, low: L, close: C } = last;
  const P  = (H + L + C) / 3;
  return {
    P, R1: 2 * P - L, S1: 2 * P - H,
    R2: P + (H - L), S2: P - (H - L),
    R3: H + 2 * (P - L), S3: L - 2 * (H - P),
  };
}

// ── RSI (Wilder) ─────────────────────────────────────────────────────────────
function calcRSI(candles, period = 14) {
  const r = [];
  if (candles.length < period + 1) return r;
  let gain = 0, loss = 0;
  for (let i = 1; i <= period; i++) {
    const ch = candles[i].close - candles[i - 1].close;
    if (ch >= 0) gain += ch; else loss -= ch;
  }
  let avgG = gain / period, avgL = loss / period;
  r.push({ time: candles[period].time, value: 100 - 100 / (1 + (avgG / (avgL || 1e-12))) });
  for (let i = period + 1; i < candles.length; i++) {
    const ch = candles[i].close - candles[i - 1].close;
    const g = ch >= 0 ? ch : 0;
    const l = ch < 0 ? -ch : 0;
    avgG = (avgG * (period - 1) + g) / period;
    avgL = (avgL * (period - 1) + l) / period;
    r.push({ time: candles[i].time, value: 100 - 100 / (1 + (avgG / (avgL || 1e-12))) });
  }
  return r;
}

// ── MACD (12, 26, 9) ─────────────────────────────────────────────────────────
function _emaSeries(values, period) {
  const r = []; const k = 2 / (period + 1); let ema = null;
  for (let i = 0; i < values.length; i++) {
    if (ema === null) {
      if (i < period - 1) { r.push(null); continue; }
      let s = 0; for (let j = i - period + 1; j <= i; j++) s += values[j];
      ema = s / period;
    } else {
      ema = values[i] * k + ema * (1 - k);
    }
    r.push(ema);
  }
  return r;
}
function calcMACD(candles, fast = 12, slow = 26, signal = 9) {
  const closes = candles.map(c => c.close);
  const ef = _emaSeries(closes, fast);
  const es = _emaSeries(closes, slow);
  const macdRaw = ef.map((v, i) => (v != null && es[i] != null) ? v - es[i] : null);
  const sigRaw  = _emaSeries(macdRaw.map(v => v ?? 0), signal);
  const line = [], sig = [], hist = [];
  for (let i = 0; i < candles.length; i++) {
    if (macdRaw[i] == null) continue;
    line.push({ time: candles[i].time, value: macdRaw[i] });
    if (sigRaw[i] != null && i >= slow + signal - 2) {
      sig.push({ time: candles[i].time, value: sigRaw[i] });
      const h = macdRaw[i] - sigRaw[i];
      hist.push({ time: candles[i].time, value: h, color: h >= 0 ? 'rgba(34,197,94,0.7)' : 'rgba(239,68,68,0.7)' });
    }
  }
  return { line, sig, hist };
}

// ── Stochastic (14, 3, 3) ────────────────────────────────────────────────────
function calcStoch(candles, kP = 14, kSmooth = 3, dP = 3) {
  const kRaw = [];
  for (let i = 0; i < candles.length; i++) {
    if (i < kP - 1) { kRaw.push(null); continue; }
    const [hh, ll] = _hhll(candles, i, kP);
    kRaw.push(hh === ll ? 50 : ((candles[i].close - ll) / (hh - ll)) * 100);
  }
  const kSm = _smoothNullable(kRaw, kSmooth);
  const dSm = _smoothNullable(kSm, dP);
  const k = [], d = [];
  for (let i = 0; i < candles.length; i++) {
    if (kSm[i] != null) k.push({ time: candles[i].time, value: kSm[i] });
    if (dSm[i] != null) d.push({ time: candles[i].time, value: dSm[i] });
  }
  return { k, d };
}
function _smoothNullable(arr, period) {
  const out = new Array(arr.length).fill(null);
  for (let i = 0; i < arr.length; i++) {
    let s = 0, n = 0;
    for (let j = Math.max(0, i - period + 1); j <= i; j++) {
      if (arr[j] != null) { s += arr[j]; n++; }
    }
    if (n === period) out[i] = s / period;
  }
  return out;
}

// ── ADX (14) with +DI, -DI ───────────────────────────────────────────────────
function calcADX(candles, period = 14) {
  const tr = [], plusDM = [], minusDM = [];
  for (let i = 0; i < candles.length; i++) {
    if (i === 0) { tr.push(0); plusDM.push(0); minusDM.push(0); continue; }
    const c = candles[i], p = candles[i - 1];
    tr.push(Math.max(c.high - c.low, Math.abs(c.high - p.close), Math.abs(c.low - p.close)));
    const upMove   = c.high - p.high;
    const downMove = p.low  - c.low;
    plusDM .push(upMove   > downMove && upMove   > 0 ? upMove   : 0);
    minusDM.push(downMove > upMove   && downMove > 0 ? downMove : 0);
  }
  const trS  = wilderSmooth(tr,      period);
  const pdmS = wilderSmooth(plusDM,  period);
  const mdmS = wilderSmooth(minusDM, period);
  const plusDI = [], minusDI = [], dx = [];
  for (let i = 0; i < trS.length; i++) {
    const tv = trS[i].value || 1e-12;
    const pd = (pdmS[i].value / tv) * 100;
    const md = (mdmS[i].value / tv) * 100;
    plusDI .push({ time: candles[trS[i].idx].time, value: pd });
    minusDI.push({ time: candles[trS[i].idx].time, value: md });
    dx.push(((Math.abs(pd - md)) / ((pd + md) || 1e-12)) * 100);
  }
  const adxSmoothed = wilderSmooth(dx, period);
  const adx = adxSmoothed.map(s => ({ time: plusDI[s.idx].time, value: s.value }));
  return { adx, plusDI, minusDI };
}

// ── CCI (20) ─────────────────────────────────────────────────────────────────
function calcCCI(candles, period = 20) {
  const r = [];
  for (let i = period - 1; i < candles.length; i++) {
    let sum = 0;
    const tps = [];
    for (let j = i - period + 1; j <= i; j++) {
      const tp = (candles[j].high + candles[j].low + candles[j].close) / 3;
      tps.push(tp); sum += tp;
    }
    const mean = sum / period;
    let mad = 0;
    for (const tp of tps) mad += Math.abs(tp - mean);
    mad /= period;
    const tpNow = (candles[i].high + candles[i].low + candles[i].close) / 3;
    r.push({ time: candles[i].time, value: mad === 0 ? 0 : (tpNow - mean) / (0.015 * mad) });
  }
  return r;
}

// ── OBV ──────────────────────────────────────────────────────────────────────
function calcOBV(candles) {
  const r = []; let obv = 0;
  for (let i = 0; i < candles.length; i++) {
    if (i > 0) {
      const dc = candles[i].close - candles[i - 1].close;
      if (dc > 0) obv += candles[i].volume;
      else if (dc < 0) obv -= candles[i].volume;
    }
    r.push({ time: candles[i].time, value: obv });
  }
  return r;
}

// ── MFI (14) ─────────────────────────────────────────────────────────────────
function calcMFI(candles, period = 14) {
  const r = [];
  if (candles.length < period + 1) return r;
  const tp = candles.map(c => (c.high + c.low + c.close) / 3);
  const flow = tp.map((v, i) => v * candles[i].volume);
  for (let i = period; i < candles.length; i++) {
    let pos = 0, neg = 0;
    for (let j = i - period + 1; j <= i; j++) {
      if (tp[j] > tp[j - 1]) pos += flow[j];
      else if (tp[j] < tp[j - 1]) neg += flow[j];
    }
    const ratio = neg === 0 ? 100 : pos / neg;
    r.push({ time: candles[i].time, value: 100 - 100 / (1 + ratio) });
  }
  return r;
}

// ── Williams %R (14) ─────────────────────────────────────────────────────────
function calcWilliamsR(candles, period = 14) {
  const r = [];
  for (let i = period - 1; i < candles.length; i++) {
    const [hh, ll] = _hhll(candles, i, period);
    const v = hh === ll ? -50 : ((hh - candles[i].close) / (hh - ll)) * -100;
    r.push({ time: candles[i].time, value: v });
  }
  return r;
}

// ── Volume series (colored by candle direction) ──────────────────────────────
function calcVolumeBars(candles) {
  return candles.map(c => ({
    time:  c.time,
    value: c.volume,
    color: c.close >= c.open ? 'rgba(34,197,94,0.55)' : 'rgba(239,68,68,0.55)',
  }));
}

// ── Fair Value Gaps (3-candle imbalance) ─────────────────────────────────────
function calcFVGs(candles) {
  const gaps = [];
  for (let i = 1; i < candles.length - 1; i++) {
    const a = candles[i - 1], c = candles[i + 1];
    if (a.high < c.low) {
      gaps.push({ kind: 'bull', t0: a.time, t1: candles[candles.length - 1].time, lo: a.high, hi: c.low });
    } else if (a.low > c.high) {
      gaps.push({ kind: 'bear', t0: a.time, t1: candles[candles.length - 1].time, lo: c.high, hi: a.low });
    }
  }
  return gaps;
}

// ── Volume Profile (binned by typical price) ─────────────────────────────────
function calcVolumeProfile(candles, bins = 50, vaPct = 0.7) {
  if (!candles.length) return null;
  let lo = Infinity, hi = -Infinity;
  for (const c of candles) { if (c.low < lo) lo = c.low; if (c.high > hi) hi = c.high; }
  if (!isFinite(lo) || !isFinite(hi) || hi === lo) return null;
  const step = (hi - lo) / bins;
  const vol = new Array(bins).fill(0);
  let total = 0;
  for (const c of candles) {
    const tp = (c.high + c.low + c.close) / 3;
    let b = Math.floor((tp - lo) / step);
    if (b < 0) b = 0; else if (b >= bins) b = bins - 1;
    vol[b] += c.volume;
    total  += c.volume;
  }
  let poc = 0;
  for (let i = 1; i < bins; i++) if (vol[i] > vol[poc]) poc = i;
  // Expand outward from POC until vaPct of total volume is included
  let included = vol[poc], lOut = poc, rOut = poc;
  while (included < total * vaPct && (lOut > 0 || rOut < bins - 1)) {
    const left  = lOut > 0           ? vol[lOut - 1] : -1;
    const right = rOut < bins - 1    ? vol[rOut + 1] : -1;
    if (right >= left) { rOut++; included += vol[rOut]; }
    else               { lOut--; included += vol[lOut]; }
  }
  return {
    lo, hi, step, bins, vol, poc,
    vaLo: lo + lOut * step,
    vaHi: lo + (rOut + 1) * step,
    maxVol: Math.max(...vol),
  };
}

// ── XO Trend (Trader XO Macro Trend Scanner — EMA 12 / EMA 25 crossover) ─────
// Returns: two-segment line pairs (so the color flips at each crossover) +
// triangle markers at the fresh-crossover bars.
function calcXOTrend(candles, fastP = 12, slowP = 25) {
  const closes = candles.map(c => c.close);
  const ef = _emaSeries(closes, fastP);
  const es = _emaSeries(closes, slowP);
  const fastUp = [], fastDown = [], slowUp = [], slowDown = [];
  const markers = [];
  let prevBuy = null;
  for (let i = 0; i < candles.length; i++) {
    if (ef[i] == null || es[i] == null) continue;
    const t = candles[i].time;
    const buy = ef[i] > es[i];
    if (buy) {
      fastUp.push({ time: t, value: ef[i] });
      slowUp.push({ time: t, value: es[i] });
    } else {
      fastDown.push({ time: t, value: ef[i] });
      slowDown.push({ time: t, value: es[i] });
    }
    // Fresh crossover → fire a marker on the bar that confirmed the flip
    if (prevBuy !== null && buy !== prevBuy) {
      if (buy) markers.push({ time: t, position: 'belowBar', color: '#22c55e', shape: 'arrowUp',   text: 'Bull' });
      else     markers.push({ time: t, position: 'aboveBar', color: '#ef4444', shape: 'arrowDown', text: 'Bear' });
    }
    prevBuy = buy;
  }
  return { fastUp, fastDown, slowUp, slowDown, markers };
}

// ── Stochastic RSI (StochRSI applied to RSI values, not price) ───────────────
function calcStochRSI(candles, rsiLen = 14, stochLen = 14, smoothK = 3, smoothD = 3) {
  const rsiPts = calcRSI(candles, rsiLen);            // [{time, value}, …] aligned to candles after RSI warmup
  if (rsiPts.length < stochLen) return { k: [], d: [] };
  // Build the raw stochastic-of-RSI series
  const rawSto = new Array(rsiPts.length).fill(null);
  for (let i = stochLen - 1; i < rsiPts.length; i++) {
    let hh = -Infinity, ll = Infinity;
    for (let j = i - stochLen + 1; j <= i; j++) {
      const v = rsiPts[j].value;
      if (v > hh) hh = v; if (v < ll) ll = v;
    }
    rawSto[i] = hh === ll ? 50 : ((rsiPts[i].value - ll) / (hh - ll)) * 100;
  }
  const kArr = _smoothNullable(rawSto, smoothK);
  const dArr = _smoothNullable(kArr,   smoothD);
  const k = [], d = [];
  for (let i = 0; i < rsiPts.length; i++) {
    if (kArr[i] != null) k.push({ time: rsiPts[i].time, value: kArr[i] });
    if (dArr[i] != null) d.push({ time: rsiPts[i].time, value: dArr[i] });
  }
  return { k, d };
}

// ── Live indicator interpretation ────────────────────────────────────────────
//
// For a given indicator key + the pane's current candles, return:
//   { value:    short numeric/positional readout (e.g. "72", "POC 47821", "uptrend")
//     verdict:  one-or-two-word label (e.g. "overbought", "bullish")
//     tone:     'up' | 'down' | 'warn' | 'neutral' — for verdict coloring
//     tooltip:  longer plain-English explanation for the hover tooltip
//   }
// These translate the raw indicator math into trader-language context so the
// active-indicator chips at the top of each chart say what the number means.

function interpretIndicator(key, pane) {
  const c = pane.candles;
  if (!c || c.length < 2) return { value: '--', verdict: '', tone: 'neutral', tooltip: 'Waiting for data…' };
  const last = c[c.length - 1];

  switch (key) {
    case 'sma20':
    case 'sma50':
    case 'ema12':
    case 'ema26': {
      const period = getIndPeriod(key);
      const fn = (key === 'sma20' || key === 'sma50') ? calcSMA : calcEMA;
      const s = fn(c, period);
      if (!s.length) return { value: '--', verdict: '', tone: 'neutral', tooltip: '' };
      const v = s[s.length - 1].value;
      const above = last.close > v;
      const kind = (key === 'sma20' || key === 'sma50') ? 'SMA' : 'EMA';
      return {
        value: fmtPrice(v),
        verdict: above ? 'price above' : 'price below',
        tone: above ? 'up' : 'down',
        tooltip: `${kind}(${period}) at ${fmtPrice(v)}. Price is ${above ? 'above the MA (bullish bias)' : 'below the MA (bearish bias)'}.`,
      };
    }

    case 'vwap': {
      const s = calcVWAP(c);
      if (!s.length) return { value: '--', verdict: '', tone: 'neutral', tooltip: '' };
      const v = s[s.length - 1].value;
      const above = last.close > v;
      return {
        value: fmtPrice(v),
        verdict: above ? 'above VWAP' : 'below VWAP',
        tone: above ? 'up' : 'down',
        tooltip: `VWAP at ${fmtPrice(v)}. Price ${above ? 'above VWAP — buyers in control' : 'below VWAP — sellers in control'} for the session.`,
      };
    }

    case 'bb': {
      const bb = calcBB(c);
      if (!bb.mid.length) return { value: '--', verdict: '', tone: 'neutral', tooltip: '' };
      const u = bb.upper[bb.upper.length - 1].value;
      const m = bb.mid[bb.mid.length - 1].value;
      const l = bb.lower[bb.lower.length - 1].value;
      const p = last.close;
      let pos, tone, verdict;
      if (p >= u)       { pos = 'at upper band';  verdict = 'extended high'; tone = 'warn'; }
      else if (p <= l)  { pos = 'at lower band';  verdict = 'extended low';  tone = 'warn'; }
      else if (p > m)   { pos = 'upper half';     verdict = 'bullish bias';  tone = 'up'; }
      else              { pos = 'lower half';     verdict = 'bearish bias';  tone = 'down'; }
      const bw = ((u - l) / m) * 100;
      return {
        value: pos,
        verdict,
        tone,
        tooltip: `Bollinger Bands (20, 2σ). Upper ${fmtPrice(u)}, Mid ${fmtPrice(m)}, Lower ${fmtPrice(l)}. Bandwidth ${bw.toFixed(2)}% — ${bw < 5 ? 'tight (squeeze, breakout likely)' : 'normal range'}.`,
      };
    }

    case 'supertrend': {
      const st = calcSupertrend(c);
      const tLast = last.time;
      const inUp   = st.up.length   && st.up[st.up.length - 1].time   === tLast;
      const inDown = st.down.length && st.down[st.down.length - 1].time === tLast;
      const dir = inUp ? 'uptrend' : inDown ? 'downtrend' : 'flipping';
      return {
        value: dir,
        verdict: inUp ? 'bullish' : inDown ? 'bearish' : 'flat',
        tone: inUp ? 'up' : inDown ? 'down' : 'neutral',
        tooltip: `Supertrend(10, 3): currently in ${dir}. Stay with the trend until a flip changes the bias.`,
      };
    }

    case 'ichimoku': {
      const ik = calcIchimoku(c);
      const tk = ik.tenkan[ik.tenkan.length - 1]?.value;
      const kj = ik.kijun[ik.kijun.length - 1]?.value;
      if (tk == null || kj == null) return { value: '--', verdict: '', tone: 'neutral', tooltip: '' };
      const tkAbove = tk > kj;
      const priceAboveK = last.close > kj;
      const bullish = tkAbove && priceAboveK;
      const bearish = !tkAbove && !priceAboveK;
      return {
        value: tkAbove ? 'TK > KJ' : 'TK < KJ',
        verdict: bullish ? 'bullish' : bearish ? 'bearish' : 'mixed',
        tone: bullish ? 'up' : bearish ? 'down' : 'warn',
        tooltip: `Ichimoku — Tenkan ${fmtPrice(tk)}, Kijun ${fmtPrice(kj)}. Price ${priceAboveK ? 'above' : 'below'} Kijun. ${tkAbove ? 'Tenkan above Kijun (bullish line)' : 'Tenkan below Kijun (bearish line)'}.`,
      };
    }

    case 'pivots': {
      const p = calcPivots(c);
      if (!p) return { value: '--', verdict: '', tone: 'neutral', tooltip: '' };
      const above = last.close > p.P;
      return {
        value: `P ${fmtPrice(p.P)}`,
        verdict: above ? 'above pivot' : 'below pivot',
        tone: above ? 'up' : 'down',
        tooltip: `Pivot ${fmtPrice(p.P)}, R1 ${fmtPrice(p.R1)}, S1 ${fmtPrice(p.S1)}. Price ${above ? 'above pivot = bullish' : 'below pivot = bearish'} floor-trader bias for the period.`,
      };
    }

    case 'xo': {
      const xo = calcXOTrend(c);
      if (!xo.markers.length) return { value: 'no signal yet', verdict: '', tone: 'neutral', tooltip: 'XO Trend: no Bull/Bear cross in this data set yet.' };
      const lastMk = xo.markers[xo.markers.length - 1];
      const idx = c.findIndex(x => x.time === lastMk.time);
      const barsAgo = idx >= 0 ? (c.length - 1 - idx) : 0;
      const isBull = lastMk.text === 'Bull';
      return {
        value: `${lastMk.text} · ${barsAgo} bars ago`,
        verdict: isBull ? 'long bias' : 'short bias',
        tone: isBull ? 'up' : 'down',
        tooltip: `XO Trend(12, 25): last signal was ${lastMk.text} ${barsAgo} bars ago — ${isBull ? 'uptrend, favor longs' : 'downtrend, favor shorts'} until the next opposite cross.`,
      };
    }

    case 'fvg': {
      const gaps = calcFVGs(c);
      const bullN = gaps.filter(g => g.kind === 'bull').length;
      const bearN = gaps.filter(g => g.kind === 'bear').length;
      return {
        value: `${bullN}↑ ${bearN}↓`,
        verdict: bullN > bearN ? 'bullish skew' : bearN > bullN ? 'bearish skew' : 'balanced',
        tone: bullN > bearN ? 'up' : bearN > bullN ? 'down' : 'neutral',
        tooltip: `Fair Value Gaps: ${bullN} bullish + ${bearN} bearish unfilled gaps. Price tends to return and fill these — they're magnets and potential reaction zones.`,
      };
    }

    case 'vp': {
      const vp = calcVolumeProfile(c);
      if (!vp) return { value: '--', verdict: '', tone: 'neutral', tooltip: '' };
      const pocPx = vp.lo + (vp.poc + 0.5) * vp.step;
      const abovePOC = last.close > pocPx;
      const inVA = last.close >= vp.vaLo && last.close <= vp.vaHi;
      return {
        value: `POC ${fmtPrice(pocPx)}`,
        verdict: abovePOC ? 'above POC' : 'below POC',
        tone: abovePOC ? 'up' : 'down',
        tooltip: `Volume Profile — POC (most-traded price) ${fmtPrice(pocPx)}, Value Area ${fmtPrice(vp.vaLo)}–${fmtPrice(vp.vaHi)}. Price ${inVA ? 'inside VA (fair value)' : abovePOC ? 'above VA (auction higher)' : 'below VA (auction lower)'}.`,
      };
    }

    case 'volume': {
      const vol = last.volume;
      const window = c.slice(-21, -1);
      if (window.length < 5) return { value: vol.toLocaleString(), verdict: '', tone: 'neutral', tooltip: '' };
      const avg = window.reduce((s, x) => s + x.volume, 0) / window.length;
      const ratio = avg ? vol / avg : 1;
      let verdict, tone;
      if (ratio > 1.5)      { verdict = 'high volume'; tone = 'up'; }
      else if (ratio < 0.5) { verdict = 'low volume';  tone = 'warn'; }
      else                  { verdict = 'avg volume';  tone = 'neutral'; }
      return {
        value: `${(ratio * 100).toFixed(0)}% of avg`,
        verdict,
        tone,
        tooltip: `Current bar volume ${vol.toLocaleString()} vs 20-bar avg ${avg.toFixed(0)}. ${ratio > 1.5 ? 'High volume confirms the move.' : ratio < 0.5 ? 'Low volume suggests indecision / weak move.' : 'Typical participation.'}`,
      };
    }

    case 'rsi': {
      const r = calcRSI(c);
      if (r.length < 2) return { value: '--', verdict: '', tone: 'neutral', tooltip: '' };
      const cur = r[r.length - 1].value;
      const prev = r[r.length - 2].value;
      const rising = cur > prev;
      let verdict, tone;
      if (cur > 70)      { verdict = 'overbought'; tone = 'warn'; }
      else if (cur < 30) { verdict = 'oversold';   tone = 'warn'; }
      else if (cur > 50) { verdict = 'bullish';    tone = 'up'; }
      else               { verdict = 'bearish';    tone = 'down'; }
      return {
        value: cur.toFixed(1),
        verdict,
        tone,
        tooltip: `RSI(14) = ${cur.toFixed(1)} (${rising ? 'rising' : 'falling'}). >70 overbought (watch for reversal), <30 oversold (watch for bounce), 50 = neutral momentum line.`,
      };
    }

    case 'macd': {
      const m = calcMACD(c);
      if (m.line.length < 2 || m.sig.length < 2) return { value: '--', verdict: '', tone: 'neutral', tooltip: '' };
      const line = m.line[m.line.length - 1].value;
      const sig  = m.sig [m.sig .length - 1].value;
      const hist = line - sig;
      const prevHist = m.line[m.line.length - 2].value - m.sig[m.sig.length - 2].value;
      const bull = line > sig;
      const growing = Math.abs(hist) > Math.abs(prevHist);
      return {
        value: `hist ${hist >= 0 ? '+' : ''}${hist.toFixed(3)}`,
        verdict: bull ? 'bullish' : 'bearish',
        tone: bull ? 'up' : 'down',
        tooltip: `MACD line ${bull ? 'above' : 'below'} signal — ${bull ? 'bullish' : 'bearish'}. Histogram ${growing ? 'expanding (momentum building)' : 'shrinking (momentum fading)'}.`,
      };
    }

    case 'stoch':
    case 'stochrsi': {
      const s = (key === 'stoch') ? calcStoch(c) : calcStochRSI(c);
      if (!s.k.length) return { value: '--', verdict: '', tone: 'neutral', tooltip: '' };
      const k = s.k[s.k.length - 1].value;
      const d = s.d[s.d.length - 1]?.value ?? 0;
      let verdict, tone;
      if (k > 80)      { verdict = 'overbought'; tone = 'warn'; }
      else if (k < 20) { verdict = 'oversold';   tone = 'warn'; }
      else             { verdict = k > d ? 'bullish' : 'bearish'; tone = k > d ? 'up' : 'down'; }
      const name = key === 'stoch' ? 'Stochastic' : 'Stoch RSI';
      return {
        value: `%K ${k.toFixed(1)}`,
        verdict,
        tone,
        tooltip: `${name} — %K=${k.toFixed(1)}, %D=${d.toFixed(1)}. >80 overbought, <20 oversold. %K ${k > d ? 'above %D (bullish)' : 'below %D (bearish)'}.${key === 'stochrsi' ? ' (More sensitive than plain Stoch.)' : ''}`,
      };
    }

    case 'atr': {
      const a = calcATR(c);
      if (!a.length) return { value: '--', verdict: '', tone: 'neutral', tooltip: '' };
      const cur = a[a.length - 1].value;
      const window = a.slice(-20);
      const avg = window.reduce((s, x) => s + x.value, 0) / window.length;
      const ratio = avg ? cur / avg : 1;
      const verdict = ratio > 1.3 ? 'high vol' : ratio < 0.7 ? 'low vol' : 'normal vol';
      return {
        value: fmtPrice(cur),
        verdict,
        tone: ratio > 1.3 ? 'warn' : 'neutral',
        tooltip: `ATR(14) = ${fmtPrice(cur)} (${(ratio * 100).toFixed(0)}% of 20-bar avg). Measures volatility — high ATR means wider bars, useful for sizing stop-losses.`,
      };
    }

    case 'adx': {
      const a = calcADX(c);
      if (!a.adx.length) return { value: '--', verdict: '', tone: 'neutral', tooltip: '' };
      const adx = a.adx[a.adx.length - 1].value;
      const pdi = a.plusDI[a.plusDI.length - 1].value;
      const mdi = a.minusDI[a.minusDI.length - 1].value;
      let strength, tone;
      if (adx > 25)      { strength = 'strong trend'; tone = 'up'; }
      else if (adx < 20) { strength = 'no trend';    tone = 'neutral'; }
      else               { strength = 'developing';  tone = 'warn'; }
      const dir = pdi > mdi ? 'bullish' : 'bearish';
      return {
        value: adx.toFixed(1),
        verdict: `${strength}, ${dir}`,
        tone: pdi > mdi ? tone : (tone === 'up' ? 'down' : tone),
        tooltip: `ADX(14) = ${adx.toFixed(1)} → ${strength}. +DI ${pdi.toFixed(1)}, -DI ${mdi.toFixed(1)} → ${dir}. ADX > 25 = trade trend strategies; ADX < 20 = trade range strategies.`,
      };
    }

    case 'cci': {
      const r = calcCCI(c);
      if (!r.length) return { value: '--', verdict: '', tone: 'neutral', tooltip: '' };
      const cur = r[r.length - 1].value;
      let verdict, tone;
      if (cur > 100)       { verdict = 'overbought'; tone = 'warn'; }
      else if (cur < -100) { verdict = 'oversold';   tone = 'warn'; }
      else                 { verdict = 'neutral';    tone = 'neutral'; }
      return {
        value: cur.toFixed(1),
        verdict,
        tone,
        tooltip: `CCI(20) = ${cur.toFixed(1)}. >+100 overbought, <-100 oversold, 0 = average. Measures deviation from the typical price.`,
      };
    }

    case 'obv': {
      const o = calcOBV(c);
      if (o.length < 10) return { value: '--', verdict: '', tone: 'neutral', tooltip: '' };
      const cur = o[o.length - 1].value;
      const ref = o[o.length - 11].value;
      const rising = cur > ref;
      return {
        value: rising ? 'rising' : 'falling',
        verdict: rising ? 'accumulation' : 'distribution',
        tone: rising ? 'up' : 'down',
        tooltip: `OBV ${rising ? 'rising over last 10 bars — accumulation, buyers committing' : 'falling over last 10 bars — distribution, sellers committing'}. Divergence from price (e.g. price up but OBV flat) signals a weak move.`,
      };
    }

    case 'mfi': {
      const r = calcMFI(c);
      if (!r.length) return { value: '--', verdict: '', tone: 'neutral', tooltip: '' };
      const cur = r[r.length - 1].value;
      let verdict, tone;
      if (cur > 80)      { verdict = 'overbought'; tone = 'warn'; }
      else if (cur < 20) { verdict = 'oversold';   tone = 'warn'; }
      else               { verdict = 'neutral';    tone = 'neutral'; }
      return {
        value: cur.toFixed(1),
        verdict,
        tone,
        tooltip: `MFI(14) = ${cur.toFixed(1)}. Like RSI but volume-weighted. >80 overbought, <20 oversold. Volume confirmation makes it a stronger reversal signal than RSI alone.`,
      };
    }

    case 'wr': {
      const r = calcWilliamsR(c);
      if (!r.length) return { value: '--', verdict: '', tone: 'neutral', tooltip: '' };
      const cur = r[r.length - 1].value;
      let verdict, tone;
      if (cur > -20)      { verdict = 'overbought'; tone = 'warn'; }
      else if (cur < -80) { verdict = 'oversold';   tone = 'warn'; }
      else                { verdict = 'neutral';    tone = 'neutral'; }
      return {
        value: cur.toFixed(1),
        verdict,
        tone,
        tooltip: `Williams %R(14) = ${cur.toFixed(1)}. Scale -100 to 0. >-20 overbought (sell zone), <-80 oversold (buy zone). Faster than RSI to flag extremes.`,
      };
    }
  }
  return { value: '', verdict: '', tone: 'neutral', tooltip: '' };
}

// ── Signal Summary — aggregate active indicators into per-category verdicts ──
//
// Each indicator → a category (trend / momentum / volume / volatility / regime).
// Each indicator contributes a directional bias (-1, 0, +1) and a weight.
// We average per-category, normalize to a verdict, and apply ADX as a regime
// filter so e.g. "RSI overbought" is muted when ADX shows a strong trend.

const INDICATOR_CATEGORY = {
  // Trend-direction
  sma20: 'trend', sma50: 'trend', ema12: 'trend', ema26: 'trend',
  vwap: 'trend',  supertrend: 'trend', ichimoku: 'trend', pivots: 'trend',
  xo: 'trend',    macd: 'trend',
  // Momentum oscillators
  rsi: 'momentum', stoch: 'momentum', stochrsi: 'momentum',
  cci: 'momentum', mfi: 'momentum',   wr: 'momentum',
  // Volume
  volume: 'volume', obv: 'volume',
  // Volatility / range
  bb: 'volatility', atr: 'volatility',
  // Regime
  adx: 'regime',
};

// Extracts a single indicator's directional bias and (for oscillators) exhaustion
// signal. Returns { dir: -1|0|1, exhausted: 'up'|'down'|null, weight: number }.
function getIndicatorBias(key, pane) {
  const c = pane.candles;
  if (!c || c.length < 2) return { dir: 0, exhausted: null, weight: 0 };
  const last = c[c.length - 1];

  switch (key) {
    case 'sma20': case 'sma50': case 'ema12': case 'ema26': {
      const fn = (key.startsWith('sma')) ? calcSMA : calcEMA;
      const s = fn(c, getIndPeriod(key));
      if (!s.length) return { dir: 0, exhausted: null, weight: 0 };
      return { dir: last.close > s[s.length-1].value ? 1 : -1, exhausted: null, weight: 1 };
    }
    case 'vwap': {
      const s = calcVWAP(c);
      if (!s.length) return { dir: 0, exhausted: null, weight: 0 };
      return { dir: last.close > s[s.length-1].value ? 1 : -1, exhausted: null, weight: 1 };
    }
    case 'supertrend': {
      const st = calcSupertrend(c);
      const inUp   = st.up.length   && st.up[st.up.length-1].time     === last.time;
      const inDown = st.down.length && st.down[st.down.length-1].time === last.time;
      return { dir: inUp ? 1 : inDown ? -1 : 0, exhausted: null, weight: 1.5 };
    }
    case 'ichimoku': {
      const ik = calcIchimoku(c);
      const tk = ik.tenkan[ik.tenkan.length-1]?.value;
      const kj = ik.kijun [ik.kijun .length-1]?.value;
      if (tk == null || kj == null) return { dir: 0, exhausted: null, weight: 0 };
      const tkAbove = tk > kj, priceAboveK = last.close > kj;
      if (tkAbove && priceAboveK)   return { dir:  1, exhausted: null, weight: 1.5 };
      if (!tkAbove && !priceAboveK) return { dir: -1, exhausted: null, weight: 1.5 };
      return { dir: 0, exhausted: null, weight: 0.5 };
    }
    case 'pivots': {
      const p = calcPivots(c);
      if (!p) return { dir: 0, exhausted: null, weight: 0 };
      return { dir: last.close > p.P ? 1 : -1, exhausted: null, weight: 0.7 };
    }
    case 'xo': {
      const xo = calcXOTrend(c);
      if (!xo.markers.length) return { dir: 0, exhausted: null, weight: 0 };
      const lm = xo.markers[xo.markers.length-1];
      return { dir: lm.text === 'Bull' ? 1 : -1, exhausted: null, weight: 2 };  // explicit strategy = high weight
    }
    case 'macd': {
      const m = calcMACD(c);
      if (m.line.length < 2 || m.sig.length < 2) return { dir: 0, exhausted: null, weight: 0 };
      const line = m.line[m.line.length-1].value;
      const sig  = m.sig [m.sig .length-1].value;
      return { dir: line > sig ? 1 : -1, exhausted: null, weight: 1.5 };
    }
    case 'rsi': {
      const r = calcRSI(c);
      if (!r.length) return { dir: 0, exhausted: null, weight: 0 };
      const cur = r[r.length-1].value;
      const exhausted = cur > 70 ? 'up' : cur < 30 ? 'down' : null;
      return { dir: cur > 55 ? 1 : cur < 45 ? -1 : 0, exhausted, weight: 1 };
    }
    case 'stoch': case 'stochrsi': {
      const s = key === 'stoch' ? calcStoch(c) : calcStochRSI(c);
      if (!s.k.length) return { dir: 0, exhausted: null, weight: 0 };
      const k = s.k[s.k.length-1].value;
      const d = s.d[s.d.length-1]?.value ?? 0;
      const exhausted = k > 80 ? 'up' : k < 20 ? 'down' : null;
      return { dir: k > d ? 1 : -1, exhausted, weight: 0.7 };
    }
    case 'cci': {
      const r = calcCCI(c);
      if (!r.length) return { dir: 0, exhausted: null, weight: 0 };
      const cur = r[r.length-1].value;
      const exhausted = cur > 100 ? 'up' : cur < -100 ? 'down' : null;
      return { dir: cur > 0 ? 1 : -1, exhausted, weight: 0.7 };
    }
    case 'mfi': {
      const r = calcMFI(c);
      if (!r.length) return { dir: 0, exhausted: null, weight: 0 };
      const cur = r[r.length-1].value;
      const exhausted = cur > 80 ? 'up' : cur < 20 ? 'down' : null;
      return { dir: cur > 50 ? 1 : -1, exhausted, weight: 0.9 };  // volume-weighted RSI, slightly stronger
    }
    case 'wr': {
      const r = calcWilliamsR(c);
      if (!r.length) return { dir: 0, exhausted: null, weight: 0 };
      const cur = r[r.length-1].value;
      const exhausted = cur > -20 ? 'up' : cur < -80 ? 'down' : null;
      return { dir: cur > -50 ? 1 : -1, exhausted, weight: 0.7 };
    }
    case 'volume': {
      const vol = last.volume;
      const window = c.slice(-21, -1);
      if (window.length < 5) return { dir: 0, exhausted: null, weight: 0 };
      const avg = window.reduce((s, x) => s + x.volume, 0) / window.length;
      const ratio = avg ? vol / avg : 1;
      const candleDir = last.close >= last.open ? 1 : -1;
      // High volume amplifies the direction of the current bar; low volume gives zero signal
      return { dir: ratio > 1.3 ? candleDir : 0, exhausted: null, weight: 1 };
    }
    case 'obv': {
      const o = calcOBV(c);
      if (o.length < 10) return { dir: 0, exhausted: null, weight: 0 };
      const cur = o[o.length-1].value, ref = o[o.length-11].value;
      return { dir: cur > ref ? 1 : -1, exhausted: null, weight: 0.8 };
    }
    case 'bb': {
      const bb = calcBB(c);
      if (!bb.mid.length) return { dir: 0, exhausted: null, weight: 0 };
      const m = bb.mid[bb.mid.length-1].value;
      const u = bb.upper[bb.upper.length-1].value;
      const l = bb.lower[bb.lower.length-1].value;
      const p = last.close;
      // Position above/below midline is direction; near a band is exhaustion warning
      const exhausted = p >= u * 0.998 ? 'up' : p <= l * 1.002 ? 'down' : null;
      return { dir: p > m ? 1 : -1, exhausted, weight: 0.5 };
    }
    case 'atr': case 'fvg': case 'vp': case 'adx':
      return { dir: 0, exhausted: null, weight: 0 };  // not directional in this aggregation
  }
  return { dir: 0, exhausted: null, weight: 0 };
}

// Detect bearish/bullish divergence between price swings and RSI over the last ~30 bars.
// Returns { type: 'bearish'|'bullish', indicator: 'RSI' } or null.
function detectDivergence(candles) {
  if (candles.length < 25) return null;
  const rsi = calcRSI(candles);
  if (rsi.length < 25) return null;
  const window = candles.slice(-30);
  const rsiWindow = rsi.slice(-30);
  const rsiByTime = new Map(rsiWindow.map(p => [p.time, p.value]));

  // Local-maxima/minima with N=3 neighborhood on each side
  const N = 3;
  const highs = [], lows = [];
  for (let i = N; i < window.length - N; i++) {
    let isHigh = true, isLow = true;
    for (let j = i - N; j <= i + N; j++) {
      if (j === i) continue;
      if (window[j].high >= window[i].high) isHigh = false;
      if (window[j].low  <= window[i].low ) isLow  = false;
    }
    if (isHigh) highs.push({ time: window[i].time, price: window[i].high });
    if (isLow ) lows .push({ time: window[i].time, price: window[i].low  });
  }

  if (highs.length >= 2) {
    const h1 = highs[highs.length - 2], h2 = highs[highs.length - 1];
    const r1 = rsiByTime.get(h1.time), r2 = rsiByTime.get(h2.time);
    if (r1 != null && r2 != null && h2.price > h1.price && r2 < r1) {
      return { type: 'bearish', indicator: 'RSI' };
    }
  }
  if (lows.length >= 2) {
    const l1 = lows[lows.length - 2], l2 = lows[lows.length - 1];
    const r1 = rsiByTime.get(l1.time), r2 = rsiByTime.get(l2.time);
    if (r1 != null && r2 != null && l2.price < l1.price && r2 > r1) {
      return { type: 'bullish', indicator: 'RSI' };
    }
  }
  return null;
}

// Build the per-pane signal summary — a small array of {category, verdict, tone, tooltip}
// chips that show the net read per category, regime-filtered by ADX.
function computeSignalSummary(pane) {
  const c = pane.candles;
  if (!c || c.length < 5) return [];

  const cats = {
    trend:      { score: 0, w: 0, exUp: 0, exDown: 0, n: 0 },
    momentum:   { score: 0, w: 0, exUp: 0, exDown: 0, n: 0 },
    volume:     { score: 0, w: 0, n: 0 },
    volatility: { score: 0, w: 0, exUp: 0, exDown: 0, n: 0 },
  };

  for (const [key, on] of Object.entries(pane.indicators)) {
    if (!on) continue;
    const cat = INDICATOR_CATEGORY[key];
    if (!cat || !cats[cat]) continue;
    const b = getIndicatorBias(key, pane);
    if (b.weight === 0) continue;
    cats[cat].score += b.dir * b.weight;
    cats[cat].w     += b.weight;
    cats[cat].n     += 1;
    if (cats[cat].exUp   != null && b.exhausted === 'up')   cats[cat].exUp++;
    if (cats[cat].exDown != null && b.exhausted === 'down') cats[cat].exDown++;
  }

  // Regime via ADX (always compute if any indicator is active, even if user hasn't enabled ADX,
  // since regime drives the weighting decision elsewhere)
  let adxValue = null, regime = 'unknown';
  const a = calcADX(c);
  if (a.adx.length) {
    adxValue = a.adx[a.adx.length-1].value;
    if (adxValue > 25) regime = 'trending';
    else if (adxValue < 20) regime = 'ranging';
    else regime = 'developing';
  }

  const out = [];

  const norm = (s) => s.w > 0 ? s.score / s.w : 0;
  const tonePct = (v) => Math.round(v * 100);

  // Trend verdict
  if (cats.trend.w > 0) {
    const v = norm(cats.trend);
    let verdict, tone;
    if      (v >  0.5)  { verdict = 'bullish';       tone = 'up';   }
    else if (v >  0.15) { verdict = 'weak bullish';  tone = 'up';   }
    else if (v > -0.15) { verdict = 'mixed';         tone = 'warn'; }
    else if (v > -0.5)  { verdict = 'weak bearish';  tone = 'down'; }
    else                { verdict = 'bearish';       tone = 'down'; }
    let tip = `Trend bias: ${tonePct(v)}% (from ${cats.trend.n} indicator${cats.trend.n>1?'s':''}).`;
    if (regime === 'trending') tip += ' ADX confirms trending market → high confidence in this read.';
    else if (regime === 'ranging') tip += ' ADX shows range market → trend reads less reliable; expect false signals.';
    out.push({ category: 'Trend', verdict, tone, tooltip: tip });
  }

  // Momentum verdict — exhaustion gets surfaced ONLY when regime isn't strongly trending
  if (cats.momentum.w > 0) {
    const v = norm(cats.momentum);
    let verdict, tone, exhaustionShown = false;
    if (cats.momentum.exUp > 0 && regime !== 'trending') {
      verdict = 'overbought'; tone = 'warn'; exhaustionShown = true;
    } else if (cats.momentum.exDown > 0 && regime !== 'trending') {
      verdict = 'oversold';   tone = 'warn'; exhaustionShown = true;
    } else if (v >  0.3) { verdict = 'bullish'; tone = 'up';   }
    else if (v < -0.3)   { verdict = 'bearish'; tone = 'down'; }
    else                 { verdict = 'flat';    tone = 'neutral'; }

    let tip = `Momentum bias: ${tonePct(v)}%.`;
    if (cats.momentum.exUp   > 0) tip += ` ${cats.momentum.exUp} oscillator(s) overbought.`;
    if (cats.momentum.exDown > 0) tip += ` ${cats.momentum.exDown} oscillator(s) oversold.`;
    if (regime === 'trending' && (cats.momentum.exUp > 0 || cats.momentum.exDown > 0)) {
      tip += ' Trending market — overbought/oversold rarely flip the trend; treat as confirmation, not reversal.';
    }
    if (regime === 'ranging' && exhaustionShown) {
      tip += ' Range market — extreme readings often mark turning points.';
    }
    out.push({ category: 'Momentum', verdict, tone, tooltip: tip });
  }

  // Volume verdict — compare net OBV/volume bias to recent price direction
  if (cats.volume.w > 0) {
    const v = norm(cats.volume);
    const recent = c[c.length - 1].close;
    const ref    = c[c.length - 6]?.close ?? recent;
    const priceDir = recent > ref ? 1 : recent < ref ? -1 : 0;
    let verdict, tone;
    if (Math.abs(v) < 0.2)                                { verdict = 'flat';        tone = 'neutral'; }
    else if ((v > 0 && priceDir > 0) || (v < 0 && priceDir < 0)) { verdict = 'confirming';   tone = v > 0 ? 'up' : 'down'; }
    else if ((v > 0 && priceDir < 0) || (v < 0 && priceDir > 0)) { verdict = 'diverging';    tone = 'warn'; }
    else                                                   { verdict = v > 0 ? 'accumulation' : 'distribution'; tone = v > 0 ? 'up' : 'down'; }
    let tip = `Volume bias: ${tonePct(v)}%.`;
    if (verdict === 'confirming') tip += ' Volume agrees with price direction — the move has conviction.';
    if (verdict === 'diverging')  tip += ' Volume disagrees with price — the move may be weak.';
    out.push({ category: 'Volume', verdict, tone, tooltip: tip });
  }

  // Regime chip — show whenever ADX produced a value (independent of whether ADX is checked)
  if (adxValue != null) {
    let verdict, tone;
    if (regime === 'trending')   { verdict = 'trending';   tone = 'up';   }
    else if (regime === 'ranging'){ verdict = 'ranging';    tone = 'warn'; }
    else                          { verdict = 'developing'; tone = 'neutral'; }
    out.push({
      category: 'Regime',
      verdict,
      tone,
      tooltip: `ADX = ${adxValue.toFixed(1)}. >25 trending (trust trend indicators). <20 ranging (trust oscillator reversals). In between = no clear regime, lower confidence in everything.`,
    });
  }

  // Divergence (only when RSI is active — that's the indicator we use for divergence detection)
  if (pane.indicators.rsi) {
    const div = detectDivergence(c);
    if (div) {
      out.push({
        category: 'Divergence',
        verdict: div.type,
        tone: div.type === 'bearish' ? 'down' : 'up',
        tooltip: div.type === 'bearish'
          ? `Bearish ${div.indicator} divergence — price made a higher high but ${div.indicator} made a lower high. The uptrend is losing steam.`
          : `Bullish ${div.indicator} divergence — price made a lower low but ${div.indicator} made a higher low. Selling pressure is fading.`,
      });
    }
  }

  return out;
}

// ── Hyperliquid WebSocket singleton ───────────────────────────────────────────

const HLSocket = (() => {
  let ws = null, reconnectDelay = 1_000, statusEl = null, pillEl = null, headerDot = null;
  const subs = new Map();

  function setStatus(cls) {
    if (statusEl) statusEl.className = `status-dot ${cls}`;
    if (headerDot) headerDot.className = `status-dot ${cls}`;
    if (pillEl) {
      pillEl.classList.toggle('live', cls === 'connected');
      pillEl.querySelector('.status-text').textContent =
        cls === 'connected' ? 'HL live' : cls === 'connecting' ? 'HL connecting' : 'HL offline';
    }
  }

  function send(o) { if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify(o)); }

  function connect() {
    setStatus('connecting');
    ws = new WebSocket(HL_WS_URL);
    ws.onopen = () => {
      setStatus('connected');
      reconnectDelay = 1_000;
      for (const coin of subs.keys())
        send({ method: 'subscribe', subscription: { type: 'trades', coin } });
    };
    ws.onmessage = ({ data }) => {
      let msg; try { msg = JSON.parse(data); } catch { return; }
      if (msg.channel === 'trades' && Array.isArray(msg.data) && msg.data.length) {
        const m = subs.get(msg.data[0]?.coin);
        if (m) m.forEach(cb => cb(msg.data));
      }
    };
    ws.onclose = () => { setStatus('disconnected'); setTimeout(connect, reconnectDelay); reconnectDelay = Math.min(reconnectDelay * 2, 30_000); };
    ws.onerror = () => ws.close();
  }

  return {
    init(dotEl, pill, hdrDot) { statusEl = dotEl; pillEl = pill; headerDot = hdrDot; connect(); },
    subscribe(coin, id, cb) {
      if (!subs.has(coin)) { subs.set(coin, new Map()); send({ method: 'subscribe', subscription: { type: 'trades', coin } }); }
      subs.get(coin).set(id, cb);
    },
    unsubscribe(coin, id) {
      const m = subs.get(coin);
      if (!m) return; m.delete(id);
      if (m.size === 0) { subs.delete(coin); send({ method: 'unsubscribe', subscription: { type: 'trades', coin } }); }
    },
  };
})();

// ── Data fetching ──────────────────────────────────────────────────────────────

async function fetchHLCandles(coin, interval) {
  const now = Date.now(), start = now - (HL_LOOKBACK[interval] ?? 7 * 86400_000);
  const res = await fetch(HL_REST_URL, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ type: 'candleSnapshot', req: { coin, interval, startTime: start, endTime: now } }),
  });
  const json = await res.json();
  if (!Array.isArray(json)) return [];
  return json.map(c => ({
    time: Math.floor(Number(c.t) / 1000), open: parseFloat(c.o),
    high: parseFloat(c.h), low: parseFloat(c.l), close: parseFloat(c.c), volume: parseFloat(c.v),
  })).filter(c => c.time > 0);
}

async function fetchStockCandles(symbol, interval) {
  const res = await fetch(`${FLASK_URL}/api/candles?symbol=${encodeURIComponent(symbol)}&interval=${interval}`);
  const json = await res.json();
  if (!json.ok) throw new Error(json.error ?? 'fetch failed');
  return json.data;
}

async function fetchStockPrice(symbol) {
  const res = await fetch(`${FLASK_URL}/api/price?symbol=${encodeURIComponent(symbol)}`);
  const json = await res.json();
  return json.ok ? json.price : null;
}

// Perpendicular distance from point (px, py) to segment (ax, ay)–(bx, by), in pixels.
function _distPointSegment(px, py, ax, ay, bx, by) {
  const dx = bx - ax, dy = by - ay;
  const len2 = dx * dx + dy * dy;
  if (len2 === 0) return Math.hypot(px - ax, py - ay);
  let t = ((px - ax) * dx + (py - ay) * dy) / len2;
  t = Math.max(0, Math.min(1, t));
  const cx = ax + t * dx, cy = ay + t * dy;
  return Math.hypot(px - cx, py - cy);
}

// ── Pane class ─────────────────────────────────────────────────────────────────

let _paneId = 0;

class Pane {
  constructor(el, source, rawSymbol, interval, savedIndicators = {}, savedDrawings = {}, savedCompare = null) {
    this.id        = _paneId++;
    this.el        = el;
    this.source    = source;                   // 'crypto' | 'us' | 'india'
    this.rawSymbol = rawSymbol;                // user-typed symbol (e.g. 'TCS', 'BTC', 'AAPL')
    this.interval  = interval;
    this.symbol    = resolveSymbol(source, rawSymbol);  // resolved for API

    this.chart = null; this.series = null;
    this.lastBar = null; this.lastPrice = null; this.openPrice = null;
    this.pollTimer = null; this.activeCoin = null; this.destroyed = false;
    this.candles = []; this.indicators = { ...savedIndicators }; this.indicatorLines = {};
    // Per-indicator recompute closures, populated during _renderIndicators. Each
    // refresher recomputes its indicator's calc and pushes new data into the
    // existing series via setData — no removeSeries/addLineSeries on live ticks.
    this._indicatorRefreshers = {};

    // Drawing tool state.
    // Backward-compat: old saves were `{ 'BTC': [{id, price}], … }` — flat horizontal lines per symbol.
    // New format: `{ hlines: { 'BTC': [...] }, shapes: { 'BTC': [...] } }`.
    const _isNewFmt = savedDrawings && (Object.prototype.hasOwnProperty.call(savedDrawings, 'hlines') ||
                                         Object.prototype.hasOwnProperty.call(savedDrawings, 'shapes'));
    this.drawnLinesBySymbol = _isNewFmt ? (savedDrawings.hlines ?? {}) : (savedDrawings ?? {});
    this.shapesBySymbol     = _isNewFmt ? (savedDrawings.shapes ?? {}) : {};
    this.drawnLines = [];                  // currently rendered hlines (native priceLines): [{id, price, lineObj}]
    this.activeTool = null;                // null | 'hline' | 'trend' | 'fib' | 'rect' | 'arrow'
    this.pendingShape = null;              // multi-click tools collect points here until finalized

    // Compare overlay state — null when no comparison is active. The saved
    // config is held aside until after load() so we can rebase against real candles.
    this.compare = null;                             // {source, rawSymbol, resolvedSymbol, series}
    this._savedCompareConfig = savedCompare;         // {source, rawSymbol} or null

    this._buildControls();
    this._createChart();

    // Mark this pane as active when the user clicks anywhere on it (used by watchlist click-to-load)
    this.el.addEventListener('mousedown', () => setActivePane(this));

    // Double-click anywhere on the pane (except the controls row) → toggle full-screen
    this.el.addEventListener('dblclick', e => {
      if (e.target.closest('.pane-controls')) return;
      this.el.classList.toggle('fullscreen');
    });

    if (this.symbol) this.load();
  }

  // ── DOM ──────────────────────────────────────────────────────────────────────

  _buildControls() {
    const ctrl = this.el.querySelector('.pane-controls');

    // Source selector
    this.sourceSel = ctrl.querySelector('.source-select');
    this.sourceSel.value = this.source;

    // Symbol input + datalist
    this.symbolInput   = ctrl.querySelector('.symbol-input');
    this.symbolDatalist = ctrl.querySelector('.symbol-datalist');
    const dlId = `dl-${this.id}`;
    this.symbolDatalist.id = dlId;
    this.symbolInput.setAttribute('list', dlId);
    this.symbolInput.value = this.rawSymbol;
    this._populateDatalist();

    // Interval
    this.intervalSel = ctrl.querySelector('.interval-select');
    TIMEFRAMES.forEach(tf => {
      const opt = new Option(tf, tf);
      opt.selected = (tf === this.interval);
      this.intervalSel.appendChild(opt);
    });

    // Ticker
    this.tickerBar       = ctrl.querySelector('.ticker-bar');
    this.tickerSym       = ctrl.querySelector('.ticker-symbol');
    this.tickerPrice     = ctrl.querySelector('.ticker-price');
    this.tickerAbsChange = ctrl.querySelector('.ticker-abs-change');
    this.tickerPctChange = ctrl.querySelector('.ticker-pct-change');
    this.tickerSym.textContent = this.rawSymbol;

    // Stats / News / Projections buttons all share the .stats-btn class for styling;
    // we identify the specific ones via their narrower marker class.
    this.statsBtn = ctrl.querySelector('.stats-btn:not(.news-btn):not(.proj-btn)');
    if (this.statsBtn) this.statsBtn.addEventListener('click', () => openStatsModal(this));
    this.newsBtn = ctrl.querySelector('.news-btn');
    if (this.newsBtn) this.newsBtn.addEventListener('click', () => openNewsModal(this));
    this.projBtn = ctrl.querySelector('.proj-btn');
    if (this.projBtn) this.projBtn.addEventListener('click', () => openProjectionsModal(this));

    // Compare overlay — VS button opens a small popup (source + symbol input).
    this.vsBtn    = ctrl.querySelector('.vs-btn');
    this.vsPopup  = ctrl.querySelector('.vs-popup');
    this.vsChip   = ctrl.querySelector('.vs-chip');
    this.vsSource = ctrl.querySelector('.vs-source');
    this.vsInput  = ctrl.querySelector('.vs-input');
    this.vsAdd    = ctrl.querySelector('.vs-add');
    if (this.vsBtn && this.vsPopup) {
      this.vsBtn.addEventListener('click', e => {
        e.stopPropagation();
        this.vsPopup.classList.toggle('open');
      });
      this.vsPopup.addEventListener('click', e => e.stopPropagation());
      document.addEventListener('click', () => this.vsPopup.classList.remove('open'));
      this.vsInput.addEventListener('keydown', e => {
        if (e.key === 'Enter') { e.preventDefault(); this.vsAdd.click(); }
      });
      this.vsAdd.addEventListener('click', () => {
        const source = this.vsSource.value;
        const sym    = this.vsInput.value;
        if (!sym.trim()) return;
        this._addComparison(source, sym);
        this.vsInput.value = '';
        this.vsPopup.classList.remove('open');
      });
      this.vsChip?.querySelector('.vs-chip-del')?.addEventListener('click', () => this._removeComparison());
    }

    // Drawing toolbar — pick a tool, then click the chart to anchor. Multi-click tools
    // (trend, fib, rect, arrow) collect two points; horizontal line is a single click.
    this.drawToolbar = ctrl.querySelector('.draw-toolbar');
    if (this.drawToolbar) {
      this.drawToolbar.querySelectorAll('.draw-tool[data-tool]').forEach(btn => {
        btn.addEventListener('click', () => {
          this._setActiveTool(this.activeTool === btn.dataset.tool ? null : btn.dataset.tool);
        });
      });

      // Magnet button — global toggle (mirrored to every pane's button via localStorage)
      this.magnetBtn = this.drawToolbar.querySelector('.draw-magnet');
      if (this.magnetBtn) {
        this.magnetBtn.classList.toggle('active', isMagnetOn());
        this.magnetBtn.addEventListener('click', () => {
          const next = !isMagnetOn();
          setMagnet(next);
          document.querySelectorAll('.draw-magnet').forEach(b => b.classList.toggle('active', next));
        });
      }
    }

    // Indicators
    this.indBtn  = ctrl.querySelector('.indicator-btn');
    this.indMenu = ctrl.querySelector('.indicator-menu');
    this.indBtn.addEventListener('click', e => { e.stopPropagation(); this.indMenu.classList.toggle('open'); });
    document.addEventListener('click', () => this.indMenu.classList.remove('open'));
    this.indMenu.addEventListener('click', e => e.stopPropagation());
    this.indMenu.querySelectorAll('input[data-ind]').forEach(cb => {
      // Restore checked state from saved indicators
      if (this.indicators[cb.dataset.ind]) cb.checked = true;
      cb.addEventListener('change', () => {
        this.indicators[cb.dataset.ind] = cb.checked;
        this._renderIndicators();
        this.indBtn.classList.toggle('has-active', Object.values(this.indicators).some(Boolean));
        savePaneConfigs();
      });
    });
    // Reflect any indicators that were already on from saved state
    if (Object.values(this.indicators).some(Boolean)) {
      this.indBtn.classList.add('has-active');
    }

    // Click swatches → open color picker, persist, sync all swatches, re-render
    this.indMenu.querySelectorAll('label').forEach(lbl => {
      const cb = lbl.querySelector('input[type="checkbox"]');
      const sw = lbl.querySelector('.swatch');
      if (!cb || !sw) return;
      const key = cb.dataset.ind;
      sw.dataset.indColor = key;
      sw.style.background = getIndColor(key);
      sw.title = 'Click to change color';
      sw.addEventListener('click', e => {
        e.preventDefault(); e.stopPropagation();
        openColorPicker(getIndColor(key), color => {
          setIndColor(key, color);
          document.querySelectorAll(`.swatch[data-ind-color="${key}"]`)
            .forEach(s => s.style.background = color);
          activePanes.forEach(p => p._renderIndicators());
        });
      });
    });

    // Wire period number-inputs next to SMA/EMA names.
    // - Initialize from localStorage override (falling back to default).
    // - Clicks inside the input shouldn't toggle the checkbox the label wraps.
    // - Changing the number re-renders every pane and syncs the input value across all panes.
    this.indMenu.querySelectorAll('.period-input').forEach(inp => {
      const key = inp.dataset.period;
      inp.value = String(getIndPeriod(key));
      inp.addEventListener('click', e => e.stopPropagation());
      inp.addEventListener('keydown', e => { if (e.key === 'Enter') inp.blur(); });
      inp.addEventListener('change', () => {
        const v = parseInt(inp.value, 10);
        if (!Number.isFinite(v) || v < 1 || v > 500) {
          inp.value = String(getIndPeriod(key));
          return;
        }
        setIndPeriod(key, v);
        document.querySelectorAll(`.period-input[data-period="${key}"]`)
          .forEach(i => { i.value = String(v); });
        activePanes.forEach(p => p._renderIndicators());
      });
    });

    // ── Events ───────────────────────────────────────────────────────────────

    // Source change → repopulate datalist, pick first symbol, reload
    this.sourceSel.addEventListener('change', () => {
      this.source = this.sourceSel.value;
      this._populateDatalist();
      const syms = SOURCE_SYMBOLS[this.source] ?? [];
      const first = syms[0] ?? '';
      this.symbolInput.value = first;
      this._applySymbol(first);
    });

    // Symbol input → load on Enter or on blur
    let debounce = null;
    this.symbolInput.addEventListener('keydown', e => {
      if (e.key === 'Enter') { e.preventDefault(); this._applySymbol(this.symbolInput.value); }
    });
    this.symbolInput.addEventListener('change', () => {
      this._applySymbol(this.symbolInput.value);
    });

    // Interval change
    this.intervalSel.addEventListener('change', () => {
      this.interval = this.intervalSel.value;
      this.lastBar = null; this.openPrice = null;
      this.load();
      savePaneConfigs();
    });
  }

  _populateDatalist() {
    this.symbolDatalist.innerHTML = '';
    const syms = SOURCE_SYMBOLS[this.source] ?? [];
    // Pick the right name map for this source. Crypto has no name map (ticker == coin name).
    const namesMap = this.source === 'us'    ? US_STOCKS_NAMES
                   : this.source === 'india' ? INDIAN_STOCKS_NAMES
                   : null;
    syms.forEach(s => {
      const opt = document.createElement('option');
      // For India, the ticker value should be the short form (no .NS suffix); resolveSymbol re-adds it on submit.
      const valueSym = this.source === 'india' ? s.replace('.NS', '') : s;
      opt.value = valueSym;
      // Display "TICKER — Company Name" so the dropdown is searchable on both;
      // datalists filter against textContent + value, and on select the input gets `value`.
      const name = namesMap?.[s];
      opt.textContent = name ? `${valueSym} — ${name}` : valueSym;
      this.symbolDatalist.appendChild(opt);
    });
  }

  _applySymbol(raw) {
    this._teardownLive();
    this._clearDrawnLines();           // drop previous symbol's hlines from the series
    this._setActiveTool(null);         // cancel any half-drawn shape
    this.rawSymbol = raw.trim().toUpperCase();
    this.symbol    = resolveSymbol(this.source, this.rawSymbol);
    this.lastPrice = null; this.lastBar = null; this.openPrice = null;
    this.tickerSym.textContent = this.rawSymbol;
    this.symbolInput.value = this.rawSymbol;
    this._drawOverlay();               // wipe old symbol's canvas shapes immediately
    if (this.symbol) this.load();      // load() calls _restoreDrawnLinesForSymbol + _drawOverlay
    savePaneConfigs();
  }

  // ── Chart ───────────────────────────────────────────────────────────────────

  _createChart() {
    const container = this.el.querySelector('.chart-container');
    this.chartContainer = container;
    const th = CHART_THEMES[getActiveTheme()];
    this.chart = LightweightCharts.createChart(container, {
      autoSize: true,
      layout:    th.layout,
      grid:      th.grid,
      crosshair: { mode: LightweightCharts.CrosshairMode.Normal, ...th.crosshair },
      rightPriceScale: { borderColor: th.scaleBorder, scaleMargins: { top: 0.1, bottom: 0.1 } },
      timeScale:       { borderColor: th.scaleBorder, timeVisible: true, secondsVisible: false },
    });
    this.series = this.chart.addCandlestickSeries({
      upColor: '#22c55e', downColor: '#ef4444',
      borderUpColor: '#22c55e', borderDownColor: '#ef4444',
      wickUpColor: '#22c55e', wickDownColor: '#ef4444',
    });

    // Canvas overlay for FVG + Volume Profile (DOM order: after chart so it sits on top)
    this.overlayCanvas = document.createElement('canvas');
    this.overlayCanvas.className = 'ind-canvas';
    container.appendChild(this.overlayCanvas);
    this.overlayCtx = this.overlayCanvas.getContext('2d');
    this._resizeOverlay();

    // Active-indicators legend (chips in the chart's top-left corner)
    this.legendEl = document.createElement('div');
    this.legendEl.className = 'active-indicators';
    container.appendChild(this.legendEl);

    // Repaint overlay on resize, scroll/zoom, and price-scale changes
    this._resizeObs = new ResizeObserver(() => { this._resizeOverlay(); this._drawOverlay(); });
    this._resizeObs.observe(container);
    this.chart.timeScale().subscribeVisibleTimeRangeChange(() => this._drawOverlay());
    this.chart.timeScale().subscribeVisibleLogicalRangeChange(() => this._drawOverlay());

    // Cross-pane crosshair sync — when this chart's crosshair moves, mirror the
    // time onto every other open pane (each shows its own price at that bar).
    this.chart.subscribeCrosshairMove(param => {
      if (this._syncMuted) return;
      syncCrosshairFromPane(this, param);
    });

    // Click dispatch for the drawing toolbar.
    // - hline:       single click → add a horizontal priceLine (native lightweight-charts series)
    // - trend/fib/rect/arrow: collect two clicks, then push a shape into shapesBySymbol
    // When Magnet Mode is on, the click price snaps to the nearest O/H/L/C of
    // whichever candle the cursor was over.
    this.chart.subscribeClick(p => {
      if (!this.activeTool || !p?.point) return;
      let price = this.series.coordinateToPrice(p.point.y);
      if (price == null) return;
      const time = p.time;

      if (isMagnetOn() && time != null) {
        const candle = this.candles.find(c => c.time === time);
        if (candle) price = snapToOHLC(candle, price).price;
      }

      if (this.activeTool === 'hline') { this._addDrawnLine(price); return; }
      if (time == null) return;

      // Vertical line is a single-click tool — locks to a time, ignores price.
      if (this.activeTool === 'vline') {
        this._addShape({ tool: 'vline', points: [{ time, price }] });
        this._setActiveTool(null);
        return;
      }

      if (!this.pendingShape) this.pendingShape = { tool: this.activeTool, points: [] };
      this.pendingShape.points.push({ time, price });
      if (this.pendingShape.points.length >= 2) {
        this._addShape(this.pendingShape);
        this.pendingShape = null;
        this._setActiveTool(null);    // TradingView-style: auto-exit tool after finalising a shape
      }
    });

    // Right-click in the chart area → delete the nearest drawing (hline OR canvas shape).
    container.addEventListener('contextmenu', e => {
      if (this.activeTool) return;
      const rect = container.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      const price = this.series.coordinateToPrice(y);
      if (price == null) return;

      // Hit-test horizontal lines first (closest by price within 1% of click price)
      let bestHLine = null, bestHLineDist = Infinity;
      for (const dl of this.drawnLines) {
        const d = Math.abs(dl.price - price);
        if (d < bestHLineDist) { bestHLineDist = d; bestHLine = dl; }
      }
      const hlineHit = bestHLine && Math.abs(price) > 0 && (bestHLineDist / Math.abs(price) <= 0.01);

      // Hit-test canvas shapes (8px screen-pixel threshold)
      const shapes = this.shapesBySymbol[this.rawSymbol] ?? [];
      let bestShape = null, bestShapeDist = Infinity;
      for (const s of shapes) {
        const d = this._hitDistShape(s, x, y);
        if (d != null && d < bestShapeDist) { bestShapeDist = d; bestShape = s; }
      }
      const shapeHit = bestShape && bestShapeDist <= 8;

      if (!hlineHit && !shapeHit) {
        // Nothing to delete here → treat as "reset chart view": fit all data on
        // the time axis and re-enable price autoscale. Cancels any pan/zoom.
        e.preventDefault();
        try {
          this.chart.timeScale().fitContent();
          this.chart.priceScale('right').applyOptions({ autoScale: true });
        } catch {}
        return;
      }
      e.preventDefault();
      // Prefer whichever is "closer" in normalized terms — for hline use the
      // pixel distance via priceToCoordinate; for shapes use bestShapeDist.
      const hlineY = bestHLine ? this.series.priceToCoordinate(bestHLine.price) : null;
      const hlinePixDist = hlineY != null ? Math.abs(hlineY - y) : Infinity;
      if (hlineHit && (!shapeHit || hlinePixDist <= bestShapeDist)) {
        this._removeDrawnLine(bestHLine.id);
      } else {
        this._removeShape(bestShape.id);
      }
    });
  }

  applyTheme(name) {
    if (!this.chart) return;
    const th = CHART_THEMES[name] ?? CHART_THEMES.dark;
    this.chart.applyOptions({
      layout:    th.layout,
      grid:      th.grid,
      crosshair: { mode: LightweightCharts.CrosshairMode.Normal, ...th.crosshair },
      rightPriceScale: { borderColor: th.scaleBorder },
      timeScale:       { borderColor: th.scaleBorder },
    });
    this._drawOverlay();
  }

  _resizeOverlay() {
    const rect = this.chartContainer.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    this.overlayCanvas.width  = Math.max(1, Math.floor(rect.width  * dpr));
    this.overlayCanvas.height = Math.max(1, Math.floor(rect.height * dpr));
    this.overlayCanvas.style.width  = rect.width  + 'px';
    this.overlayCanvas.style.height = rect.height + 'px';
    this.overlayCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  _drawOverlay() {
    if (!this.overlayCtx) return;
    const w = this.overlayCanvas.clientWidth, h = this.overlayCanvas.clientHeight;
    const ctx = this.overlayCtx;
    ctx.clearRect(0, 0, w, h);
    if (!this.candles.length) return;
    if (this.indicators.fvg) this._drawFVG(ctx, w);
    if (this.indicators.vp)  this._drawVP(ctx, w);
    this._drawShapes(ctx);
    this._drawSubPaneDivider(ctx, w, h);
    this._drawSubPaneScaleLabels(ctx, w, h);
  }

  // Visual separator between the candle area and the oscillator sub-pane(s).
  // Without this the right-side price-scale labels keep counting down into the
  // bottom 28% strip (e.g. showing 32.50/35/37.50 below an MACD pane), which
  // makes it look like candles could trade at those prices when really that
  // region is reserved for the oscillator. The divider + subtle tint groups the
  // sub-pane as visually distinct.
  _drawSubPaneDivider(ctx, w, h) {
    const SUB_KEYS = ['volume','rsi','macd','stoch','stochrsi','atr','adx','cci','obv','mfi','wr'];
    if (!SUB_KEYS.some(k => this.indicators[k])) return;
    // Top of the sub-pane region — matches the scaleMargins we use when adding
    // any oscillator series (top: 0.72 → 72% of chart height).
    const dividerY = Math.round(h * 0.72);
    // Subtle background tint for the bottom strip
    ctx.fillStyle = 'rgba(120, 120, 140, 0.05)';
    ctx.fillRect(0, dividerY, w, h - dividerY);
    // Dashed divider line
    ctx.save();
    ctx.strokeStyle = 'rgba(120, 120, 140, 0.55)';
    ctx.lineWidth = 1;
    ctx.setLineDash([5, 4]);
    ctx.beginPath();
    ctx.moveTo(0, dividerY + 0.5);
    ctx.lineTo(w, dividerY + 0.5);
    ctx.stroke();
    ctx.restore();
    // Small "oscillator" badge so the region's purpose is unambiguous
    const active = SUB_KEYS.filter(k => this.indicators[k]);
    const labelText = active.length === 1 ? active[0].toUpperCase() : `OSC × ${active.length}`;
    ctx.font = '600 9px "Segoe UI", system-ui, sans-serif';
    ctx.textBaseline = 'top';
    const padX = 5, padY = 2;
    const textW = ctx.measureText(labelText).width;
    ctx.fillStyle = 'rgba(120, 120, 140, 0.55)';
    ctx.fillRect(8, dividerY + 4, textW + padX * 2, 9 + padY * 2);
    ctx.fillStyle = '#fff';
    ctx.fillText(labelText, 8 + padX, dividerY + 4 + padY);
  }

  // Cover the candle-scale's misleading extrapolated labels in the bottom
  // sub-pane region, and draw the FIRST active oscillator's actual values
  // (using the series's own coordinateToPrice mapping so they line up exactly
  // with where lightweight-charts is drawing the lines).
  _drawSubPaneScaleLabels(ctx, w, h) {
    // Map indicator key → which series to use for the y-coordinate inversion.
    const SERIES_BY_IND = {
      volume:   'vol',
      rsi:      'rsi',
      macd:     'macd_l',
      stoch:    'stoch_k',
      stochrsi: 'stochrsi_k',
      atr:      'atr',
      adx:      'adx',
      cci:      'cci',
      obv:      'obv',
      mfi:      'mfi',
      wr:       'wr',
    };
    const PRIORITY = ['macd','rsi','stoch','stochrsi','cci','adx','mfi','wr','atr','obv','volume'];
    const activeInd = PRIORITY.find(k => this.indicators[k]);
    if (!activeInd) return;
    const series = this.indicatorLines[SERIES_BY_IND[activeInd]];
    if (!series || typeof series.coordinateToPrice !== 'function') return;

    const dividerY = Math.round(h * 0.72);
    // Right-side label column width. lightweight-charts priceScale().width()
    // isn't reliable in v4, so we pick a width generous enough to cover BTC-style
    // 6-digit prices like "130,000.00" with commas.
    let labelW = 90;
    try {
      const apiW = this.chart.priceScale('right').width?.();
      if (typeof apiW === 'number' && apiW > 0) labelW = Math.max(labelW, apiW + 8);
    } catch {}
    const xLabelLeft = w - labelW;

    // Reference-line price levels per indicator. We need to know these so we
    // can punch holes in the background cover for the native priceLine labels
    // (e.g. RSI's red "70" and green "30" boxes) — otherwise our opaque rect
    // hides them.
    const REF_LINES = {
      rsi:      [70, 50, 30],
      stoch:    [80, 50, 20],
      stochrsi: [80, 50, 20],
      mfi:      [80, 50, 20],
      wr:       [-20, -50, -80],
      cci:      [100, 0, -100],
      adx:      [25, 20],
      macd:     [0],
      atr:      [],
      obv:      [],
      volume:   [],
    };
    const refYs = (REF_LINES[activeInd] || [])
      .map(p => series.priceToCoordinate(p))
      .filter(y => y != null && isFinite(y))
      .sort((a, b) => a - b);

    // Cover the misleading candle labels with the theme's chart background, but
    // segment around the priceLine label positions so they remain visible.
    const bg = (getActiveTheme() === 'light') ? '#ffffff' : '#0c0c14';
    ctx.fillStyle = bg;
    const BOX_HALF = 8;  // half-height of a priceLine label box (≈16 px total)
    let segStart = dividerY - 1;
    const segEnd = h + 1;
    for (const refY of refYs) {
      const skipFrom = refY - BOX_HALF;
      const skipTo   = refY + BOX_HALF;
      if (skipFrom > segStart) {
        ctx.fillRect(xLabelLeft, segStart, labelW + 1, skipFrom - segStart);
      }
      segStart = Math.max(segStart, skipTo);
    }
    if (segStart < segEnd) {
      ctx.fillRect(xLabelLeft, segStart, labelW + 1, segEnd - segStart);
    }

    // Draw 5 labels evenly spaced down the sub-pane, right-aligned so they
    // line up cleanly with each other and with the native priceLine labels.
    const fg = (getActiveTheme() === 'light') ? '#4a4a5a' : '#9a9aa8';
    ctx.fillStyle = fg;
    ctx.font = '500 10px "Segoe UI", system-ui, sans-serif';
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'right';
    const xLabelRight = w - 6;

    const N = 5;
    for (let i = 0; i < N; i++) {
      const y = dividerY + Math.round((i / (N - 1)) * (h - dividerY - 4)) + 2;
      const value = series.coordinateToPrice(y);
      if (value == null || !isFinite(value)) continue;
      const formatted = _formatSubPaneLabel(value, activeInd);
      ctx.fillText(formatted, xLabelRight, y);
    }
  }

  _drawFVG(ctx, w) {
    const gaps = this._fvgs ?? (this._fvgs = calcFVGs(this.candles));
    const ts = this.chart.timeScale();
    for (const g of gaps) {
      const x1 = ts.timeToCoordinate(g.t0);
      const x2 = ts.timeToCoordinate(g.t1) ?? w;
      const y1 = this.series.priceToCoordinate(g.hi);
      const y2 = this.series.priceToCoordinate(g.lo);
      if (x1 == null || y1 == null || y2 == null) continue;
      const xL = Math.min(x1, x2), xR = Math.max(x1, x2);
      const yT = Math.min(y1, y2), yB = Math.max(y1, y2);
      ctx.fillStyle   = g.kind === 'bull' ? 'rgba(34,197,94,0.12)'  : 'rgba(239,68,68,0.12)';
      ctx.strokeStyle = g.kind === 'bull' ? 'rgba(34,197,94,0.45)'  : 'rgba(239,68,68,0.45)';
      ctx.lineWidth = 1;
      ctx.fillRect(xL, yT, Math.max(1, xR - xL), Math.max(1, yB - yT));
      ctx.strokeRect(xL + 0.5, yT + 0.5, Math.max(1, xR - xL) - 1, Math.max(1, yB - yT) - 1);
    }
  }

  _drawVP(ctx, w) {
    const vp = this._vp ?? (this._vp = calcVolumeProfile(this.candles));
    if (!vp) return;
    const maxBarPx = Math.min(120, w * 0.22);
    const xRight = w - 4;
    for (let i = 0; i < vp.bins; i++) {
      const v = vp.vol[i]; if (!v) continue;
      const pHi = vp.lo + (i + 1) * vp.step, pLo = vp.lo + i * vp.step;
      const yT = this.series.priceToCoordinate(pHi);
      const yB = this.series.priceToCoordinate(pLo);
      if (yT == null || yB == null) continue;
      const barLen = (v / vp.maxVol) * maxBarPx;
      const inVA = pLo >= vp.vaLo && pHi <= vp.vaHi;
      ctx.fillStyle = i === vp.poc ? 'rgba(234,179,8,0.85)'
                    : inVA         ? 'rgba(34,197,94,0.55)'
                                   : 'rgba(120,120,140,0.35)';
      const top = Math.min(yT, yB), height = Math.max(1, Math.abs(yB - yT) - 1);
      ctx.fillRect(xRight - barLen, top, barLen, height);
    }
  }

  // ── Compare overlay (second symbol rebased to main's anchor price) ─────────

  async _addComparison(source, rawSymbol) {
    rawSymbol = (rawSymbol ?? '').trim().toUpperCase();
    if (!rawSymbol) return;
    this._removeComparison();                          // drop any existing first

    const resolved = resolveSymbol(source, rawSymbol);
    let compCandles = [];
    try {
      compCandles = (source === 'crypto')
        ? await fetchHLCandles(resolved, this.interval)
        : await fetchStockCandles(resolved, this.interval);
    } catch (err) { console.warn('[compare] fetch failed:', err); return; }

    if (this.destroyed || !compCandles?.length || !this.candles.length) return;

    // Rebase: scale the compared series so its first close equals the main's first close.
    // After that, both diverge based on their relative % change from that anchor.
    const mainAnchor = this.candles[0].close;
    const compAnchor = compCandles[0].close;
    if (!compAnchor) return;
    const data = compCandles.map(c => ({
      time:  c.time,
      value: mainAnchor * (c.close / compAnchor),
    }));

    const series = this.chart.addLineSeries({
      color: '#06b6d4', lineWidth: 2,
      priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false,
      title: rawSymbol,
    });
    series.setData(data);

    this.compare = { source, rawSymbol, resolvedSymbol: resolved, series };
    if (this.vsChip) {
      this.vsChip.querySelector('.vs-chip-sym').textContent = rawSymbol;
      this.vsChip.hidden = false;
    }
    if (this.vsBtn) this.vsBtn.classList.add('has-active');
    savePaneConfigs();
  }

  _removeComparison() {
    if (this.compare?.series) {
      try { this.chart.removeSeries(this.compare.series); } catch {}
    }
    this.compare = null;
    if (this.vsChip) this.vsChip.hidden = true;
    if (this.vsBtn) this.vsBtn.classList.remove('has-active');
    savePaneConfigs();
  }

  // Re-fetch & re-draw comparison (called after main symbol or interval changed)
  async _redrawComparison() {
    if (!this.compare) return;
    const { source, rawSymbol } = this.compare;
    await this._addComparison(source, rawSymbol);
  }

  // ── Drawing tool: horizontal price lines (persisted per pane+symbol) ───────

  _addDrawnLine(price) {
    const id = 'dl_' + Math.random().toString(36).slice(2, 8);
    const lineObj = this.series.createPriceLine({
      price, color: '#5b7ff5', lineWidth: 1, lineStyle: 0,
      axisLabelVisible: true, title: fmtPrice(price),
    });
    this.drawnLines.push({ id, price, lineObj });
    this._syncDrawnToBucket();
    savePaneConfigs();
  }

  _removeDrawnLine(id) {
    const idx = this.drawnLines.findIndex(d => d.id === id);
    if (idx < 0) return;
    try { this.series.removePriceLine(this.drawnLines[idx].lineObj); } catch {}
    this.drawnLines.splice(idx, 1);
    this._syncDrawnToBucket();
    savePaneConfigs();
  }

  _clearDrawnLines() {
    for (const d of this.drawnLines) {
      try { this.series.removePriceLine(d.lineObj); } catch {}
    }
    this.drawnLines = [];
  }

  // Mirror this.drawnLines (sans lineObj refs) into the per-symbol bucket
  // so the localStorage payload stays serializable.
  _syncDrawnToBucket() {
    if (!this.rawSymbol) return;
    this.drawnLinesBySymbol[this.rawSymbol] =
      this.drawnLines.map(d => ({ id: d.id, price: d.price }));
  }

  // Restore lines for the currently loaded symbol (called after _applySymbol / load).
  _restoreDrawnLinesForSymbol() {
    this._clearDrawnLines();
    const saved = this.drawnLinesBySymbol[this.rawSymbol] ?? [];
    for (const dl of saved) {
      const lineObj = this.series.createPriceLine({
        price: dl.price, color: '#5b7ff5', lineWidth: 1, lineStyle: 0,
        axisLabelVisible: true, title: fmtPrice(dl.price),
      });
      this.drawnLines.push({ id: dl.id, price: dl.price, lineObj });
    }
  }

  // ── Canvas-overlay shapes: trend lines, Fibonacci, rectangles, arrows ──────

  _setActiveTool(tool) {
    this.activeTool = tool;
    this.pendingShape = null;
    if (this.drawToolbar) {
      this.drawToolbar.querySelectorAll('.draw-tool').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.tool === tool);
      });
    }
    this.el.classList.toggle('draw-active', !!tool);
  }

  _addShape(shape) {
    const id = 'sh_' + Math.random().toString(36).slice(2, 8);
    const full = { id, tool: shape.tool, points: shape.points, color: '#5b7ff5' };
    const sym = this.rawSymbol;
    if (!this.shapesBySymbol[sym]) this.shapesBySymbol[sym] = [];
    this.shapesBySymbol[sym].push(full);
    savePaneConfigs();
    this._drawOverlay();
  }

  _removeShape(id) {
    const sym = this.rawSymbol;
    const list = this.shapesBySymbol[sym];
    if (!list) return;
    const idx = list.findIndex(s => s.id === id);
    if (idx < 0) return;
    list.splice(idx, 1);
    savePaneConfigs();
    this._drawOverlay();
  }

  // Convert a shape's (time, price) anchors into screen pixels. Returns null if
  // any point can't be projected (e.g., time scrolled off-chart).
  _shapeToScreen(shape) {
    const ts = this.chart.timeScale();
    const pts = shape.points.map(p => ({
      x: ts.timeToCoordinate(p.time),
      y: this.series.priceToCoordinate(p.price),
    }));
    if (pts.some(p => p.x == null || p.y == null)) return null;
    return pts;
  }

  // Pixel distance from a click (x, y) to the nearest part of `shape`.
  // Returns null if shape is currently off-screen.
  _hitDistShape(shape, x, y) {
    // Vertical line is a 1-point shape — only the time matters; y is ignored.
    if (shape.tool === 'vline') {
      const sx = this.chart.timeScale().timeToCoordinate(shape.points[0].time);
      if (sx == null) return null;
      return Math.abs(x - sx);
    }
    const pts = this._shapeToScreen(shape);
    if (!pts) return null;
    const [a, b] = pts;
    if (shape.tool === 'trend' || shape.tool === 'arrow') {
      return _distPointSegment(x, y, a.x, a.y, b.x, b.y);
    }
    if (shape.tool === 'rect') {
      const xL = Math.min(a.x, b.x), xR = Math.max(a.x, b.x);
      const yT = Math.min(a.y, b.y), yB = Math.max(a.y, b.y);
      if (x >= xL && x <= xR && y >= yT && y <= yB) return 0;
      const dx = Math.max(xL - x, 0, x - xR);
      const dy = Math.max(yT - y, 0, y - yB);
      return Math.hypot(dx, dy);
    }
    if (shape.tool === 'fib') {
      // Fib draws horizontal lines spanning the time range between a and b at the
      // 7 retracement levels. Distance = nearest level line.
      const levels = [0, 0.236, 0.382, 0.5, 0.618, 0.786, 1];
      const xL = Math.min(a.x, b.x), xR = Math.max(a.x, b.x);
      if (x < xL || x > xR) return null;
      let best = Infinity;
      for (const lv of levels) {
        const ly = a.y + (b.y - a.y) * lv;
        const d = Math.abs(y - ly);
        if (d < best) best = d;
      }
      return best;
    }
    return null;
  }

  // Render all shapes for the current symbol on the overlay canvas.
  _drawShapes(ctx) {
    const shapes = this.shapesBySymbol[this.rawSymbol] ?? [];
    const canvasH = this.overlayCanvas?.clientHeight ?? 0;
    for (const s of shapes) {
      // Vertical line: full-height dashed line at the anchor time.
      if (s.tool === 'vline') {
        const sx = this.chart.timeScale().timeToCoordinate(s.points[0].time);
        if (sx == null) continue;
        ctx.save();
        ctx.strokeStyle = s.color;
        ctx.lineWidth = 1.5;
        ctx.setLineDash([5, 4]);
        ctx.beginPath();
        ctx.moveTo(sx, 0);
        ctx.lineTo(sx, canvasH);
        ctx.stroke();
        ctx.restore();
        continue;
      }
      const pts = this._shapeToScreen(s);
      if (!pts) continue;
      ctx.lineWidth = 1.5;
      ctx.strokeStyle = s.color;
      ctx.fillStyle   = s.color;
      const [a, b] = pts;
      if (s.tool === 'trend') {
        ctx.beginPath();
        ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y);
        ctx.stroke();
      } else if (s.tool === 'arrow') {
        ctx.beginPath();
        ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y);
        ctx.stroke();
        // Arrowhead at the end point b, pointing in direction of (b - a)
        const ang = Math.atan2(b.y - a.y, b.x - a.x);
        const headLen = 10;
        ctx.beginPath();
        ctx.moveTo(b.x, b.y);
        ctx.lineTo(b.x - headLen * Math.cos(ang - Math.PI / 7), b.y - headLen * Math.sin(ang - Math.PI / 7));
        ctx.lineTo(b.x - headLen * Math.cos(ang + Math.PI / 7), b.y - headLen * Math.sin(ang + Math.PI / 7));
        ctx.closePath();
        ctx.fill();
      } else if (s.tool === 'rect') {
        const xL = Math.min(a.x, b.x), xR = Math.max(a.x, b.x);
        const yT = Math.min(a.y, b.y), yB = Math.max(a.y, b.y);
        ctx.fillStyle = s.color + '22';   // ~13% alpha (hex appendix)
        ctx.fillRect(xL, yT, xR - xL, yB - yT);
        ctx.strokeRect(xL + 0.5, yT + 0.5, xR - xL - 1, yB - yT - 1);
      } else if (s.tool === 'fib') {
        const levels = [
          { v: 0,     label: '0%',    c: '#94a3b8' },
          { v: 0.236, label: '23.6%', c: '#22c55e' },
          { v: 0.382, label: '38.2%', c: '#22c55e' },
          { v: 0.5,   label: '50%',   c: '#f59e0b' },
          { v: 0.618, label: '61.8%', c: '#f59e0b' },
          { v: 0.786, label: '78.6%', c: '#ef4444' },
          { v: 1,     label: '100%',  c: '#ef4444' },
        ];
        const xL = Math.min(a.x, b.x), xR = Math.max(a.x, b.x);
        ctx.font = '10px "Segoe UI", system-ui, sans-serif';
        for (const lv of levels) {
          const ly = a.y + (b.y - a.y) * lv.v;
          const p1Price = s.points[0].price;
          const p2Price = s.points[1].price;
          const levelPrice = p1Price + (p2Price - p1Price) * lv.v;
          ctx.strokeStyle = lv.c;
          ctx.fillStyle   = lv.c;
          ctx.beginPath();
          ctx.moveTo(xL, ly); ctx.lineTo(xR, ly);
          ctx.stroke();
          ctx.fillText(`${lv.label}  ${fmtPrice(levelPrice)}`, xR + 4, ly + 3);
        }
        // Subtle anchor markers
        ctx.fillStyle = s.color;
        ctx.beginPath(); ctx.arc(a.x, a.y, 3, 0, Math.PI * 2); ctx.fill();
        ctx.beginPath(); ctx.arc(b.x, b.y, 3, 0, Math.PI * 2); ctx.fill();
      }
    }
  }

  // ── Indicators ──────────────────────────────────────────────────────────────

  _clearIndicators() {
    for (const k of Object.keys(this.indicatorLines)) {
      try { this.chart.removeSeries(this.indicatorLines[k]); } catch {}
    }
    this.indicatorLines = {};
    this._indicatorRefreshers = {};
    if (this._pivotLines) {
      for (const l of this._pivotLines) try { this.series.removePriceLine(l); } catch {}
      this._pivotLines = null;
    }
    if (this._markersSet) {
      try { this.series.setMarkers([]); } catch {}
      this._markersSet = false;
    }
  }

  _addLine(key, data, color, opts = {}) {
    const s = this.chart.addLineSeries({
      color,
      lineWidth: opts.lineWidth ?? 1,
      lineStyle: opts.lineStyle ?? 0,
      priceScaleId: opts.priceScaleId ?? '',
      priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false,
    });
    s.setData(data);
    this.indicatorLines[key] = s;
    if (opts.priceScaleId) {
      this.chart.priceScale(opts.priceScaleId).applyOptions({
        visible: false, scaleMargins: { top: 0.72, bottom: 0 },
      });
    }
    return s;
  }

  _addHist(key, data, color, opts = {}) {
    const s = this.chart.addHistogramSeries({
      color,
      priceScaleId: opts.priceScaleId ?? '',
      priceLineVisible: false, lastValueVisible: false,
      base: opts.base ?? 0,
    });
    s.setData(data);
    this.indicatorLines[key] = s;
    if (opts.priceScaleId) {
      this.chart.priceScale(opts.priceScaleId).applyOptions({
        visible: false, scaleMargins: { top: 0.72, bottom: 0 },
      });
    }
    return s;
  }

  _renderIndicators() {
    this._clearIndicators();
    if (!this.candles.length) { this._drawOverlay(); return; }
    const c = this.candles;
    const ind = this.indicators;

    // Make room at the bottom for sub-pane indicators when any are active
    const SUB_KEYS = ['volume','rsi','macd','stoch','stochrsi','atr','adx','cci','obv','mfi','wr'];
    const anySub = SUB_KEYS.some(k => ind[k]);
    this.chart.priceScale('right').applyOptions({
      scaleMargins: { top: 0.05, bottom: anySub ? 0.32 : 0.1 },
    });

    // ── Trend overlays ──
    if (ind.sma20) {
      this._addLine('sma20', calcSMA(c, getIndPeriod('sma20')), getIndColor('sma20'));
      this._indicatorRefreshers['sma20'] = () => {
        this.indicatorLines['sma20']?.setData(calcSMA(this.candles, getIndPeriod('sma20')));
      };
    }
    if (ind.sma50) {
      this._addLine('sma50', calcSMA(c, getIndPeriod('sma50')), getIndColor('sma50'));
      this._indicatorRefreshers['sma50'] = () => {
        this.indicatorLines['sma50']?.setData(calcSMA(this.candles, getIndPeriod('sma50')));
      };
    }
    if (ind.ema12) {
      this._addLine('ema12', calcEMA(c, getIndPeriod('ema12')), getIndColor('ema12'));
      this._indicatorRefreshers['ema12'] = () => {
        this.indicatorLines['ema12']?.setData(calcEMA(this.candles, getIndPeriod('ema12')));
      };
    }
    if (ind.ema26) {
      this._addLine('ema26', calcEMA(c, getIndPeriod('ema26')), getIndColor('ema26'));
      this._indicatorRefreshers['ema26'] = () => {
        this.indicatorLines['ema26']?.setData(calcEMA(this.candles, getIndPeriod('ema26')));
      };
    }
    if (ind.bb) {
      const bb = calcBB(c);
      const col = getIndColor('bb');
      this._addLine('bb_u', bb.upper, col, { lineStyle: 2 });
      this._addLine('bb_m', bb.mid,   col);
      this._addLine('bb_l', bb.lower, col, { lineStyle: 2 });
      this._indicatorRefreshers['bb'] = () => {
        const b = calcBB(this.candles);
        this.indicatorLines['bb_u']?.setData(b.upper);
        this.indicatorLines['bb_m']?.setData(b.mid);
        this.indicatorLines['bb_l']?.setData(b.lower);
      };
    }
    if (ind.vwap) {
      this._addLine('vwap', calcVWAP(c), getIndColor('vwap'), { lineWidth: 2 });
      this._indicatorRefreshers['vwap'] = () => {
        this.indicatorLines['vwap']?.setData(calcVWAP(this.candles));
      };
    }
    if (ind.supertrend) {
      const st = calcSupertrend(c);
      this._addLine('st_up',   st.up,   getIndColor('supertrend'), { lineWidth: 2 });
      this._addLine('st_down', st.down, '#ef4444',                 { lineWidth: 2 });
      this._indicatorRefreshers['supertrend'] = () => {
        const s = calcSupertrend(this.candles);
        this.indicatorLines['st_up']  ?.setData(s.up);
        this.indicatorLines['st_down']?.setData(s.down);
      };
    }
    if (ind.ichimoku) {
      const ik = calcIchimoku(c);
      this._addLine('ik_tk', ik.tenkan, getIndColor('ichimoku'));
      this._addLine('ik_kj', ik.kijun,  '#ec4899');
      this._addLine('ik_a',  ik.spanA,  '#22c55e', { lineStyle: 2 });
      this._addLine('ik_b',  ik.spanB,  '#ef4444', { lineStyle: 2 });
      this._indicatorRefreshers['ichimoku'] = () => {
        const i = calcIchimoku(this.candles);
        this.indicatorLines['ik_tk']?.setData(i.tenkan);
        this.indicatorLines['ik_kj']?.setData(i.kijun);
        this.indicatorLines['ik_a'] ?.setData(i.spanA);
        this.indicatorLines['ik_b'] ?.setData(i.spanB);
      };
    }
    if (ind.pivots) {
      const p = calcPivots(c);
      if (p) {
        const defs = [
          ['P',  p.P,  '#94a3b8'],
          ['R1', p.R1, '#22c55e'], ['R2', p.R2, '#16a34a'], ['R3', p.R3, '#15803d'],
          ['S1', p.S1, '#ef4444'], ['S2', p.S2, '#dc2626'], ['S3', p.S3, '#b91c1c'],
        ];
        this._pivotLines = defs.map(([title, price, color]) => this.series.createPriceLine({
          price, color, lineWidth: 1, lineStyle: 2, axisLabelVisible: true, title,
        }));
      }
    }

    // ── Strategy: XO Trend (EMA 12 / 25 crossover with Bull/Bear markers) ──
    if (ind.xo) {
      const xo = calcXOTrend(c);
      const upCol = getIndColor('xo');
      this._addLine('xo_fu', xo.fastUp,   upCol,     { lineWidth: 2 });
      this._addLine('xo_su', xo.slowUp,   upCol,     { lineWidth: 2 });
      this._addLine('xo_fd', xo.fastDown, '#ef4444', { lineWidth: 2 });
      this._addLine('xo_sd', xo.slowDown, '#ef4444', { lineWidth: 2 });
      if (xo.markers.length) {
        try { this.series.setMarkers(xo.markers); this._markersSet = true; } catch {}
      }
      this._indicatorRefreshers['xo'] = () => {
        const x = calcXOTrend(this.candles);
        this.indicatorLines['xo_fu']?.setData(x.fastUp);
        this.indicatorLines['xo_su']?.setData(x.slowUp);
        this.indicatorLines['xo_fd']?.setData(x.fastDown);
        this.indicatorLines['xo_sd']?.setData(x.slowDown);
        if (x.markers.length) {
          try { this.series.setMarkers(x.markers); this._markersSet = true; } catch {}
        }
      };
    }

    // ── Volume sub-pane ──
    if (ind.volume) {
      this._addHist('vol', calcVolumeBars(c), getIndColor('volume'), { priceScaleId: 'vol' });
      this._indicatorRefreshers['volume'] = () => {
        this.indicatorLines['vol']?.setData(calcVolumeBars(this.candles));
      };
    }

    // ── Oscillator sub-panes (each in its own hidden scale, drawn in bottom 28%) ──
    // Each oscillator gets reference price-lines for its canonical OB/OS levels so
    // you can see at a glance whether it's in overbought/oversold territory.
    const refLine = (s, price, color, dashed = true, title = '') => {
      try { s.createPriceLine({ price, color, lineWidth: 1, lineStyle: dashed ? 2 : 3, axisLabelVisible: !!title, title }); } catch {}
    };
    if (ind.rsi) {
      const s = this._addLine('rsi', calcRSI(c), getIndColor('rsi'), { priceScaleId: 'rsi', lineWidth: 2 });
      refLine(s, 70, 'rgba(239,68,68,0.55)', true,  '70');
      refLine(s, 50, 'rgba(120,120,140,0.4)', false);
      refLine(s, 30, 'rgba(34,197,94,0.55)',  true, '30');
      this._indicatorRefreshers['rsi'] = () => {
        this.indicatorLines['rsi']?.setData(calcRSI(this.candles));
      };
    }
    if (ind.macd) {
      const m = calcMACD(c);
      this._addHist('macd_h', m.hist, '#888',                { priceScaleId: 'macd' });
      const line = this._addLine('macd_l', m.line, getIndColor('macd'), { priceScaleId: 'macd', lineWidth: 2 });
      this._addLine('macd_s', m.sig, '#f59e0b', { priceScaleId: 'macd' });
      refLine(line, 0, 'rgba(120,120,140,0.4)', false);   // zero-line for the histogram/cross
      this._indicatorRefreshers['macd'] = () => {
        const mm = calcMACD(this.candles);
        this.indicatorLines['macd_h']?.setData(mm.hist);
        this.indicatorLines['macd_l']?.setData(mm.line);
        this.indicatorLines['macd_s']?.setData(mm.sig);
      };
    }
    if (ind.stoch) {
      const s = calcStoch(c);
      const k = this._addLine('stoch_k', s.k, getIndColor('stoch'), { priceScaleId: 'stoch', lineWidth: 2 });
      this._addLine('stoch_d', s.d, '#06b6d4', { priceScaleId: 'stoch' });
      refLine(k, 80, 'rgba(239,68,68,0.55)', true,  '80');
      refLine(k, 50, 'rgba(120,120,140,0.4)', false);
      refLine(k, 20, 'rgba(34,197,94,0.55)',  true, '20');
      this._indicatorRefreshers['stoch'] = () => {
        const ss = calcStoch(this.candles);
        this.indicatorLines['stoch_k']?.setData(ss.k);
        this.indicatorLines['stoch_d']?.setData(ss.d);
      };
    }
    if (ind.stochrsi) {
      const sr = calcStochRSI(c);
      const k = this._addLine('stochrsi_k', sr.k, getIndColor('stochrsi'), { priceScaleId: 'stochrsi', lineWidth: 2 });
      this._addLine('stochrsi_d', sr.d, '#f59e0b', { priceScaleId: 'stochrsi' });
      refLine(k, 80, 'rgba(239,68,68,0.55)', true,  '80');
      refLine(k, 50, 'rgba(120,120,140,0.4)', false);
      refLine(k, 20, 'rgba(34,197,94,0.55)',  true, '20');
      this._indicatorRefreshers['stochrsi'] = () => {
        const sr2 = calcStochRSI(this.candles);
        this.indicatorLines['stochrsi_k']?.setData(sr2.k);
        this.indicatorLines['stochrsi_d']?.setData(sr2.d);
      };
    }
    if (ind.atr) {
      this._addLine('atr',  calcATR(c),       getIndColor('atr'), { priceScaleId: 'atr', lineWidth: 2 });
      this._indicatorRefreshers['atr'] = () => {
        this.indicatorLines['atr']?.setData(calcATR(this.candles));
      };
    }
    if (ind.adx) {
      const a = calcADX(c);
      const adx = this._addLine('adx', a.adx, getIndColor('adx'), { priceScaleId: 'adx', lineWidth: 2 });
      this._addLine('adx_pdi', a.plusDI,  '#22c55e', { priceScaleId: 'adx' });
      this._addLine('adx_mdi', a.minusDI, '#f59e0b', { priceScaleId: 'adx' });
      refLine(adx, 25, 'rgba(120,120,140,0.4)', true, '25');   // trending threshold
      refLine(adx, 20, 'rgba(120,120,140,0.4)', true, '20');   // range threshold
      this._indicatorRefreshers['adx'] = () => {
        const aa = calcADX(this.candles);
        this.indicatorLines['adx']    ?.setData(aa.adx);
        this.indicatorLines['adx_pdi']?.setData(aa.plusDI);
        this.indicatorLines['adx_mdi']?.setData(aa.minusDI);
      };
    }
    if (ind.cci) {
      const s = this._addLine('cci', calcCCI(c), getIndColor('cci'), { priceScaleId: 'cci', lineWidth: 2 });
      refLine(s,  100, 'rgba(239,68,68,0.55)', true,  '100');
      refLine(s,    0, 'rgba(120,120,140,0.4)', false);
      refLine(s, -100, 'rgba(34,197,94,0.55)',  true, '-100');
      this._indicatorRefreshers['cci'] = () => {
        this.indicatorLines['cci']?.setData(calcCCI(this.candles));
      };
    }
    if (ind.obv) {
      this._addLine('obv',  calcOBV(c),       getIndColor('obv'), { priceScaleId: 'obv', lineWidth: 2 });
      this._indicatorRefreshers['obv'] = () => {
        this.indicatorLines['obv']?.setData(calcOBV(this.candles));
      };
    }
    if (ind.mfi) {
      const s = this._addLine('mfi', calcMFI(c), getIndColor('mfi'), { priceScaleId: 'mfi', lineWidth: 2 });
      refLine(s, 80, 'rgba(239,68,68,0.55)', true,  '80');
      refLine(s, 50, 'rgba(120,120,140,0.4)', false);
      refLine(s, 20, 'rgba(34,197,94,0.55)',  true, '20');
      this._indicatorRefreshers['mfi'] = () => {
        this.indicatorLines['mfi']?.setData(calcMFI(this.candles));
      };
    }
    if (ind.wr) {
      const s = this._addLine('wr', calcWilliamsR(c), getIndColor('wr'), { priceScaleId: 'wr', lineWidth: 2 });
      refLine(s, -20, 'rgba(239,68,68,0.55)', true,  '-20');
      refLine(s, -50, 'rgba(120,120,140,0.4)', false);
      refLine(s, -80, 'rgba(34,197,94,0.55)',  true, '-80');
      this._indicatorRefreshers['wr'] = () => {
        this.indicatorLines['wr']?.setData(calcWilliamsR(this.candles));
      };
    }

    // Refresh canvas overlay (FVG / Volume Profile)
    this._drawOverlay();
    this._updateLegend();
  }

  _updateLegend() {
    if (!this.legendEl) return;
    this.legendEl.innerHTML = '';

    // Top row: per-category Signal Summary chips (regime-filtered).
    // Only shows when at least one indicator is active.
    const anyActive = Object.values(this.indicators).some(Boolean);
    if (anyActive) {
      const summary = computeSignalSummary(this);
      if (summary.length) {
        const row = document.createElement('div');
        row.className = 'signal-summary-row';
        for (const item of summary) {
          const chip = document.createElement('span');
          chip.className = 'signal-chip';
          chip.title = item.tooltip;
          chip.innerHTML = `<span class="signal-chip-cat">${item.category}</span><span class="signal-chip-verdict tone-${item.tone}">${item.verdict}</span>`;
          row.appendChild(chip);
        }
        this.legendEl.appendChild(row);
      }
    }

    // Bottom: per-indicator chips with live value + verdict.
    for (const [key, on] of Object.entries(this.indicators)) {
      if (!on) continue;
      const meta = INDICATOR_META[key];
      if (!meta) continue;
      // Customizable-period indicators show their current period in the label
      // (e.g. "SMA 100" instead of the static "SMA 20" when overridden).
      const label = (['sma20','sma50','ema12','ema26'].includes(key))
        ? `${key.startsWith('sma') ? 'SMA' : 'EMA'} ${getIndPeriod(key)}`
        : meta.label;
      const r = interpretIndicator(key, this);
      const chip = document.createElement('span');
      chip.className = 'ind-chip';
      chip.title = r.tooltip || label;
      const valueHtml   = r.value   ? `<span class="ind-chip-val">${r.value}</span>` : '';
      const verdictHtml = r.verdict ? `<span class="ind-chip-verdict tone-${r.tone || 'neutral'}">${r.verdict}</span>` : '';
      chip.innerHTML = `<span class="ind-chip-dot" style="background:${getIndColor(key)}"></span>${label}${valueHtml}${verdictHtml}`;
      this.legendEl.appendChild(chip);
    }
  }

  // Throttle legend refreshes from live ticks to ~1Hz so we're not rebuilding DOM
  // dozens of times per second on a busy crypto feed.
  _scheduleLegendRefresh() {
    if (this._legendThrottle) return;
    this._legendThrottle = setTimeout(() => {
      this._legendThrottle = null;
      if (!this.destroyed) this._updateLegend();
    }, 1000);
  }

  // Sync this.candles with this.lastBar (which the tick handlers mutate). If the
  // last bar's time matches the most recent candle, overwrite it in place;
  // otherwise append a new bar (we just rolled into a new candle).
  _mergeLastBarIntoCandles() {
    if (!this.lastBar || !this.candles.length) return;
    const last = this.candles[this.candles.length - 1];
    if (this.lastBar.time === last.time) {
      this.candles[this.candles.length - 1] = { ...this.lastBar };
    } else if (this.lastBar.time > last.time) {
      this.candles.push({ ...this.lastBar });
    }
  }

  // Update every active indicator series in place via setData — no removeSeries /
  // addLineSeries, so the chart never blanks out, and the existing reference lines
  // (RSI 70/30, MACD zero, etc.) stay attached because their parent series isn't torn down.
  _updateIndicatorsInPlace() {
    if (this.destroyed) return;
    if (!this.candles.length) return;
    this._mergeLastBarIntoCandles();
    for (const fn of Object.values(this._indicatorRefreshers)) {
      try { fn(); } catch (err) { console.warn('[indicators] refresh failed:', err); }
    }
    this._drawOverlay();
    this._updateLegend();
  }

  // Throttle in-place indicator refreshes from live ticks to ~1Hz so we're not
  // pushing setData() dozens of times per second on a busy crypto feed.
  _scheduleIndicatorsRefresh() {
    if (this._indThrottle) return;
    this._indThrottle = setTimeout(() => {
      this._indThrottle = null;
      if (this.destroyed) return;
      // Only worth recomputing if any indicator is active
      if (!Object.values(this.indicators).some(Boolean)) return;
      this._updateIndicatorsInPlace();
    }, 1000);
  }

  // ── Data loading ────────────────────────────────────────────────────────────

  async load() {
    if (this.destroyed || !this.symbol) return;
    this._teardownLive();
    this.series.setData([]);
    this._clearIndicators();
    this.tickerPrice.textContent     = 'loading...';
    this.tickerAbsChange.textContent = '';
    this.tickerPctChange.textContent = '';
    this.tickerAbsChange.className   = 'ticker-abs-change';
    this.tickerPctChange.className   = 'ticker-pct-change';
    this.tickerBar.className         = 'ticker-bar';

    try {
      const candles = isCrypto(this.source)
        ? await fetchHLCandles(this.symbol, this.interval)
        : await fetchStockCandles(this.symbol, this.interval);

      if (this.destroyed) return;
      this.candles = candles;
      this._fvgs = null; this._vp = null;

      if (candles.length) {
        this.series.setData(candles);
        this.chart.timeScale().fitContent();
        this.openPrice = candles[0].open;
        this.lastBar   = { ...candles[candles.length - 1] };
        this.lastPrice = this.lastBar.close;
        this._updateTicker(this.lastPrice);
        this._renderIndicators();
        this._restoreDrawnLinesForSymbol();
        // Re-draw any existing comparison so it rebases against the new anchor.
        if (this.compare) {
          this._redrawComparison();
        } else if (this._savedCompareConfig) {
          // First load after construction — restore the saved comparison.
          const c = this._savedCompareConfig;
          this._savedCompareConfig = null;
          this._addComparison(c.source, c.rawSymbol);
        }
      } else {
        this.tickerPrice.textContent = 'no data';
      }
    } catch (err) {
      if (!this.destroyed) { console.warn('[Pane] load error', err); this.tickerPrice.textContent = 'error'; }
      return;
    }
    if (!this.destroyed) this._setupLive();
  }

  // ── Live data ───────────────────────────────────────────────────────────────

  _setupLive() {
    if (isCrypto(this.source)) {
      this.activeCoin = this.symbol;
      HLSocket.subscribe(this.symbol, this.id, t => this._onTrades(t));
    } else {
      this.pollTimer = setInterval(() => this._pollStock(), 5_000);
    }
  }

  _teardownLive() {
    if (this.pollTimer) { clearInterval(this.pollTimer); this.pollTimer = null; }
    if (this.activeCoin) { HLSocket.unsubscribe(this.activeCoin, this.id); this.activeCoin = null; }
  }

  _onTrades(trades) {
    if (this.destroyed || !trades.length) return;
    const last = trades[trades.length - 1];
    const price = parseFloat(last.px), tsSec = Math.floor(Number(last.time) / 1000);
    if (isNaN(price)) return;

    const intSec = INTERVAL_SECS[this.interval] ?? 60;
    const barTime = Math.floor(tsSec / intSec) * intSec;

    if (!this.lastBar || barTime > this.lastBar.time) {
      this.lastBar = { time: barTime, open: price, high: price, low: price, close: price };
    } else {
      this.lastBar.high = Math.max(this.lastBar.high, price);
      this.lastBar.low  = Math.min(this.lastBar.low, price);
      this.lastBar.close = price;
    }
    try { this.series.update({ ...this.lastBar }); } catch {}
    this._drawOverlay();
    this._flashTicker(price);
    this._updateTicker(price);
    this._scheduleIndicatorsRefresh();
    this._scheduleLegendRefresh();
    evaluateAlertsForPane(this);
  }

  async _pollStock() {
    if (this.destroyed) return;
    const price = await fetchStockPrice(this.symbol).catch(() => null);
    if (price == null || this.destroyed) return;
    if (this.lastBar) {
      this.lastBar.close = price;
      this.lastBar.high = Math.max(this.lastBar.high, price);
      this.lastBar.low  = Math.min(this.lastBar.low, price);
      try { this.series.update({ ...this.lastBar }); } catch {}
      this._drawOverlay();
    }
    this._flashTicker(price);
    this._updateTicker(price);
    this._scheduleIndicatorsRefresh();
    this._scheduleLegendRefresh();
    evaluateAlertsForPane(this);
  }

  // ── Ticker ──────────────────────────────────────────────────────────────────

  _updateTicker(current) {
    this.tickerPrice.textContent = fmtPrice(current);
    const ref = this.openPrice ?? this.lastPrice;
    if (ref != null && ref !== 0) {
      const diff = current - ref, pct = (diff / ref) * 100;
      const dir = diff >= 0 ? 'up' : 'down', sign = diff >= 0 ? '+' : '';
      this.tickerAbsChange.textContent = `${sign}${fmtPrice(Math.abs(diff))}`;
      this.tickerAbsChange.className   = `ticker-abs-change ${dir}`;
      this.tickerPctChange.textContent = `(${sign}${pct.toFixed(2)}%)`;
      this.tickerPctChange.className   = `ticker-pct-change ${dir}`;
      this.tickerBar.classList.remove('up', 'down');
      this.tickerBar.classList.add(dir);
    }
    this.lastPrice = current;
  }

  _flashTicker(newPrice) {
    if (this.lastPrice == null || newPrice === this.lastPrice) return;
    const cls = newPrice > this.lastPrice ? 'flash-up' : 'flash-down';
    this.tickerBar.classList.remove('flash-up', 'flash-down');
    void this.tickerBar.offsetWidth;
    this.tickerBar.classList.add(cls);
  }

  destroy() {
    this.destroyed = true;
    if (activePane === this) activePane = null;
    this._teardownLive();
    this._clearIndicators();
    if (this._resizeObs) { this._resizeObs.disconnect(); this._resizeObs = null; }
    if (this.overlayCanvas && this.overlayCanvas.parentNode) this.overlayCanvas.parentNode.removeChild(this.overlayCanvas);
    this.overlayCanvas = null; this.overlayCtx = null;
    if (this.chart) { this.chart.remove(); this.chart = null; }
  }
}

// ── Dashboard ──────────────────────────────────────────────────────────────────

const grid         = document.getElementById('grid');
const chartCountSel = document.getElementById('chartCountSelect');
const hlStatus     = document.getElementById('hlStatus');
const hlPill       = document.getElementById('hlPill');
const hlDotHeader  = document.getElementById('hlDotHeader');

let activePanes = [];

const DEFAULT_PANES = [
  { source: 'crypto', symbol: 'BTC',      interval: '1d' },
  { source: 'crypto', symbol: 'ETH',      interval: '1d' },
  { source: 'india',  symbol: 'RELIANCE', interval: '1d' },
  { source: 'crypto', symbol: 'SOL',      interval: '1d' },
  { source: 'india',  symbol: 'TCS',      interval: '1d' },
  { source: 'india',  symbol: 'INFY',     interval: '1d' },
  { source: 'us',     symbol: 'AAPL',     interval: '1d' },
  { source: 'us',     symbol: 'NVDA',     interval: '1d' },
];

// Mirror a crosshair move from one pane to every other open pane.
// Each receiving pane sets the crosshair at the same TIME but uses its own
// close price at that time (so the price label is meaningful per chart).
function syncCrosshairFromPane(sourcePane, param) {
  const time = param?.time;
  for (const p of activePanes) {
    if (p === sourcePane || !p.chart || !p.series) continue;
    p._syncMuted = true;
    try {
      if (time == null) {
        p.chart.clearCrosshairPosition();
      } else {
        // Find the close price on this pane at the same time (or the most recent bar before it)
        const cs = p.candles;
        let px = null;
        if (cs && cs.length) {
          for (let i = cs.length - 1; i >= 0; i--) {
            if (cs[i].time <= time) { px = cs[i].close; break; }
          }
          if (px == null) px = cs[0].close;
        }
        if (px != null) p.chart.setCrosshairPosition(px, time, p.series);
      }
    } catch {}
    p._syncMuted = false;
  }
}

function savePaneConfigs() {
  try {
    const cfg = activePanes.map(p => {
      // Only persist the keys that are true — keeps the saved blob tiny
      const indicators = {};
      for (const [k, v] of Object.entries(p.indicators ?? {})) if (v) indicators[k] = true;
      return {
        source:    p.source,
        symbol:    p.rawSymbol,
        interval:  p.interval,
        indicators,
        drawings:  {
          hlines: p.drawnLinesBySymbol ?? {},
          shapes: p.shapesBySymbol    ?? {},
        },
        compare:   p.compare ? { source: p.compare.source, rawSymbol: p.compare.rawSymbol } : null,
      };
    });
    localStorage.setItem(LS_PANES, JSON.stringify(cfg));
  } catch {}
}

function loadPaneConfigs() {
  try { return JSON.parse(localStorage.getItem(LS_PANES)) ?? []; }
  catch { return []; }
}

function setChartCount(count) {
  savePaneConfigs();
  const saved = loadPaneConfigs();

  activePanes.forEach(p => p.destroy());
  activePanes = [];
  grid.innerHTML = '';

  const { cols, rows } = LAYOUTS[count];
  grid.style.gridTemplateColumns = `repeat(${cols}, 1fr)`;
  grid.style.gridTemplateRows    = `repeat(${rows}, 1fr)`;

  const tmpl = document.getElementById('pane-template');
  for (let i = 0; i < count; i++) {
    const cfg        = saved[i] ?? DEFAULT_PANES[i] ?? DEFAULT_PANES[0];
    const source     = cfg.source     ?? 'crypto';
    const symbol     = cfg.symbol     ?? 'BTC';
    const interval   = cfg.interval   ?? '1d';
    const indicators = cfg.indicators ?? {};
    const drawings   = cfg.drawings   ?? {};
    const compare    = cfg.compare    ?? null;

    grid.appendChild(tmpl.content.cloneNode(true));
    activePanes.push(new Pane(grid.children[i], source, symbol, interval, indicators, drawings, compare));
  }

  // Default the active pane to the first one so watchlist clicks work without a prior pane click
  if (activePanes.length) setActivePane(activePanes[0]);

  chartCountSel.value = String(count);
  localStorage.setItem(LS_COUNT, String(count));
}

// ── Alerts ─────────────────────────────────────────────────────────────────────
//
// Detection now runs SERVER-SIDE in alerts_worker.py. The browser only manages
// the alert list (CRUD via /api/alerts) and renders the modal. The server polls
// every ~30s, evaluates each condition, and fires Telegram directly — so alerts
// fire even when this tab is closed.
//
// What the browser still does:
//  - Show the alerts modal + form
//  - POST new alerts to the server
//  - DELETE alerts from the server
//  - Periodically re-fetch the list (every 30s) so firedAt/error state stays fresh

const ALERT_COOLDOWN_MS    = 5 * 60 * 1000;
const ALERTS_REFRESH_MS    = 30_000;

const ALERT_TYPES = {
  price_above:        { needsValue: true,  needsPeriod: false, valueLabel: 'Price threshold' },
  price_below:        { needsValue: true,  needsPeriod: false, valueLabel: 'Price threshold' },
  pct_move:           { needsValue: true,  needsPeriod: true,  valueLabel: '% threshold (e.g. 3)' },
  rsi_above:          { needsValue: true,  needsPeriod: false, valueLabel: 'RSI level (e.g. 70)' },
  rsi_below:          { needsValue: true,  needsPeriod: false, valueLabel: 'RSI level (e.g. 30)' },
  macd_bull:          { needsValue: false, needsPeriod: false },
  macd_bear:          { needsValue: false, needsPeriod: false },
  price_above_sma50:  { needsValue: false, needsPeriod: false },
  price_below_sma50:  { needsValue: false, needsPeriod: false },
};

let _alerts = [];               // server-side list, mirrored locally for rendering
let _telegramConfigured = false;
let _alertsRefreshTimer = null;

async function loadAlerts() {
  try {
    const r = await fetch('/api/alerts');
    const j = await r.json();
    _alerts = (j.ok && Array.isArray(j.items)) ? j.items : [];
  } catch {
    _alerts = [];
  }
}

// Kick off a refresh loop so firedAt/lastError fields surface in the UI without
// the user opening and closing the modal each time.
function startAlertsRefreshLoop() {
  if (_alertsRefreshTimer) clearInterval(_alertsRefreshTimer);
  _alertsRefreshTimer = setInterval(async () => {
    await loadAlerts();
    updateAlertsBadge();
    // Only re-render the list if the modal is open — otherwise no point.
    const m = document.getElementById('alertsModal');
    if (m && !m.hidden) renderAlertsList();
  }, ALERTS_REFRESH_MS);
}

function resolveAlertSymbol(source, raw) {
  const s = (raw ?? '').trim().toUpperCase();
  if (!s) return '';
  if (source === 'crypto') return s;
  if (source === 'india')  return s.endsWith('.NS') ? s : s + '.NS';
  return s;
}

function alertConditionLabel(a) {
  switch (a.type) {
    case 'price_above':       return `Price > ${a.value}`;
    case 'price_below':       return `Price < ${a.value}`;
    case 'pct_move':          return `|Δ%| ≥ ${a.value}% over ${a.period} bars`;
    case 'rsi_above':         return `RSI(14) crosses above ${a.value}`;
    case 'rsi_below':         return `RSI(14) crosses below ${a.value}`;
    case 'macd_bull':         return 'MACD bullish cross';
    case 'macd_bear':         return 'MACD bearish cross';
    case 'price_above_sma50': return 'Price crosses above SMA 50';
    case 'price_below_sma50': return 'Price crosses below SMA 50';
    case 'strategy': {
      const p = a.params || {}, s = (a.strategy || '').toUpperCase();
      const detail = s === 'RSI'  ? `${p.period || 14} · ${p.lower || 30}/${p.upper || 70}`
                   : s === 'MACD' ? `${p.fast || 12}/${p.slow || 26}/${p.signal || 9}`
                   :                `${p.fast ?? ''}/${p.slow ?? ''}`;
      return `🎯 ${s} strategy signal (${detail})`;
    }
    default:                  return a.type;
  }
}

function updateAlertsBadge() {
  const armed = _alerts.filter(a => a.enabled && !a.firedAt).length;
  const btn = document.getElementById('alertsBtn');
  const cnt = document.getElementById('alertsCount');
  if (!btn || !cnt) return;
  cnt.textContent = String(armed);
  cnt.classList.toggle('zero', armed === 0);
  btn.classList.toggle('has-active', armed > 0);
}

function renderAlertsList() {
  const list = document.getElementById('alertsList');
  if (!list) return;
  list.innerHTML = '';
  if (_alerts.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'alerts-empty';
    empty.textContent = 'No alerts yet. Add one above.';
    list.appendChild(empty);
    return;
  }
  for (const a of _alerts) {
    const row = document.createElement('div');
    row.className = 'alert-row' + (a.firedAt && !a.repeating ? ' fired' : '');
    const status =
      a.lastError ? `<span class="al-status error" title="${a.lastError}">error</span>`
      : (a.firedAt && !a.repeating) ? '<span class="al-status fired">fired</span>'
      : '<span class="al-status armed">armed</span>';
    row.innerHTML = `
      ${status}
      <span class="al-sym">${a.rawSymbol}</span>
      <span class="al-cond">${alertConditionLabel(a)}</span>
      <span class="al-meta">${a.repeating ? 'repeating' : 'one-shot'} · ${a.source}</span>
      <button class="al-del" data-id="${a.id}" type="button" aria-label="Delete">×</button>
    `;
    list.appendChild(row);
  }
  list.querySelectorAll('.al-del').forEach(btn => {
    btn.addEventListener('click', async () => {
      const id = btn.dataset.id;
      btn.disabled = true;
      try {
        await fetch('/api/alerts/' + encodeURIComponent(id), { method: 'DELETE' });
      } catch {}
      _alerts = _alerts.filter(x => x.id !== id);
      renderAlertsList();
      updateAlertsBadge();
    });
  });
}

async function checkTelegramStatus() {
  const el = document.getElementById('telegramStatus');
  try {
    const r = await fetch('/api/notify/status').then(x => x.json());
    _telegramConfigured = !!r.configured;
    if (el) {
      el.textContent = _telegramConfigured ? 'Telegram: configured' : 'Telegram: NOT configured (.env)';
      el.className   = 'telegram-status ' + (_telegramConfigured ? 'ok' : 'bad');
    }
  } catch {
    if (el) { el.textContent = 'Telegram: server unreachable'; el.className = 'telegram-status bad'; }
  }
}

async function notifyTelegram(text) {
  try {
    const r = await fetch('/api/notify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text }),
    });
    const j = await r.json();
    return j.ok ? { ok: true } : { ok: false, error: j.info ?? 'send failed' };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

async function sendTestNotification() {
  const btn = document.getElementById('alertsTestBtn');
  if (btn) { btn.disabled = true; btn.textContent = 'Sending…'; }
  const res = await notifyTelegram(
    `📈 <b>Trading Dashboard</b>\nTest notification at ${new Date().toLocaleTimeString()}.`,
  );
  if (btn) {
    btn.disabled = false;
    btn.textContent = res.ok ? 'Sent ✓' : 'Failed';
    setTimeout(() => { btn.textContent = 'Test message'; }, 2500);
  }
  if (!res.ok) console.warn('[notify] test failed:', res.error);
}

// ── Detection ────────────────────────────────────────────────────────────────

function _crossed(prev, cur, level, direction) {
  if (prev == null || cur == null) return false;
  if (direction === 'above') return prev <= level && cur >  level;
  if (direction === 'below') return prev >= level && cur <  level;
  return false;
}

// Evaluate one alert against a pane's current candles. Returns true if the
// alert just fired (i.e., transitioned from inactive to active on this tick).
function evalAlert(a, pane) {
  const c = pane.candles;
  if (!c || c.length < 2) return false;
  const last = c[c.length - 1], prev = c[c.length - 2];
  const curPx  = last.close, prevPx = prev.close;

  switch (a.type) {
    case 'price_above': return _crossed(prevPx, curPx, +a.value, 'above');
    case 'price_below': return _crossed(prevPx, curPx, +a.value, 'below');
    case 'pct_move': {
      const n = Math.max(1, Math.floor(+a.period || 5));
      if (c.length <= n) return false;
      const ref = c[c.length - 1 - n].close;
      if (!ref) return false;
      const pct = Math.abs((curPx - ref) / ref) * 100;
      // Edge-trigger: only fire when we just crossed the threshold
      const prevRef = c[c.length - 2 - n]?.close ?? ref;
      const prevPct = Math.abs((prevPx - prevRef) / prevRef) * 100;
      return prevPct < +a.value && pct >= +a.value;
    }
    case 'rsi_above':
    case 'rsi_below': {
      const r = calcRSI(c, 14);
      if (r.length < 2) return false;
      const dir = a.type === 'rsi_above' ? 'above' : 'below';
      return _crossed(r[r.length - 2].value, r[r.length - 1].value, +a.value, dir);
    }
    case 'macd_bull':
    case 'macd_bear': {
      const m = calcMACD(c);
      if (m.line.length < 2 || m.sig.length < 2) return false;
      const lPrev = m.line[m.line.length - 2].value, lCur = m.line[m.line.length - 1].value;
      const sPrev = m.sig [m.sig .length - 2].value, sCur = m.sig [m.sig .length - 1].value;
      if (a.type === 'macd_bull') return lPrev <= sPrev && lCur > sCur;
      else                        return lPrev >= sPrev && lCur < sCur;
    }
    case 'price_above_sma50':
    case 'price_below_sma50': {
      const sma = calcSMA(c, 50);
      if (sma.length < 2 || c.length < 2) return false;
      const smaCur  = sma[sma.length - 1].value;
      const smaPrev = sma[sma.length - 2].value;
      const dir = a.type === 'price_above_sma50' ? 'above' : 'below';
      // "price crosses above SMA": prev price ≤ prev sma AND cur price > cur sma
      if (dir === 'above') return prevPx <= smaPrev && curPx > smaCur;
      else                 return prevPx >= smaPrev && curPx < smaCur;
    }
  }
  return false;
}

// Server-side worker handles alert detection now (alerts_worker.py). This stub
// keeps existing call sites in Pane._onTrades / _pollStock working as a no-op
// rather than throwing — and the Pane tick path stays unchanged. Safe to delete
// the call sites later; left in for blast-radius minimalism on this migration.
function evaluateAlertsForPane(_pane) {
  /* no-op: server-side worker fires alerts via Telegram on its own schedule */
}

// Kept for any debugger / console use; the browser no longer runs detection.
function _legacyEvaluateAlertsForPane(pane) {
  if (!_alerts.length) return;
  for (const a of _alerts) {
    if (!a.enabled) continue;
    if (a.source !== pane.source) continue;
    if (a.resolvedSymbol !== pane.symbol) continue;

    const now = Date.now();
    if (a.firedAt) {
      if (!a.repeating) continue;
      if (now - a.firedAt < (a.cooldownMs ?? ALERT_COOLDOWN_MS)) continue;
    }

    let triggered = false;
    try { triggered = evalAlert(a, pane); }
    catch (err) { a.lastError = String(err.message ?? err); continue; }

    if (!triggered) continue;

    a.firedAt = now;
    a.lastError = null;
    const msg = `🔔 <b>${a.rawSymbol}</b> (${a.source})\n${alertConditionLabel(a)}\nPrice: <b>${fmtPrice(pane.candles.at(-1).close)}</b>`;
    renderAlertsList(); updateAlertsBadge();
    notifyTelegram(msg).then(res => {
      if (!res.ok) {
        a.lastError = res.error;
        renderAlertsList();
      }
    });
  }
}

// ── Modal wiring ─────────────────────────────────────────────────────────────

async function openAlertsModal() {
  const m = document.getElementById('alertsModal');
  if (!m) return;
  m.hidden = false;
  // Pull the latest server-side state so freshly-fired alerts surface immediately
  await loadAlerts();
  renderAlertsList();
  updateAlertsBadge();
  checkTelegramStatus();
}
function closeAlertsModal() {
  const m = document.getElementById('alertsModal');
  if (m) m.hidden = true;
}

function wireAlertsForm() {
  const typeSel    = document.getElementById('alfType');
  const valueField = document.getElementById('alfValueField');
  const valueLabel = document.getElementById('alfValueLabel');
  const periodField= document.getElementById('alfPeriodField');

  function syncForm() {
    const meta = ALERT_TYPES[typeSel.value];
    valueField.hidden  = !meta?.needsValue;
    periodField.hidden = !meta?.needsPeriod;
    if (meta?.valueLabel) valueLabel.textContent = meta.valueLabel;
  }
  typeSel.addEventListener('change', syncForm);
  syncForm();

  document.getElementById('alertsAddBtn').addEventListener('click', async () => {
    const source = document.getElementById('alfSource').value;
    const raw    = document.getElementById('alfSymbol').value;
    const type   = typeSel.value;
    const value  = parseFloat(document.getElementById('alfValue').value);
    const period = parseInt (document.getElementById('alfPeriod').value, 10);
    const rep    = document.getElementById('alfRepeating').checked;
    if (!raw.trim()) return alert('Symbol required');
    const meta = ALERT_TYPES[type];
    if (meta?.needsValue  && !Number.isFinite(value))  return alert('Value required');
    if (meta?.needsPeriod && !Number.isFinite(period)) return alert('Period required');
    const body = {
      source,
      rawSymbol:       raw.trim().toUpperCase(),
      resolvedSymbol:  resolveAlertSymbol(source, raw),
      type,
      value:           meta?.needsValue  ? value  : null,
      period:          meta?.needsPeriod ? period : null,
      repeating:       rep,
      cooldownMs:      ALERT_COOLDOWN_MS,
    };
    const btn = document.getElementById('alertsAddBtn');
    btn.disabled = true; btn.textContent = 'Adding…';
    try {
      const r = await fetch('/api/alerts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const j = await r.json();
      if (j.ok && j.item) _alerts.push(j.item);
      else                alert('Failed to add alert: ' + (j.error || 'unknown error'));
    } catch (err) {
      alert('Failed to add alert: ' + err.message);
    } finally {
      btn.disabled = false; btn.textContent = '+ Add alert';
    }
    renderAlertsList();
    updateAlertsBadge();
    document.getElementById('alfSymbol').value = '';
    document.getElementById('alfValue').value  = '';
  });
}

// ── Watchlist ──────────────────────────────────────────────────────────────────
//
// A horizontal strip of clickable tiles at the bottom of the screen. Each tile
// shows symbol, current price, and today's % change. Click → load into the
// active pane. Right-click → remove. Polls every 30s.

const LS_WATCHLIST    = 'td_watchlist';
const WATCH_REFRESH_MS = 30_000;

let _watchlist = [];               // [{source, rawSymbol}]
let _watchTiles = {};              // key=`${source}:${rawSymbol}` → WatchTile
let _watchTimer = null;
let activePane = null;             // last-clicked pane (target for watchlist clicks)

function setActivePane(pane) {
  if (activePane === pane) return;
  if (activePane?.el) activePane.el.classList.remove('is-active');
  activePane = pane;
  if (pane?.el) pane.el.classList.add('is-active');
}

function loadWatchlist() {
  try { _watchlist = JSON.parse(localStorage.getItem(LS_WATCHLIST) ?? '[]') ?? []; }
  catch { _watchlist = []; }
}
function saveWatchlist() {
  try { localStorage.setItem(LS_WATCHLIST, JSON.stringify(_watchlist)); } catch {}
}
function watchKey(source, raw) { return `${source}:${raw}`; }

class WatchTile {
  constructor(source, rawSymbol) {
    this.source    = source;
    this.rawSymbol = rawSymbol;
    this.resolved  = resolveSymbol(source, rawSymbol);

    this.el = document.createElement('div');
    this.el.className = 'watch-tile loading';
    this.el.title = `Click to load · right-click to remove`;
    this.el.innerHTML = `
      <div><span class="watch-sym">${rawSymbol}</span><span class="watch-source">${source}</span></div>
      <div><span class="watch-price">--</span> <span class="watch-pct"></span></div>
    `;
    this.priceEl = this.el.querySelector('.watch-price');
    this.pctEl   = this.el.querySelector('.watch-pct');

    this.el.addEventListener('click', () => loadWatchSymbolIntoActivePane(source, rawSymbol));
    this.el.addEventListener('contextmenu', e => {
      e.preventDefault();
      removeFromWatchlist(source, rawSymbol);
    });
  }

  async refresh() {
    try {
      const candles = (this.source === 'crypto')
        ? await fetchHLCandles(this.resolved, '1d')
        : await fetchStockCandles(this.resolved, '1d');
      if (!candles?.length) { this._setError(); return; }
      const last = candles[candles.length - 1];
      this._update(last.close, last.open);
    } catch {
      this._setError();
    }
  }
  _update(price, refOpen) {
    this.el.classList.remove('loading', 'error');
    const diff = price - refOpen;
    const pct  = refOpen ? (diff / refOpen) * 100 : 0;
    const dir  = diff >= 0 ? 'up' : 'down';
    this.el.classList.remove('up', 'down');
    this.el.classList.add(dir);
    this.priceEl.textContent = fmtPrice(price);
    this.pctEl.textContent   = `${diff >= 0 ? '+' : ''}${pct.toFixed(2)}%`;
    this.pctEl.className     = `watch-pct ${dir}`;
  }
  _setError() {
    this.el.classList.remove('loading', 'up', 'down');
    this.el.classList.add('error');
    this.pctEl.textContent = 'err';
  }
}

function renderWatchlist() {
  const cont = document.getElementById('watchTiles');
  if (!cont) return;
  cont.innerHTML = '';
  _watchTiles = {};
  for (const item of _watchlist) {
    const t = new WatchTile(item.source, item.rawSymbol);
    _watchTiles[watchKey(item.source, item.rawSymbol)] = t;
    cont.appendChild(t.el);
    t.refresh();
  }
}

function addToWatchlist(source, raw) {
  raw = (raw ?? '').trim().toUpperCase();
  if (!raw) return;
  if (_watchlist.some(x => x.source === source && x.rawSymbol === raw)) return;
  _watchlist.push({ source, rawSymbol: raw });
  saveWatchlist();
  renderWatchlist();
}

function removeFromWatchlist(source, raw) {
  _watchlist = _watchlist.filter(x => !(x.source === source && x.rawSymbol === raw));
  saveWatchlist();
  renderWatchlist();
}

function refreshAllWatchlistTiles() {
  for (const t of Object.values(_watchTiles)) t.refresh();
}

function startWatchlistPolling() {
  if (_watchTimer) clearInterval(_watchTimer);
  _watchTimer = setInterval(refreshAllWatchlistTiles, WATCH_REFRESH_MS);
}

function loadWatchSymbolIntoActivePane(source, raw) {
  const target = activePane ?? activePanes[0];
  if (!target) return;
  if (target.source !== source) {
    target.source = source;
    if (target.sourceSel) target.sourceSel.value = source;
    target._populateDatalist();
  }
  target._applySymbol(raw);
}

function wireWatchlistControls() {
  document.getElementById('watchAddBtn')?.addEventListener('click', () => {
    const src = document.getElementById('watchAddSource').value;
    const sym = document.getElementById('watchAddSymbol').value;
    if (sym.trim()) {
      addToWatchlist(src, sym);
      document.getElementById('watchAddSymbol').value = '';
    }
  });
  document.getElementById('watchAddSymbol')?.addEventListener('keydown', e => {
    if (e.key === 'Enter') document.getElementById('watchAddBtn').click();
  });
  document.getElementById('watchToggle')?.addEventListener('click', () => {
    document.getElementById('watchlist').classList.toggle('collapsed');
  });
}

// ── Stats panel (per-pane performance: day / week / month / YTD / year / all-time) ──
//
// Reads daily candles (~5y window) regardless of the chart's current interval, so
// every period is computable. "Current" uses the pane's live last price when
// available so the day-change figure stays fresh against the tick stream.

function computeStats(dailies, currentPrice) {
  if (!dailies?.length) return null;
  const last = dailies[dailies.length - 1];
  const now = last.time;
  const cur = currentPrice ?? last.close;

  const periodStatsFrom = (startTime, prevPriceForChange) => {
    const inRange = dailies.filter(c => c.time >= startTime);
    if (!inRange.length) return null;
    const high = Math.max(...inRange.map(c => c.high));
    const low  = Math.min(...inRange.map(c => c.low));
    const ref  = prevPriceForChange ?? inRange[0].open;
    return {
      high, low, ref, close: cur,
      changePct: ref ? ((cur - ref) / ref) * 100 : 0,
      rangePct:  low ? ((high - low) / low) * 100 : 0,
    };
  };

  // Day: today's bar's H/L vs the previous bar's close (so a flat open shows the same change as a stock app would)
  const prevBar = dailies.length >= 2 ? dailies[dailies.length - 2] : null;
  const dayHigh = Math.max(last.high, cur);
  const dayLow  = Math.min(last.low,  cur);
  const dayRef  = prevBar ? prevBar.close : last.open;
  const day = {
    high: dayHigh, low: dayLow, ref: dayRef, close: cur,
    changePct: dayRef ? ((cur - dayRef) / dayRef) * 100 : 0,
    rangePct:  dayLow ? ((dayHigh - dayLow) / dayLow) * 100 : 0,
  };

  const SEC = { week: 7 * 86400, month: 30 * 86400, year: 365 * 86400 };
  const week  = periodStatsFrom(now - SEC.week);
  const month = periodStatsFrom(now - SEC.month);
  const year  = periodStatsFrom(now - SEC.year);

  // YTD: from Jan 1 of the current year in the chart's local time
  const nowDate = new Date(now * 1000);
  const ytdStart = Math.floor(new Date(nowDate.getFullYear(), 0, 1).getTime() / 1000);
  const ytd = periodStatsFrom(ytdStart);

  const allHigh = Math.max(...dailies.map(c => c.high));
  const allLow  = Math.min(...dailies.map(c => c.low));
  const allTime = {
    high: allHigh, low: allLow,
    fromHighPct: allHigh ? ((cur - allHigh) / allHigh) * 100 : 0,
    fromLowPct:  allLow  ? ((cur - allLow)  / allLow ) * 100 : 0,
  };

  return { current: cur, day, week, month, ytd, year, allTime, bars: dailies.length };
}

function renderStats(s, pane) {
  if (!s) return '<div class="alerts-empty">No data available.</div>';
  const fmtPct = n => `${n >= 0 ? '+' : ''}${n.toFixed(2)}%`;
  const dirClass = n => (n >= 0 ? 'up' : 'down');

  const row = (label, p) => p ? `
    <tr>
      <td>${label}</td>
      <td>${fmtPrice(p.high)}</td>
      <td>${fmtPrice(p.low)}</td>
      <td class="${dirClass(p.changePct)}">${fmtPct(p.changePct)}</td>
      <td>${p.rangePct.toFixed(2)}%</td>
    </tr>
  ` : `<tr><td>${label}</td><td colspan="4" style="color:var(--text-faint)">insufficient data</td></tr>`;

  // 52-week range position: 0% = at year low, 100% = at year high
  let rangePos = null;
  if (s.year && s.year.high > s.year.low) {
    rangePos = Math.max(0, Math.min(100, ((s.current - s.year.low) / (s.year.high - s.year.low)) * 100));
  }

  return `
    <div class="stats-summary">
      <div class="stats-current">
        <span class="stats-current-label">${pane.rawSymbol} · ${pane.source}</span>
        <span class="stats-current-value">${fmtPrice(s.current)}</span>
        <span class="stats-day-change ${dirClass(s.day.changePct)}">${fmtPct(s.day.changePct)} today</span>
      </div>
      ${rangePos != null ? `
        <div class="stats-range">
          <div class="stats-range-track">
            <div class="stats-range-marker" style="left: ${rangePos.toFixed(1)}%" title="${rangePos.toFixed(1)}% of 52-week range"></div>
          </div>
          <div class="stats-range-labels">
            <span>52w Low · ${fmtPrice(s.year.low)}</span>
            <span class="center">${rangePos.toFixed(0)}% of range</span>
            <span>52w High · ${fmtPrice(s.year.high)}</span>
          </div>
        </div>
      ` : ''}
    </div>

    <table class="stats-table">
      <thead>
        <tr><th>Period</th><th>High</th><th>Low</th><th>Change</th><th>Range</th></tr>
      </thead>
      <tbody>
        ${row('Day',   s.day)}
        ${row('Week',  s.week)}
        ${row('Month', s.month)}
        ${row('YTD',   s.ytd)}
        ${row('Year',  s.year)}
      </tbody>
    </table>

    <div class="stats-extremes">
      <div class="stats-extreme">
        <span class="stats-extreme-label">All-time High (loaded window)</span>
        <span class="stats-extreme-value">${fmtPrice(s.allTime.high)}</span>
        <span class="stats-extreme-from down">${fmtPct(s.allTime.fromHighPct)} from current</span>
      </div>
      <div class="stats-extreme">
        <span class="stats-extreme-label">All-time Low (loaded window)</span>
        <span class="stats-extreme-value">${fmtPrice(s.allTime.low)}</span>
        <span class="stats-extreme-from up">${fmtPct(s.allTime.fromLowPct)} from current</span>
      </div>
    </div>

    <div class="alert-form-help">
      Window: ${s.bars} daily candles (~${Math.round(s.bars / 252)}y for stocks, ~${Math.round(s.bars / 365)}y for 24/7 markets).
      "Day" change is vs the previous bar's close. YTD = since Jan 1 of the current year.
    </div>
  `;
}

// ── Projections (forward-looking analysis with explicit assumptions) ─────────
//
// None of these are predictions. Each one states the assumption it makes
// (current slope continues, current volatility regime holds, etc.) so the reader
// can decide whether to trust that assumption today.

// Simple ordinary least-squares regression on the last `lookback` closes,
// extended forward `forward` bars. Returns the fitted line, ±1σ standard-error
// band (widening with horizon), and the projected % return at the end.
function computeLinearTrend(candles, lookback = 50, forward = 20) {
  const window = candles.slice(-lookback);
  const n = window.length;
  if (n < 5) return null;
  const xs = window.map((_, i) => i);
  const ys = window.map(c => c.close);
  const sumX  = xs.reduce((s, v) => s + v, 0);
  const sumY  = ys.reduce((s, v) => s + v, 0);
  const sumXY = xs.reduce((s, x, i) => s + x * ys[i], 0);
  const sumXX = xs.reduce((s, v) => s + v * v, 0);
  const denom = n * sumXX - sumX * sumX;
  if (denom === 0) return null;
  const slope = (n * sumXY - sumX * sumY) / denom;
  const intercept = (sumY - slope * sumX) / n;
  let sse = 0;
  for (let i = 0; i < n; i++) {
    const pred = intercept + slope * i;
    sse += (ys[i] - pred) ** 2;
  }
  const sigma = Math.sqrt(sse / Math.max(1, n - 2));
  const lastIdx = n - 1;
  const lastClose = ys[n - 1];
  const projAt = intercept + slope * (lastIdx + forward);
  const expectedReturnPct = lastClose ? ((projAt - lastClose) / lastClose) * 100 : 0;
  return { slope, intercept, sigma, lookback: n, forward, expectedReturnPct, direction: slope >= 0 ? 'up' : 'down' };
}

// 80% / 95% probability ranges over N bars using ATR scaled by √N (random-walk
// assumption — fine for short horizons in normal markets, breaks on volatility
// regime changes which is exactly when you most want to know).
function computeATRRange(candles, period, currentPrice) {
  const a = calcATR(candles, period);
  if (!a.length) return null;
  const atr = a[a.length - 1].value;
  const horizons = [1, 5, 10, 20];
  const Z80 = 1.282, Z95 = 1.96;
  const ranges = horizons.map(bars => ({
    bars,
    low80:  Math.max(0, currentPrice - Z80 * atr * Math.sqrt(bars)),
    high80: currentPrice + Z80 * atr * Math.sqrt(bars),
    low95:  Math.max(0, currentPrice - Z95 * atr * Math.sqrt(bars)),
    high95: currentPrice + Z95 * atr * Math.sqrt(bars),
  }));
  return { atr, currentPrice, ranges };
}

// Detect swing highs/lows (N-bar neighborhood) in the last 100 bars. Classify
// each as above-current = resistance, below-current = support. Return the 3
// nearest of each, sorted by distance.
function computeSwingLevels(candles, currentPrice, N = 5) {
  const window = candles.slice(-100);
  if (window.length < 2 * N + 1) return { resistance: [], support: [] };
  const highs = [], lows = [];
  for (let i = N; i < window.length - N; i++) {
    let isH = true, isL = true;
    for (let j = i - N; j <= i + N; j++) {
      if (j === i) continue;
      if (window[j].high >= window[i].high) isH = false;
      if (window[j].low  <= window[i].low ) isL = false;
    }
    if (isH) highs.push({ price: window[i].high, time: window[i].time });
    if (isL) lows .push({ price: window[i].low,  time: window[i].time });
  }
  // Resistance = swing highs above current; Support = swing lows below current.
  const r = highs.filter(h => h.price > currentPrice)
                 .map(h => ({ price: h.price, time: h.time, distancePct: ((h.price - currentPrice) / currentPrice) * 100 }))
                 .sort((a, b) => a.price - b.price)
                 .slice(0, 3);
  const s = lows .filter(l => l.price < currentPrice)
                 .map(l => ({ price: l.price, time: l.time, distancePct: ((l.price - currentPrice) / currentPrice) * 100 }))
                 .sort((a, b) => b.price - a.price)
                 .slice(0, 3);
  return { resistance: r, support: s };
}

// Per-indicator "if current slope continues" ETAs.
// Returns sorted list (soonest first) of {label, eta (bars), note}.
function computeIndicatorETAs(candles) {
  const out = [];

  // Helper — recent slope as (latest - 3 bars ago) / 3
  const slopeOf = (arr) => {
    if (!arr || arr.length < 4) return null;
    return (arr[arr.length - 1].value - arr[arr.length - 4].value) / 3;
  };

  // MACD line vs signal cross
  const m = calcMACD(candles);
  if (m.line.length >= 4 && m.sig.length >= 4) {
    const line = m.line[m.line.length - 1].value;
    const sig  = m.sig [m.sig .length - 1].value;
    const ls = slopeOf(m.line), ss = slopeOf(m.sig);
    if (ls != null && ss != null) {
      const closeRate = ss - ls;             // positive when signal is catching up to line from below
      const gap = line - sig;
      // They converge only when sign(gap) and sign(closeRate) are opposite (or gap small)
      if (Math.abs(closeRate) > 1e-9 && Math.sign(gap) !== Math.sign(closeRate)) {
        const bars = Math.abs(gap / closeRate);
        if (bars > 0 && bars < 100) {
          out.push({ label: `MACD ${gap > 0 ? 'bearish' : 'bullish'} cross`, eta: bars, note: 'at current slopes' });
        }
      }
    }
  }

  // Price vs SMA convergence
  const smaPeriod = getIndPeriod('sma50');
  const sma = calcSMA(candles, smaPeriod);
  if (sma.length >= 4 && candles.length >= 4) {
    const lastClose = candles[candles.length - 1].close;
    const smaVal    = sma[sma.length - 1].value;
    const smaSlope  = (sma[sma.length - 1].value - sma[sma.length - 4].value) / 3;
    const priceSlope = (candles[candles.length - 1].close - candles[candles.length - 4].close) / 3;
    const gap = lastClose - smaVal;
    const closeRate = smaSlope - priceSlope;
    if (Math.abs(closeRate) > 1e-9 && Math.sign(gap) !== Math.sign(closeRate)) {
      const bars = Math.abs(gap / closeRate);
      if (bars > 0 && bars < 100) {
        out.push({
          label: gap > 0 ? `Price drops to SMA ${smaPeriod}` : `Price rises to SMA ${smaPeriod}`,
          eta: bars,
          note: 'if both slopes hold',
        });
      }
    }
  }

  // RSI → 70 / 50 / 30
  const rsi = calcRSI(candles);
  if (rsi.length >= 4) {
    const cur   = rsi[rsi.length - 1].value;
    const slope = slopeOf(rsi);
    if (slope != null && Math.abs(slope) > 1e-9) {
      for (const target of [70, 50, 30]) {
        const gap = target - cur;
        if (Math.abs(gap) < 1) continue;
        if (Math.sign(gap) !== Math.sign(slope)) continue;
        const bars = Math.abs(gap / slope);
        if (bars > 0 && bars < 100) {
          out.push({ label: `RSI reaches ${target}`, eta: bars, note: `from current ${cur.toFixed(1)}` });
        }
      }
    }
  }

  out.sort((a, b) => a.eta - b.eta);
  return out.slice(0, 6);
}

function computeProjections(pane) {
  const c = pane.candles;
  if (!c || c.length < 30) return null;
  const currentPrice = pane.lastPrice ?? c[c.length - 1].close;
  return {
    linearTrend:       computeLinearTrend(c, 50, 20),
    atrRange:          computeATRRange(c, 14, currentPrice),
    supportResistance: computeSwingLevels(c, currentPrice),
    indicatorETAs:     computeIndicatorETAs(c),
    currentPrice,
    interval:          pane.interval,
    bars:              c.length,
  };
}

function renderProjections(p) {
  if (!p) return '<div class="alerts-empty">Need at least 30 candles to compute projections. Try a longer timeframe or wait for more data.</div>';
  const fmtPct = n => `${n >= 0 ? '+' : ''}${n.toFixed(2)}%`;
  const dirClass = n => n >= 0 ? 'up' : 'down';

  let html = '';

  // ── Linear trend ──
  if (p.linearTrend) {
    const lt = p.linearTrend;
    html += `
      <div class="proj-section">
        <h3>Linear trend extrapolation</h3>
        <div class="proj-summary">
          Fitting a straight line through the last <strong>${lt.lookback}</strong> bars.
          If that slope continues for the next <strong>${lt.forward}</strong> bars,
          price would change by <strong class="${dirClass(lt.expectedReturnPct)}">${fmtPct(lt.expectedReturnPct)}</strong>
          from the current <strong>${fmtPrice(p.currentPrice)}</strong>.
        </div>
        <div class="proj-note">
          Assumption: the slope holds. The ±1σ standard-error band grows with horizon — wider band means
          more dispersion of past prices around the line (so less confidence in the projection). Trend
          extrapolation is the weakest of these methods; markets reverse, not extend, more often than people expect.
        </div>
      </div>
    `;
  }

  // ── ATR range ──
  if (p.atrRange) {
    const r = p.atrRange;
    html += `
      <div class="proj-section">
        <h3>Volatility-based probability ranges</h3>
        <div class="proj-summary">
          Current ATR (14): <strong>${fmtPrice(r.atr)}</strong> per ${p.interval} bar.
        </div>
        <table class="proj-table">
          <thead>
            <tr><th>Horizon</th><th>80% range</th><th>95% range</th></tr>
          </thead>
          <tbody>
            ${r.ranges.map(rng => `
              <tr>
                <td><strong>${rng.bars} ${rng.bars === 1 ? 'bar' : 'bars'}</strong></td>
                <td>${fmtPrice(rng.low80)} – ${fmtPrice(rng.high80)}</td>
                <td>${fmtPrice(rng.low95)} – ${fmtPrice(rng.high95)}</td>
              </tr>
            `).join('')}
          </tbody>
        </table>
        <div class="proj-note">
          Assumption: volatility regime stays similar (ranges scale by √bars). "80% range" means: in normal
          conditions, expect price within this band 4 out of 5 times. Black swans (gaps, earnings, news)
          regularly push outside the 95% range — this is descriptive of normal markets, not bulletproof.
        </div>
      </div>
    `;
  }

  // ── Support / Resistance ──
  if (p.supportResistance) {
    const sr = p.supportResistance;
    const hasAny = sr.resistance.length || sr.support.length;
    html += `
      <div class="proj-section">
        <h3>Nearest support &amp; resistance</h3>
        ${hasAny ? `
          <div class="proj-sr-grid">
            <div>
              <h4>Resistance (above)</h4>
              ${sr.resistance.length ? `
                <ul class="proj-sr-list">
                  ${sr.resistance.map(l => `
                    <li><strong>${fmtPrice(l.price)}</strong><span class="proj-dist down">${fmtPct(l.distancePct)}</span></li>
                  `).join('')}
                </ul>
              ` : '<div class="proj-sr-empty">No clear levels above in recent history.</div>'}
            </div>
            <div>
              <h4>Support (below)</h4>
              ${sr.support.length ? `
                <ul class="proj-sr-list">
                  ${sr.support.map(l => `
                    <li><strong>${fmtPrice(l.price)}</strong><span class="proj-dist up">${fmtPct(l.distancePct)}</span></li>
                  `).join('')}
                </ul>
              ` : '<div class="proj-sr-empty">No clear levels below in recent history.</div>'}
            </div>
          </div>
        ` : '<div class="alerts-empty">No clear swing levels detected in the last 100 bars.</div>'}
        <div class="proj-note">
          Levels are swing highs / lows where price reversed in the last 100 bars (5-bar neighborhood).
          Past reaction points often attract price again — but they don't have to, and they don't have to hold.
          Use as zones to watch, not exact prices.
        </div>
      </div>
    `;
  }

  // ── Indicator convergence ETAs ──
  if (p.indicatorETAs) {
    html += `
      <div class="proj-section">
        <h3>Indicator convergence ETAs</h3>
        ${p.indicatorETAs.length ? `
          <ul class="proj-eta-list">
            ${p.indicatorETAs.map(e => `
              <li>
                <strong>${e.label}</strong> in <strong>~${e.eta.toFixed(1)} bars</strong>
                <span class="proj-note-inline">(${e.note})</span>
              </li>
            `).join('')}
          </ul>
        ` : '<div class="alerts-empty">No clear indicator convergences expected in the next 100 bars at current slopes.</div>'}
        <div class="proj-note">
          Assumes each indicator's recent slope continues unchanged. Useful for rough "when" timing —
          but real markets accelerate, slow, or reverse before crosses, so these are upper-bound estimates.
        </div>
      </div>
    `;
  }

  // Footer disclaimer
  html += `
    <div class="alert-form-help">
      <strong>None of the above are predictions.</strong> Each section states its assumption explicitly.
      Treat the panel as a structured frame for analyzing the current setup — not as buy/sell signals.
      Data window: ${p.bars} ${p.interval} candles.
    </div>
  `;
  return html;
}

async function openProjectionsModal(pane) {
  const m = document.getElementById('projectionsModal');
  if (!m || !pane) return;
  m.hidden = false;
  document.getElementById('projectionsTitle').textContent = `Projections — ${pane.rawSymbol}`;
  const out = document.getElementById('projectionsContent');
  if (!pane.candles?.length) {
    out.innerHTML = '<div class="alerts-empty">No candles loaded for this symbol yet.</div>';
    return;
  }
  out.innerHTML = renderProjections(computeProjections(pane));
}

function closeProjectionsModal() {
  const m = document.getElementById('projectionsModal');
  if (m) m.hidden = true;
}

// ── News (per-pane recent headlines) ─────────────────────────────────────────

function _fmtRelTime(unixSec) {
  if (!unixSec) return '';
  const diff = Math.floor(Date.now() / 1000) - unixSec;
  if (diff < 60)         return 'just now';
  if (diff < 3600)       return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400)      return `${Math.floor(diff / 3600)}h ago`;
  if (diff < 86400 * 7)  return `${Math.floor(diff / 86400)}d ago`;
  return new Date(unixSec * 1000).toLocaleDateString();
}

function _escapeHtml(s) {
  const d = document.createElement('div');
  d.textContent = s ?? '';
  return d.innerHTML;
}

function renderNewsItems(items, agg) {
  if (!items?.length) return '<div class="alerts-empty">No news found for this symbol.</div>';
  const now = Math.floor(Date.now() / 1000);
  const todayCutoff = now - 86400;
  const todayItems = items.filter(n => n.time >= todayCutoff);
  const olderItems = items.filter(n => n.time <  todayCutoff);

  const sentColor = l => l === 'bullish' ? '#22c55e' : l === 'bearish' ? '#ef4444' : '#8a8a9a';
  const sentIcon  = l => l === 'bullish' ? '▲' : l === 'bearish' ? '▼' : '•';

  const renderOne = n => `
    <a class="news-item" href="${_escapeHtml(n.link)}" target="_blank" rel="noopener noreferrer">
      <div class="news-meta">
        <span class="news-pub">${_escapeHtml(n.publisher)}</span>
        <span class="news-time">${_fmtRelTime(n.time)}</span>
        ${n.sentimentLabel ? `<span class="news-sent" title="VADER sentiment ${n.sentiment}" style="margin-left:auto;color:${sentColor(n.sentimentLabel)};font-weight:600">${sentIcon(n.sentimentLabel)} ${n.sentimentLabel}</span>` : ''}
      </div>
      <div class="news-title">${_escapeHtml(n.title)}</div>
    </a>
  `;

  let html = '';
  if (agg && agg.count) {
    html += `<div class="news-agg" style="padding:9px 11px;margin-bottom:10px;border:1px solid #1a1a2e;border-radius:8px;background:#0f0f1a;font-size:13px">
      Overall tone: <b style="color:${sentColor(agg.label)}">${sentIcon(agg.label)} ${agg.label}</b>
      <span style="color:#6a6a86">· avg ${agg.avg >= 0 ? '+' : ''}${agg.avg} across ${agg.count} headlines (VADER)</span>
    </div>`;
  }
  if (todayItems.length) {
    html += '<h3 class="news-section-h">Today</h3>' + todayItems.map(renderOne).join('');
  }
  if (olderItems.length) {
    html += '<h3 class="news-section-h">Older</h3>' + olderItems.slice(0, 15).map(renderOne).join('');
  }
  return html;
}

async function openNewsModal(pane) {
  const m = document.getElementById('newsModal');
  if (!m || !pane) return;
  m.hidden = false;
  document.getElementById('newsTitle').textContent = `News — ${pane.rawSymbol}`;
  const out = document.getElementById('newsContent');
  out.innerHTML = '<div class="alerts-empty">Loading headlines…</div>';
  try {
    const r = await fetch(`/api/news?symbol=${encodeURIComponent(pane.symbol)}&source=${pane.source}`);
    const j = await r.json();
    if (!j.ok) {
      out.innerHTML = `<div class="alerts-empty">Failed: ${_escapeHtml(j.error ?? 'unknown error')}</div>`;
      return;
    }
    if (j.info && !j.items?.length) {
      out.innerHTML = `<div class="alerts-empty">${_escapeHtml(j.info)}</div>`;
      return;
    }
    out.innerHTML = renderNewsItems(j.items, j.sentiment);
  } catch (err) {
    out.innerHTML = `<div class="alerts-empty">Failed to load: ${_escapeHtml(err.message ?? String(err))}</div>`;
  }
}

function closeNewsModal() {
  const m = document.getElementById('newsModal');
  if (m) m.hidden = true;
}

async function openStatsModal(pane) {
  const m = document.getElementById('statsModal');
  if (!m || !pane) return;
  m.hidden = false;
  document.getElementById('statsTitle').textContent = `Stats — ${pane.rawSymbol}`;
  const out = document.getElementById('statsContent');
  out.innerHTML = '<div class="alerts-empty">Loading daily candles…</div>';
  try {
    const dailies = (pane.source === 'crypto')
      ? await fetchHLCandles(pane.symbol, '1d')
      : await fetchStockCandles(pane.symbol, '1d');
    if (!dailies?.length) {
      out.innerHTML = '<div class="alerts-empty">No daily data available for this symbol.</div>';
      return;
    }
    const stats = computeStats(dailies, pane.lastPrice ?? null);
    out.innerHTML = renderStats(stats, pane);
  } catch (err) {
    out.innerHTML = `<div class="alerts-empty">Failed to load: ${err.message ?? err}</div>`;
  }
}

function closeStatsModal() {
  const m = document.getElementById('statsModal');
  if (m) m.hidden = true;
}

// ── Backtest (MVP — XO Trend long-only) ────────────────────────────────────────
//
// Replays the candles loaded in a pane through the XO Trend (EMA 12/25) signal
// logic, simulating long-only trades with full balance and no slippage. Outputs
// trade count, win rate, total return, max drawdown, best/worst trade, plus the
// last 20 trades. Not for trading — for evaluating indicator behaviour.

// Slippage is applied symmetrically: when we buy we pay (1 + slip) × close;
// when we sell we receive (1 − slip) × close. Slippage is expressed in basis
// points (1 bp = 0.01%, so 10 bps = 0.10%) — TradingView-style.
function simulateXOTrend(candles, initialCapital, slippageBps = 0) {
  const { markers } = calcXOTrend(candles, 12, 25);
  let cash = initialCapital;
  let position = 0;
  let entry = null;
  const trades = [];
  let peakEquity = cash;
  let maxDrawdown = 0;
  const slip = (slippageBps || 0) / 10_000;   // bps → fraction

  // Sorted by time
  markers.sort((a, b) => a.time - b.time);
  const byTime = new Map(candles.map(c => [c.time, c]));

  const recordDD = (equity) => {
    if (equity > peakEquity) peakEquity = equity;
    const dd = ((peakEquity - equity) / peakEquity) * 100;
    if (dd > maxDrawdown) maxDrawdown = dd;
  };

  for (const m of markers) {
    const candle = byTime.get(m.time);
    if (!candle) continue;
    if (m.text === 'Bull' && position === 0) {
      const fill = candle.close * (1 + slip);
      position = cash / fill;
      entry = { time: m.time, price: fill };
      cash = 0;
    } else if (m.text === 'Bear' && position > 0) {
      const fill = candle.close * (1 - slip);
      cash = position * fill;
      const pnlPct = ((fill - entry.price) / entry.price) * 100;
      trades.push({ entryTime: entry.time, exitTime: m.time, entryPrice: entry.price, exitPrice: fill, pnlPct });
      position = 0;
      recordDD(cash);
    }
  }

  // Mark-to-market any open position at the last candle's close (with slippage)
  if (position > 0) {
    const last = candles[candles.length - 1];
    const fill = last.close * (1 - slip);
    cash = position * fill;
    trades.push({
      entryTime:  entry.time,  exitTime: last.time,
      entryPrice: entry.price, exitPrice: fill,
      pnlPct: ((fill - entry.price) / entry.price) * 100,
      open: true,
    });
    position = 0;
    recordDD(cash);
  }

  const totalReturn = ((cash - initialCapital) / initialCapital) * 100;
  const winning = trades.filter(t => t.pnlPct > 0).length;
  const winRate = trades.length ? (winning / trades.length) * 100 : 0;
  let bestPct = 0, worstPct = 0;
  for (const t of trades) {
    if (t.pnlPct > bestPct)  bestPct  = t.pnlPct;
    if (t.pnlPct < worstPct) worstPct = t.pnlPct;
  }

  return { trades, totalReturn, winRate, maxDrawdown, finalEquity: cash, initialCapital, bestPct, worstPct, slippageBps };
}

function renderBacktestResults(r) {
  if (!r.trades.length) {
    return '<div class="alerts-empty">No trades generated — strategy never crossed in this data set. Try a longer interval or a different symbol.</div>';
  }
  const fmtPct = n => (n >= 0 ? '+' : '') + n.toFixed(2) + '%';
  const tradesRows = r.trades.slice(-20).reverse().map(t => `
    <tr>
      <td>${new Date(t.entryTime * 1000).toLocaleString()}</td>
      <td>${new Date(t.exitTime  * 1000).toLocaleString()}${t.open ? ' <em>(open)</em>' : ''}</td>
      <td>${fmtPrice(t.entryPrice)}</td>
      <td>${fmtPrice(t.exitPrice)}</td>
      <td class="${t.pnlPct >= 0 ? 'up' : 'down'}">${fmtPct(t.pnlPct)}</td>
    </tr>
  `).join('');
  return `
    <div class="bt-stats">
      <div class="bt-stat"><span>Total Return</span><strong class="${r.totalReturn >= 0 ? 'up' : 'down'}">${fmtPct(r.totalReturn)}</strong></div>
      <div class="bt-stat"><span>Trades</span><strong>${r.trades.length}</strong></div>
      <div class="bt-stat"><span>Win Rate</span><strong>${r.winRate.toFixed(1)}%</strong></div>
      <div class="bt-stat"><span>Max Drawdown</span><strong class="down">${r.maxDrawdown.toFixed(2)}%</strong></div>
      <div class="bt-stat"><span>Initial</span><strong>${fmtPrice(r.initialCapital)}</strong></div>
      <div class="bt-stat"><span>Final Equity</span><strong>${fmtPrice(r.finalEquity)}</strong></div>
      <div class="bt-stat"><span>Best Trade</span><strong class="up">${fmtPct(r.bestPct)}</strong></div>
      <div class="bt-stat"><span>Worst Trade</span><strong class="down">${fmtPct(r.worstPct)}</strong></div>
    </div>
    <div class="bt-trades-wrap">
      <h3>Last ${Math.min(20, r.trades.length)} of ${r.trades.length} trades</h3>
      <table class="bt-trades">
        <thead><tr><th>Entry time</th><th>Exit time</th><th>Entry</th><th>Exit</th><th>P&amp;L %</th></tr></thead>
        <tbody>${tradesRows}</tbody>
      </table>
    </div>
    <div class="alert-form-help">
      Slippage applied: <strong>${r.slippageBps ?? 0} bps</strong> (${((r.slippageBps ?? 0) / 100).toFixed(3)}% per side).
      Entry prices are the candle close × (1 + slip); exits are × (1 − slip).
    </div>
  `;
}

function openBacktestModal() {
  const m = document.getElementById('backtestModal');
  if (!m) return;
  m.hidden = false;
  // Refresh pane list (so it reflects current symbols/intervals)
  const sel = document.getElementById('btPane');
  if (sel) {
    sel.innerHTML = '';
    activePanes.forEach((p, i) => {
      sel.appendChild(new Option(`${i + 1}. ${p.rawSymbol} (${p.source}, ${p.interval})`, String(i)));
    });
    const idx = activePane ? activePanes.indexOf(activePane) : 0;
    if (idx >= 0) sel.value = String(idx);
  }
  document.getElementById('btResults').innerHTML = '';
}

function closeBacktestModal() {
  const m = document.getElementById('backtestModal');
  if (m) m.hidden = true;
}

function runBacktest() {
  const paneIdx = parseInt(document.getElementById('btPane').value, 10);
  const pane = activePanes[paneIdx];
  const out = document.getElementById('btResults');
  if (!pane) { out.innerHTML = '<div class="alerts-empty">No pane selected.</div>'; return; }
  if (!pane.candles?.length) {
    out.innerHTML = '<div class="alerts-empty">That pane has no candles yet — wait for it to load.</div>';
    return;
  }
  const capital     = parseFloat(document.getElementById('btCapital').value)  || 10000;
  const slippageBps = parseFloat(document.getElementById('btSlippage').value) || 0;
  const result = simulateXOTrend(pane.candles, capital, slippageBps);
  out.innerHTML = renderBacktestResults(result);
}

// ── Boot ───────────────────────────────────────────────────────────────────────

// Restore theme before charts get created so the first paint already matches
const savedTheme = (localStorage.getItem(LS_THEME) === 'light') ? 'light' : 'dark';
applyDocumentTheme(savedTheme);
const themeSel = document.getElementById('themeSelect');
if (themeSel) {
  themeSel.value = savedTheme;
  themeSel.addEventListener('change', () => {
    const name = themeSel.value === 'light' ? 'light' : 'dark';
    applyDocumentTheme(name);
    activePanes.forEach(p => p.applyTheme(name));
  });
}

// Watchlist wiring
loadWatchlist();
wireWatchlistControls();
renderWatchlist();
startWatchlistPolling();

// Alerts wiring — initial load is async (hits /api/alerts on the server),
// then a 30s refresh loop keeps firedAt/lastError state synced from the worker.
loadAlerts().then(() => { updateAlertsBadge(); });
startAlertsRefreshLoop();
wireAlertsForm();
document.getElementById('alertsBtn')?.addEventListener('click', openAlertsModal);
document.getElementById('alertsClose')?.addEventListener('click', closeAlertsModal);
document.getElementById('alertsTestBtn')?.addEventListener('click', sendTestNotification);
document.getElementById('alertsModal')?.addEventListener('click', e => {
  if (e.target.id === 'alertsModal') closeAlertsModal();
});

// Backtest wiring
document.getElementById('backtestBtn')?.addEventListener('click', openBacktestModal);
document.getElementById('backtestClose')?.addEventListener('click', closeBacktestModal);
document.getElementById('btRunBtn')?.addEventListener('click', runBacktest);
document.getElementById('backtestModal')?.addEventListener('click', e => {
  if (e.target.id === 'backtestModal') closeBacktestModal();
});

// Stats wiring (per-pane open is wired in _buildControls; here we handle close)
document.getElementById('statsClose')?.addEventListener('click', closeStatsModal);
document.getElementById('statsModal')?.addEventListener('click', e => {
  if (e.target.id === 'statsModal') closeStatsModal();
});

// News wiring (per-pane open is wired in _buildControls; here we handle close)
document.getElementById('newsClose')?.addEventListener('click', closeNewsModal);
document.getElementById('newsModal')?.addEventListener('click', e => {
  if (e.target.id === 'newsModal') closeNewsModal();
});

// Projections wiring
document.getElementById('projectionsClose')?.addEventListener('click', closeProjectionsModal);
document.getElementById('projectionsModal')?.addEventListener('click', e => {
  if (e.target.id === 'projectionsModal') closeProjectionsModal();
});

document.addEventListener('keydown', e => {
  if (e.key !== 'Escape') return;
  // Exit any fullscreen pane first; otherwise close any open modal.
  const fs = document.querySelector('.pane.fullscreen');
  if (fs) { fs.classList.remove('fullscreen'); return; }
  closeAlertsModal();
  closeBacktestModal();
  closeStatsModal();
  closeNewsModal();
  closeProjectionsModal();
});

HLSocket.init(hlStatus, hlPill, hlDotHeader);

chartCountSel.addEventListener('change', () => setChartCount(Number(chartCountSel.value)));

updateMarketStatus();
setInterval(updateMarketStatus, 30_000);

const VALID_COUNTS = [1, 2, 4, 6, 8];
const savedCount   = parseInt(localStorage.getItem(LS_COUNT) ?? '4', 10);
setChartCount(VALID_COUNTS.includes(savedCount) ? savedCount : 4);
