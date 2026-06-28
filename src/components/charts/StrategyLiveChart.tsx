import { useEffect, useRef, useState, useCallback } from 'react';
import {
  createChart,
  ColorType,
  CrosshairMode,
  CandlestickSeries,
  LineSeries,
  createSeriesMarkers,
  type SeriesMarker,
  type Time,
} from 'lightweight-charts';
import { Loader2, RefreshCw, TrendingUp, Wifi, WifiOff } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { supabase } from '@/db/supabase';
import { cn } from '@/lib/utils';

interface OHLCVBar {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
}

interface SignalPoint {
  time: number;
  direction: 'buy' | 'sell';
  price: number;
}

// ── Strategy params passed from parent ──────────────────────────────────────
export interface StrategyRiskConfig {
  strategy_type?: 'rsi_ema' | 'supertrend' | 'smc' | 'mixed';
  rsi_length: number;
  overbought: number;
  oversold: number;
  ema_fast: number;
  ema_slow: number;
  st_multiplier?: number;
  st_lookback?: number;
  rsi_filter_enabled?: boolean;
  rsi_filter_long_level?: number;
  trade_direction: 'long' | 'short' | 'both';
  stop_loss_pct: number | null;
  tp1_pct: number | null;
  tp2_pct: number | null;
  tp3_pct: number | null;
}

interface StrategyLiveChartProps {
  symbol: string;
  timeframe: string;
  strategyId: string;
  /** Pass after Save Risk Settings to trigger immediate backtest overlay */
  riskConfig?: StrategyRiskConfig | null;
}

// ── Client-side indicator helpers ───────────────────────────────────────────
function calcEMA(closes: number[], period: number): number[] {
  const k = 2 / (period + 1);
  const ema: number[] = [];
  for (let i = 0; i < closes.length; i++) {
    if (i < period - 1) { ema.push(NaN); continue; }
    if (i === period - 1) { ema.push(closes.slice(0, period).reduce((a, b) => a + b, 0) / period); continue; }
    ema.push(closes[i] * k + ema[i - 1] * (1 - k));
  }
  return ema;
}

function calcRSI(closes: number[], period: number): number[] {
  const rsi: number[] = new Array(closes.length).fill(NaN);
  if (closes.length < period + 1) return rsi;
  let gains = 0, losses = 0;
  for (let i = 1; i <= period; i++) {
    const d = closes[i] - closes[i - 1];
    if (d > 0) gains += d; else losses -= d;
  }
  let avgGain = gains / period, avgLoss = losses / period;
  rsi[period] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);
  for (let i = period + 1; i < closes.length; i++) {
    const d = closes[i] - closes[i - 1];
    avgGain = (avgGain * (period - 1) + (d > 0 ? d : 0)) / period;
    avgLoss = (avgLoss * (period - 1) + (d < 0 ? -d : 0)) / period;
    rsi[i] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);
  }
  return rsi;
}

/** Supertrend — returns per-bar direction: -1=bullish, 1=bearish */
function calcSupertrendArray(bars: OHLCVBar[], period: number, multiplier: number): number[] {
  const n = bars.length;
  const dirs = new Array(n).fill(0);
  if (n < period + 1) return dirs;
  // Wilder ATR (RMA)
  const tr: number[] = [0];
  for (let i = 1; i < n; i++) {
    tr.push(Math.max(
      bars[i].high - bars[i].low,
      Math.abs(bars[i].high - bars[i - 1].close),
      Math.abs(bars[i].low  - bars[i - 1].close)
    ));
  }
  const atr = new Array(n).fill(0);
  let s = 0;
  for (let i = 1; i <= period; i++) s += tr[i];
  atr[period] = s / period;
  for (let i = period + 1; i < n; i++) atr[i] = (atr[i - 1] * (period - 1) + tr[i]) / period;

  let prevUpper = 0, prevLower = 0, prevDir = 1;
  for (let i = period; i < n; i++) {
    const hl2 = (bars[i].high + bars[i].low) / 2;
    let upper = hl2 + multiplier * atr[i];
    let lower = hl2 - multiplier * atr[i];
    if (prevLower > 0) lower = lower > prevLower || bars[i - 1].close < prevLower ? lower : prevLower;
    if (prevUpper > 0) upper = upper < prevUpper || bars[i - 1].close > prevUpper ? upper : prevUpper;
    let dir: number;
    if (i === period) { dir = 1; }
    else if (prevDir === -1) { dir = bars[i].close < lower ? 1 : -1; }
    else { dir = bars[i].close > upper ? -1 : 1; }
    dirs[i] = dir;
    prevUpper = upper; prevLower = lower; prevDir = dir;
  }
  return dirs;
}

interface StrategySignalResult {
  time: number;
  direction: 'buy' | 'sell';
  price: number;
  slPrice: number | null;
  tpPrices: number[];
  // Forward scan results — which candle hit TP/SL
  slHit: { time: number; price: number } | null;
  tpHits: { level: number; time: number; price: number }[];
}

function runStrategyBacktest(bars: OHLCVBar[], cfg: StrategyRiskConfig): StrategySignalResult[] {
  const type = cfg.strategy_type ?? 'rsi_ema';
  const minBars = Math.max(cfg.rsi_length, cfg.ema_slow, (cfg.st_lookback ?? 10) * 2) + 5;
  if (bars.length < minBars) return [];

  const closes = bars.map(b => b.close);
  const results: StrategySignalResult[] = [];

  // ── Supertrend backtest ──
  if (type === 'supertrend' || type === 'mixed') {
    const stMult = cfg.st_multiplier ?? 2.0;
    const stLen  = cfg.st_lookback  ?? 10;
    const stDirs = calcSupertrendArray(bars, stLen, stMult);

    for (let i = 1; i < bars.length; i++) {
      if (stDirs[i] === 0 || stDirs[i - 1] === 0) continue;
      const price = bars[i].close;
      const isBuy  = stDirs[i - 1] === 1  && stDirs[i] === -1;  // bearish→bullish
      const isSell = stDirs[i - 1] === -1 && stDirs[i] === 1;   // bullish→bearish

      const canLong  = cfg.trade_direction === 'long'  || cfg.trade_direction === 'both';
      const canShort = cfg.trade_direction === 'short' || cfg.trade_direction === 'both';

      if ((!isBuy || !canLong) && (!isSell || !canShort)) continue;

      // mixed: also try RSI+EMA crossover
      const dir: 'buy' | 'sell' = isBuy ? 'buy' : 'sell';
      results.push(...buildResult(bars, i, dir, cfg));
    }

    // For mixed type, also add RSI+EMA signals
    if (type === 'mixed') {
      const rsi  = calcRSI(closes, cfg.rsi_length);
      const emaF = calcEMA(closes, cfg.ema_fast);
      const emaS = calcEMA(closes, cfg.ema_slow);
      for (let i = 1; i < bars.length; i++) {
        if (isNaN(rsi[i]) || isNaN(emaF[i]) || isNaN(emaS[i])) continue;
        const isBuy  = rsi[i - 1] < cfg.oversold  && rsi[i] >= cfg.oversold  && emaF[i] > emaS[i];
        const isSell = rsi[i - 1] > cfg.overbought && rsi[i] <= cfg.overbought && emaF[i] < emaS[i];
        if (!isBuy && !isSell) continue;
        const dir: 'buy' | 'sell' = isBuy ? 'buy' : 'sell';
        results.push(...buildResult(bars, i, dir, cfg));
      }
    }

    return results.sort((a, b) => a.time - b.time);
  }

  // ── RSI + EMA crossover backtest (default) ──
  const rsi  = calcRSI(closes, cfg.rsi_length);
  const emaF = calcEMA(closes, cfg.ema_fast);
  const emaS = calcEMA(closes, cfg.ema_slow);

  for (let i = 1; i < bars.length; i++) {
    if (isNaN(rsi[i]) || isNaN(emaF[i]) || isNaN(emaS[i])) continue;
    const isBuy  = (cfg.trade_direction === 'long'  || cfg.trade_direction === 'both')
      && rsi[i - 1] < cfg.oversold  && rsi[i] >= cfg.oversold  && emaF[i] > emaS[i];
    const isSell = (cfg.trade_direction === 'short' || cfg.trade_direction === 'both')
      && rsi[i - 1] > cfg.overbought && rsi[i] <= cfg.overbought && emaF[i] < emaS[i];
    if (!isBuy && !isSell) continue;
    results.push(...buildResult(bars, i, isBuy ? 'buy' : 'sell', cfg));
  }
  return results;
}

/** Build a StrategySignalResult with forward-scan TP/SL hits */
function buildResult(bars: OHLCVBar[], i: number, dir: 'buy' | 'sell', cfg: StrategyRiskConfig): StrategySignalResult[] {
  const price = bars[i].close;
  const slPrice = cfg.stop_loss_pct != null
    ? dir === 'buy' ? price * (1 - cfg.stop_loss_pct / 100) : price * (1 + cfg.stop_loss_pct / 100)
    : null;
  const tpPrices: number[] = [];
  for (const tpPct of [cfg.tp1_pct, cfg.tp2_pct, cfg.tp3_pct]) {
    if (tpPct != null && tpPct > 0)
      tpPrices.push(dir === 'buy' ? price * (1 + tpPct / 100) : price * (1 - tpPct / 100));
  }
  // Forward scan for TP/SL hits
  let slHit: { time: number; price: number } | null = null;
  const tpHits: { level: number; time: number; price: number }[] = [];
  const remaining = tpPrices.map((tp, idx) => ({ tp, level: idx + 1, hit: false }));
  for (let j = i + 1; j < bars.length; j++) {
    const bar = bars[j];
    if (slPrice != null && !slHit) {
      if (dir === 'buy' ? bar.low <= slPrice : bar.high >= slPrice) {
        slHit = { time: bar.time, price: slPrice }; break;
      }
    }
    for (const e of remaining) {
      if (e.hit) continue;
      if (dir === 'buy' ? bar.high >= e.tp : bar.low <= e.tp) {
        e.hit = true; tpHits.push({ level: e.level, time: bar.time, price: e.tp });
      }
    }
    if (remaining.every(e => e.hit)) break;
  }
  return [{ time: bars[i].time, direction: dir, price, slPrice, tpPrices, slHit, tpHits }];
}

const SYMBOLS = ['BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'BNBUSDT', 'XRPUSDT', 'DOGEUSDT'];
const TIMEFRAMES = ['1m', '5m', '15m', '30m', '1h', '4h', '1d'];

const TF_INTERVAL: Record<string, string> = {
  '1m': '1m', '5m': '5m', '15m': '15m', '30m': '30m',
  '1h': '1h', '4h': '4h', '1d': '1d',
};

// How many candles needed per timeframe to cover ~15 days
const TF_LIMIT: Record<string, number> = {
  '1m':  2000,  // ~1.4 days (1m is too granular for 15d)
  '5m':  4320,  // 15 days ✅ (needs multi-batch)
  '15m': 1440,  // 15 days ✅ (needs multi-batch)
  '30m': 720,   // 15 days ✅
  '1h':  360,   // 15 days ✅
  '4h':  90,    // 15 days ✅
  '1d':  60,    // ~2 months ✅
};

const BINANCE_BATCH = 1000; // Binance max per request

async function fetchBinanceKlines(symbol: string, interval: string, limit = 720): Promise<OHLCVBar[]> {
  const sym = symbol.toUpperCase();
  const base = 'https://api.binance.com/api/v3/klines';

  // Single batch — fast path
  if (limit <= BINANCE_BATCH) {
    const res = await fetch(`${base}?symbol=${sym}&interval=${interval}&limit=${limit}`);
    if (!res.ok) throw new Error(`Binance klines error: ${res.status}`);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const raw: any[][] = await res.json();
    return raw.map(k => ({
      time: Math.floor(k[0] / 1000), open: parseFloat(k[1]),
      high: parseFloat(k[2]), low: parseFloat(k[3]), close: parseFloat(k[4]),
    }));
  }

  // Multi-batch: fetch oldest→newest using endTime walk-back
  const allBars: OHLCVBar[] = [];
  let endTime: number | null = null; // null = latest
  let remaining = limit;

  while (remaining > 0) {
    const batchSize = Math.min(remaining, BINANCE_BATCH);
    const url = endTime
      ? `${base}?symbol=${sym}&interval=${interval}&limit=${batchSize}&endTime=${endTime}`
      : `${base}?symbol=${sym}&interval=${interval}&limit=${batchSize}`;
    const res = await fetch(url);
    if (!res.ok) break;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const raw: any[][] = await res.json();
    if (!raw.length) break;
    const batch: OHLCVBar[] = raw.map(k => ({
      time: Math.floor(k[0] / 1000), open: parseFloat(k[1]),
      high: parseFloat(k[2]), low: parseFloat(k[3]), close: parseFloat(k[4]),
    }));
    // Prepend older batch
    allBars.unshift(...batch);
    remaining -= batch.length;
    // Move endTime back: oldest bar open time - 1ms
    endTime = raw[0][0] - 1;
    if (batch.length < batchSize) break; // no more data
  }

  // Deduplicate by time (in case of overlap) and sort ascending
  const seen = new Set<number>();
  return allBars.filter(b => { if (seen.has(b.time)) return false; seen.add(b.time); return true; })
    .sort((a, b) => a.time - b.time);
}

async function fetchStrategySignals(strategyId: string, symbol: string): Promise<SignalPoint[]> {
  const { data } = await supabase
    .from('trades')
    .select('direction, entry_price, opened_at')
    .eq('symbol', symbol.toUpperCase())
    .order('opened_at', { ascending: false })
    .limit(200);

  const { data: signals } = await supabase
    .from('signals')
    .select('direction, entry_price, created_at')
    .eq('strategy_id', strategyId)
    .order('created_at', { ascending: false })
    .limit(200);

  const fromTrades: SignalPoint[] = (data as { direction: string; entry_price: number; opened_at: string }[] ?? [])
    .map(t => ({
      time: Math.floor(new Date(t.opened_at).getTime() / 1000),
      direction: (t.direction === 'buy' ? 'buy' : 'sell') as 'buy' | 'sell',
      price: t.entry_price,
    }));

  const fromSignals: SignalPoint[] = (signals as { direction: string; entry_price: number; created_at: string }[] ?? [])
    .map(s => ({
      time: Math.floor(new Date(s.created_at).getTime() / 1000),
      direction: (s.direction === 'buy' ? 'buy' : 'sell') as 'buy' | 'sell',
      price: s.entry_price,
    }));

  const all = [...fromTrades, ...fromSignals];
  const seen = new Set<number>();
  return all.filter(s => {
    if (seen.has(s.time)) return false;
    seen.add(s.time);
    return true;
  });
}

export function StrategyLiveChart({ symbol: defaultSymbol, timeframe: defaultTF, strategyId, riskConfig }: StrategyLiveChartProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const chartRef = useRef<any | null>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const candleSeriesRef = useRef<any | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const userPannedRef = useRef<boolean>(false); // track if user manually scrolled

  const [activeSymbol, setActiveSymbol] = useState(defaultSymbol || 'BTCUSDT');
  const [activeTF, setActiveTF] = useState(defaultTF || '1h');

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [candles, setCandles] = useState<OHLCVBar[]>([]);
  const [signals, setSignals] = useState<SignalPoint[]>([]);
  // Strategy backtest results (computed client-side from riskConfig)
  const [strategySignals, setStrategySignals] = useState<StrategySignalResult[]>([]);
  const [lastPrice, setLastPrice] = useState<number | null>(null);
  const [priceChange, setPriceChange] = useState<number | null>(null);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [wsConnected, setWsConnected] = useState(false);
  // Latest live signal from strategy evaluation
  const [liveSignal, setLiveSignal] = useState<{ direction: 'buy' | 'sell'; price: number } | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const interval = TF_INTERVAL[activeTF] ?? '1h';
      const limit = TF_LIMIT[activeTF] ?? 720;
      const [bars, sigs] = await Promise.all([
        fetchBinanceKlines(activeSymbol, interval, limit),
        fetchStrategySignals(strategyId, activeSymbol),
      ]);
      setCandles(bars);
      setSignals(sigs);
      if (bars.length > 0) {
        setLastPrice(bars[bars.length - 1].close);
        if (bars.length > 1) {
          const change = ((bars[bars.length - 1].close - bars[0].open) / bars[0].open) * 100;
          setPriceChange(change);
        }
      }
      setLastUpdated(new Date());
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [activeSymbol, activeTF, strategyId]);

  // Reset to strategy defaults when parent changes
  useEffect(() => { setActiveSymbol(defaultSymbol || 'BTCUSDT'); }, [defaultSymbol]);
  useEffect(() => { setActiveTF(defaultTF || '1h'); }, [defaultTF]);
  useEffect(() => { load(); }, [load]);

  // ── Recompute strategy backtest whenever candles or riskConfig changes ──
  useEffect(() => {
    if (!riskConfig || candles.length === 0) return; // keep existing signals, don't clear
    const results = runStrategyBacktest(candles, riskConfig);
    setStrategySignals(results);
    setLiveSignal(null);
    if (results.length > 0) {
      const last = results[results.length - 1];
      if (last.time === candles[candles.length - 1].time) {
        setLiveSignal({ direction: last.direction, price: last.price });
      }
    }
  }, [candles, riskConfig]);

  // ── WebSocket: real-time candle updates from Binance ──
  useEffect(() => {
    // Close any existing WS
    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }
    setWsConnected(false);

    const interval = TF_INTERVAL[activeTF] ?? '1h';
    const streamSymbol = activeSymbol.toLowerCase();
    const wsUrl = `wss://stream.binance.com:9443/ws/${streamSymbol}@kline_${interval}`;

    let ws: WebSocket;
    let reconnectTimer: ReturnType<typeof setTimeout>;

    function connect() {
      ws = new WebSocket(wsUrl);
      wsRef.current = ws;

      ws.onopen = () => setWsConnected(true);
      ws.onclose = () => {
        setWsConnected(false);
        // Auto-reconnect after 3s
        reconnectTimer = setTimeout(connect, 3000);
      };
      ws.onerror = () => ws.close();

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ws.onmessage = (evt: MessageEvent) => {
        try {
          const msg = JSON.parse(evt.data as string);
          const k = msg.k;
          if (!k) return;

          const bar: OHLCVBar = {
            time: Math.floor(k.t / 1000),
            open:  parseFloat(k.o),
            high:  parseFloat(k.h),
            low:   parseFloat(k.l),
            close: parseFloat(k.c),
          };

          // Update live price display
          setLastPrice(bar.close);

          // Update candle series directly (no full re-render)
          if (candleSeriesRef.current) {
            candleSeriesRef.current.update({
              time: bar.time as Time,
              open: bar.open,
              high: bar.high,
              low: bar.low,
              close: bar.close,
            });
          }

          // Update candles state so priceChange stays accurate
          setCandles(prev => {
            if (prev.length === 0) return prev;
            const last = prev[prev.length - 1];
            if (last.time === bar.time) {
              // Update current candle
              const updated = [...prev];
              updated[updated.length - 1] = bar;
              const change = ((bar.close - updated[0].open) / updated[0].open) * 100;
              setPriceChange(change);
              return updated;
            } else if (bar.time > last.time) {
              // New candle opened
              const updated = [...prev, bar];
              const change = ((bar.close - updated[0].open) / updated[0].open) * 100;
              setPriceChange(change);
              return updated;
            }
            return prev;
          });
          setLastUpdated(new Date());
        } catch { /* ignore parse errors */ }
      };
    }

    connect();

    return () => {
      clearTimeout(reconnectTimer);
      if (wsRef.current) {
        wsRef.current.onclose = null; // prevent reconnect on intentional close
        wsRef.current.close();
        wsRef.current = null;
      }
      setWsConnected(false);
    };
  }, [activeSymbol, activeTF]);

  // ── Build/rebuild chart whenever candles or signals change ──
  useEffect(() => {
    if (!containerRef.current || candles.length === 0) return;

    if (chartRef.current) {
      chartRef.current.remove();
      chartRef.current = null;
      candleSeriesRef.current = null;
    }

    const el = containerRef.current;
    const chart = createChart(el, {
      layout: {
        background: { type: ColorType.Solid, color: '#0d1117' },
        textColor: '#7a8499',
        fontSize: 11,
      },
      grid: {
        vertLines: { color: '#1e2330' },
        horzLines: { color: '#1e2330' },
      },
      crosshair: {
        mode: CrosshairMode.Normal,
        vertLine: { color: '#00d4ff', width: 1, style: 3, labelBackgroundColor: '#161b27' },
        horzLine: { color: '#00d4ff', width: 1, style: 3, labelBackgroundColor: '#161b27' },
      },
      rightPriceScale: {
        borderColor: '#272d3d',
        scaleMargins: { top: 0.1, bottom: 0.15 },
      },
      timeScale: {
        borderColor: '#272d3d',
        timeVisible: true,
        secondsVisible: activeTF === '1m',
      },
      width: el.clientWidth,
      height: 320,
      handleScroll: true,
      handleScale: true,
    });
    // Reset pan state when chart rebuilds (e.g. TF or symbol change)
    userPannedRef.current = false;
    chartRef.current = chart;

    // Track when user manually scrolls/zooms
    chart.timeScale().subscribeVisibleTimeRangeChange(() => {
      // Mark as user-panned so we stop auto-scrolling
      userPannedRef.current = true;
    });

    const candleSeries = chart.addSeries(CandlestickSeries, {
      upColor: '#22c55e',
      downColor: '#ef4444',
      borderUpColor: '#22c55e',
      borderDownColor: '#ef4444',
      wickUpColor: '#4ade80',
      wickDownColor: '#f87171',
    });
    candleSeriesRef.current = candleSeries;

    const sorted = [...candles]
      .sort((a, b) => a.time - b.time)
      .filter((c, i, arr) => i === 0 || c.time !== arr[i - 1].time);

    candleSeries.setData(sorted.map(c => ({
      time: c.time as Time,
      open: c.open, high: c.high, low: c.low, close: c.close,
    })));

    // ── Strategy backtest markers (RSI+EMA signals) + DB trade markers ──
    const allMarkers: SeriesMarker<Time>[] = [];

    const timeArray = sorted.map(c => c.time);
    function snapToNearest(target: number): number {
      let best = timeArray[0]; let bestDiff = Math.abs(target - best);
      for (const t of timeArray) { const d = Math.abs(target - t); if (d < bestDiff) { best = t; bestDiff = d; } }
      return best;
    }

    // 1️⃣ Computed strategy signals (arrows) + TP/SL hit markers
    if (strategySignals.length > 0) {
      for (const sig of strategySignals) {
        if (sig.time < sorted[0].time || sig.time > sorted[sorted.length - 1].time) continue;

        // Entry signal arrow
        allMarkers.push({
          time: sig.time as Time,
          position: sig.direction === 'buy' ? 'belowBar' : 'aboveBar',
          color: sig.direction === 'buy' ? '#22c55e' : '#ef4444',
          shape: sig.direction === 'buy' ? 'arrowUp' : 'arrowDown',
          text: `${sig.direction.toUpperCase()} $${sig.price.toFixed(sig.price > 100 ? 1 : 4)}`,
          size: 1.8,
        });

        // TP hit markers (green squares above/below bar)
        for (const tpHit of sig.tpHits) {
          const snapped = snapToNearest(tpHit.time);
          if (snapped < sorted[0].time || snapped > sorted[sorted.length - 1].time) continue;
          allMarkers.push({
            time: snapped as Time,
            position: sig.direction === 'buy' ? 'aboveBar' : 'belowBar',
            color: tpHit.level === 1 ? '#22c55e' : tpHit.level === 2 ? '#4ade80' : '#86efac',
            shape: 'square',
            text: `✅TP${tpHit.level} $${tpHit.price.toFixed(tpHit.price > 100 ? 1 : 4)}`,
            size: 1.2,
          });
        }

        // SL hit marker (red square)
        if (sig.slHit) {
          const snapped = snapToNearest(sig.slHit.time);
          if (snapped >= sorted[0].time && snapped <= sorted[sorted.length - 1].time) {
            allMarkers.push({
              time: snapped as Time,
              position: sig.direction === 'buy' ? 'belowBar' : 'aboveBar',
              color: '#ef4444',
              shape: 'square',
              text: `❌SL $${sig.slHit.price.toFixed(sig.slHit.price > 100 ? 1 : 4)}`,
              size: 1.2,
            });
          }
        }
      }
    }

    // 2️⃣ DB trade markers (circles) — ALWAYS shown, actual executed trades
    if (signals.length > 0) {
      for (const s of signals.filter(s => s.time >= sorted[0].time && s.time <= sorted[sorted.length - 1].time)) {
        allMarkers.push({
          time: snapToNearest(s.time) as Time,
          position: s.direction === 'buy' ? 'belowBar' : 'aboveBar',
          color: s.direction === 'buy' ? '#00d4ff' : '#f59e0b',
          shape: 'circle',
          text: `✅ ${s.direction.toUpperCase()} $${s.price.toFixed(s.price > 100 ? 1 : 4)}`,
          size: 1.2,
        });
      }
    }

    const validMarkers = allMarkers.filter(m => m.time != null && !isNaN(Number(m.time)));
    if (validMarkers.length > 0) {
      validMarkers.sort((a, b) => (a.time as number) - (b.time as number));
      
      // Use v5 API for markers
      if (!(candleSeries as any)._markersPlugin) {
        (candleSeries as any)._markersPlugin = createSeriesMarkers(candleSeries, validMarkers);
      } else {
        (candleSeries as any)._markersPlugin.setMarkers(validMarkers);
      }
    } else if ((candleSeries as any)._markersPlugin) {
      (candleSeries as any)._markersPlugin.setMarkers([]);
    }

    // ── SL / TP price lines for the LAST strategy signal ──
    if (strategySignals.length > 0) {
      const lastSig = strategySignals[strategySignals.length - 1];

      if (lastSig.slPrice != null) {
        const slLine = chart.addSeries(LineSeries, {
          color: '#ef4444',
          lineWidth: 1,
          lineStyle: 2, // dashed
          title: `SL ${lastSig.slPrice.toFixed(lastSig.slPrice > 100 ? 1 : 4)}`,
          crosshairMarkerVisible: false,
          lastValueVisible: true,
          priceLineVisible: false,
        });
        const slData = [{ time: lastSig.time as Time, value: lastSig.slPrice }];
        if (lastSig.time !== sorted[sorted.length - 1].time) {
          slData.push({ time: sorted[sorted.length - 1].time as Time, value: lastSig.slPrice });
        }
        slLine.setData(slData);
      }

      const tpColors = ['#22c55e', '#4ade80', '#86efac'];
      lastSig.tpPrices.forEach((tp, idx) => {
        const tpLine = chart.addSeries(LineSeries, {
          color: tpColors[idx] ?? '#22c55e',
          lineWidth: 1,
          lineStyle: 2,
          title: `TP${idx + 1} ${tp.toFixed(tp > 100 ? 1 : 4)}`,
          crosshairMarkerVisible: false,
          lastValueVisible: true,
          priceLineVisible: false,
        });
        const tpData = [{ time: lastSig.time as Time, value: tp }];
        if (lastSig.time !== sorted[sorted.length - 1].time) {
          tpData.push({ time: sorted[sorted.length - 1].time as Time, value: tp });
        }
        tpLine.setData(tpData);
      });
    }

    // Only fitContent on the very first load; after that, let user control the view
    if (!userPannedRef.current) {
      chart.timeScale().fitContent();
    }

    const ro = new ResizeObserver(entries => {
      for (const entry of entries) {
        chart.applyOptions({ width: entry.contentRect.width });
      }
    });
    ro.observe(el);

    return () => {
      ro.disconnect();
      chart.remove();
      chartRef.current = null;
      candleSeriesRef.current = null;
    };
  }, [candles, signals, strategySignals, activeTF]);

  const displaySymbol = activeSymbol.toUpperCase().replace('USDT', '/USDT');
  const shortLabel = (s: string) => s.replace('USDT', '');

  return (
    <div className="rounded border border-border bg-[#0d1117] overflow-hidden">
      {/* ── Header: symbol + price + WS status ── */}
      <div className="flex items-center justify-between gap-2 px-3 py-2 border-b border-[#1e2330]">
        <div className="flex items-center gap-2 min-w-0">
          <TrendingUp className="h-3.5 w-3.5 text-primary shrink-0" />
          <span className="text-xs font-bold text-foreground font-mono">{displaySymbol}</span>
          {lastPrice !== null && (
            <span className="text-xs font-mono font-semibold text-success">
              ${lastPrice.toLocaleString(undefined, { minimumFractionDigits: lastPrice > 100 ? 2 : 4, maximumFractionDigits: lastPrice > 100 ? 2 : 6 })}
            </span>
          )}
          {priceChange !== null && (
            <Badge className={cn('text-[10px] px-1.5', priceChange >= 0 ? 'bg-success/15 text-success border-success/30' : 'bg-destructive/15 text-destructive border-destructive/30')}>
              {priceChange >= 0 ? '+' : ''}{priceChange.toFixed(2)}%
            </Badge>
          )}
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          {signals.filter(s => s.direction === 'buy').length > 0 && (
            <Badge className="text-[10px] bg-success/15 text-success border-success/30 px-1.5">
              ↑ {signals.filter(s => s.direction === 'buy').length} BUY
            </Badge>
          )}
          {signals.filter(s => s.direction === 'sell').length > 0 && (
            <Badge className="text-[10px] bg-destructive/15 text-destructive border-destructive/30 px-1.5">
              ↓ {signals.filter(s => s.direction === 'sell').length} SELL
            </Badge>
          )}
          {/* Live WS indicator */}
          <span className={cn('flex items-center gap-1 text-[10px]', wsConnected ? 'text-success' : 'text-muted-foreground')}>
            {wsConnected
              ? <><Wifi className="h-3 w-3" /> LIVE</>
              : <><WifiOff className="h-3 w-3" /> {lastUpdated ? lastUpdated.toLocaleTimeString() : '—'}</>
            }
          </span>
          {/* Live signal badge */}
          {liveSignal && (
            <Badge className={cn(
              'text-[10px] px-1.5 animate-pulse',
              liveSignal.direction === 'buy'
                ? 'bg-success/20 text-success border-success/40'
                : 'bg-destructive/20 text-destructive border-destructive/40'
            )}>
              🔔 {liveSignal.direction.toUpperCase()} NOW
            </Badge>
          )}          <Button
            variant="ghost" size="icon"
            className={cn('h-6 w-6 text-muted-foreground hover:text-foreground', loading && 'animate-spin')}
            onClick={load} disabled={loading}
          >
            <RefreshCw className="h-3 w-3" />
          </Button>
        </div>
      </div>

      {/* ── Symbol picker row ── */}
      <div className="flex items-center gap-1 px-3 py-1.5 border-b border-[#1e2330] overflow-x-auto">
        <span className="text-[10px] text-muted-foreground shrink-0 mr-1">Pair:</span>
        {SYMBOLS.map(sym => (
          <button
            key={sym}
            onClick={() => setActiveSymbol(sym)}
            className={cn(
              'shrink-0 rounded px-2 py-0.5 text-[10px] font-mono font-semibold transition-colors',
              activeSymbol === sym
                ? 'bg-primary text-primary-foreground'
                : 'bg-[#1e2330] text-muted-foreground hover:bg-[#272d3d] hover:text-foreground'
            )}
          >
            {shortLabel(sym)}
          </button>
        ))}
      </div>

      {/* ── Timeframe picker row ── */}
      <div className="flex items-center gap-1 px-3 py-1.5 border-b border-[#1e2330]">
        <span className="text-[10px] text-muted-foreground shrink-0 mr-1">TF:</span>
        {TIMEFRAMES.map(tf => (
          <button
            key={tf}
            onClick={() => setActiveTF(tf)}
            className={cn(
              'shrink-0 rounded px-2 py-0.5 text-[10px] font-mono font-semibold transition-colors',
              activeTF === tf
                ? 'bg-primary text-primary-foreground'
                : 'bg-[#1e2330] text-muted-foreground hover:bg-[#272d3d] hover:text-foreground'
            )}
          >
            {tf}
          </button>
        ))}
      </div>

      {/* ── Chart body ── */}
      <div className="relative">
        {loading && (
          <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-2 bg-[#0d1117]">
            <Loader2 className="h-5 w-5 animate-spin text-primary" />
            <p className="text-[11px] text-muted-foreground">Loading candlestick data…</p>
          </div>
        )}
        {error && !loading && (
          <div className="flex h-48 flex-col items-center justify-center gap-2 px-4 text-center">
            <p className="text-xs text-destructive">{error}</p>
            <Button size="sm" variant="ghost" onClick={load} className="h-7 text-xs gap-1">
              <RefreshCw className="h-3 w-3" /> Retry
            </Button>
          </div>
        )}
        {!error && <div ref={containerRef} className="w-full" style={{ minHeight: 300 }} />}
      </div>

      {/* ── Legend ── */}
      {!loading && !error && (
        <div className="flex items-center gap-3 px-3 py-1.5 border-t border-[#1e2330] text-[10px] text-muted-foreground flex-wrap">
          <span className="flex items-center gap-1"><span className="inline-block h-2 w-2 rounded-sm bg-[#22c55e]" />BUY Signal</span>
          <span className="flex items-center gap-1"><span className="inline-block h-2 w-2 rounded-sm bg-[#ef4444]" />SELL Signal</span>
          <span className="flex items-center gap-1"><span className="inline-block h-2 w-2 rounded-sm bg-[#4ade80]" />✅TP Hit</span>
          <span className="flex items-center gap-1"><span className="inline-block h-2 w-2 rounded-sm bg-[#ef4444] opacity-70" />❌SL Hit</span>
          <span className="flex items-center gap-1"><span className="inline-block h-2 w-2 rounded-full bg-[#00d4ff]" />Executed BUY</span>
          <span className="flex items-center gap-1"><span className="inline-block h-2 w-2 rounded-full bg-[#f59e0b]" />Executed SELL</span>
          <span className="ml-auto">Binance • {wsConnected ? '🟢 WebSocket Live' : 'Live Data'}</span>
        </div>
      )}
    </div>
  );
}
