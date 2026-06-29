import { createClient } from 'npm:@supabase/supabase-js@2';

/**
 * Market Scanner — Tredzo SMC Edition
 * - Fetches top gainers & losers from Binance 24hr ticker
 * - Runs the Tredzo Strategy scoring engine (ADX, ATR, Pivot Zones,
 *   Liquidity Sweep, Rejection Candle, Volume, EMA, Pump/Dump)
 * - Returns signal + score for each coin
 */

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const BINANCE_BASE = 'https://api.binance.com';

interface BinanceTicker {
  symbol: string;
  lastPrice: string;
  priceChangePercent: string;
  quoteVolume: string;
  highPrice: string;
  lowPrice: string;
  volume: string;
}

interface OHLCV {
  open: number; high: number; low: number; close: number; volume: number;
}

interface ScanItem {
  id: string;
  symbol: string;
  price: number;
  change_pct_24h: number;
  volume_24h: number;
  scan_type: 'gainer' | 'loser';
  signal_direction: 'buy' | 'sell' | null;
  confidence: number;
  timeframe: string;
  scanned_at: string;
  tredzo_score: number;
  tredzo_reason: string;
  mandatory_ok: boolean;
}

// ─── Indicator Math ───────────────────────────────────────────────────────────

function calcSMA(values: number[], period: number): number {
  if (values.length < period) return values[values.length - 1] ?? 0;
  let sum = 0;
  for (let i = values.length - period; i < values.length; i++) sum += values[i];
  return sum / period;
}

function calcEMA(closes: number[], period: number): number {
  if (closes.length < period) return closes[closes.length - 1] ?? 0;
  const k = 2 / (period + 1);
  let ema = closes.slice(0, period).reduce((s, v) => s + v, 0) / period;
  for (let i = period; i < closes.length; i++) ema = closes[i] * k + ema * (1 - k);
  return ema;
}

function calcATR(candles: OHLCV[], period: number): number[] {
  const trs: number[] = [];
  for (let i = 0; i < candles.length; i++) {
    if (i === 0) { trs.push(candles[i].high - candles[i].low); continue; }
    trs.push(Math.max(
      candles[i].high - candles[i].low,
      Math.abs(candles[i].high - candles[i - 1].close),
      Math.abs(candles[i].low - candles[i - 1].close),
    ));
  }
  const atr = new Array(candles.length).fill(0);
  if (trs.length < period) return atr;
  let s = 0;
  for (let i = 0; i < period; i++) s += trs[i];
  atr[period - 1] = s / period;
  for (let i = period; i < trs.length; i++) atr[i] = (atr[i - 1] * (period - 1) + trs[i]) / period;
  return atr;
}

function calcADX(candles: OHLCV[], period: number): number {
  if (candles.length < period + 1) return 20;
  let plusDM = 0, minusDM = 0, trSum = 0;
  for (let i = candles.length - period; i < candles.length; i++) {
    const upMove = candles[i].high - candles[i - 1].high;
    const downMove = candles[i - 1].low - candles[i].low;
    if (upMove > downMove && upMove > 0) plusDM += upMove;
    if (downMove > upMove && downMove > 0) minusDM += downMove;
    trSum += Math.max(candles[i].high - candles[i].low,
      Math.abs(candles[i].high - candles[i - 1].close),
      Math.abs(candles[i].low - candles[i - 1].close));
  }
  if (trSum === 0) return 0;
  const plusDI = 100 * plusDM / trSum;
  const minusDI = 100 * minusDM / trSum;
  if (plusDI + minusDI === 0) return 0;
  return 100 * Math.abs(plusDI - minusDI) / (plusDI + minusDI);
}

function calcPivotHighs(candles: OHLCV[], len: number): number[] {
  const ph = new Array(candles.length).fill(NaN);
  for (let i = len; i < candles.length - len; i++) {
    let ok = true;
    for (let j = i - len; j <= i + len; j++) {
      if (j !== i && candles[j].high >= candles[i].high) { ok = false; break; }
    }
    if (ok) ph[i] = candles[i].high;
  }
  return ph;
}

function calcPivotLows(candles: OHLCV[], len: number): number[] {
  const pl = new Array(candles.length).fill(NaN);
  for (let i = len; i < candles.length - len; i++) {
    let ok = true;
    for (let j = i - len; j <= i + len; j++) {
      if (j !== i && candles[j].low <= candles[i].low) { ok = false; break; }
    }
    if (ok) pl[i] = candles[i].low;
  }
  return pl;
}

// ─── Tredzo SMC Scoring ───────────────────────────────────────────────────────

interface TredzoResult {
  signal: 'BUY' | 'SELL' | 'HOLD';
  score: number;
  mandatoryOk: boolean;
  reason: string;
}

function runTredzoScoring(candles: OHLCV[], changePct: number): TredzoResult {
  const HOLD = (reason: string): TredzoResult => ({ signal: 'HOLD', score: 0, mandatoryOk: false, reason });

  if (candles.length < 60) return HOLD('Not enough candle data');

  const closes = candles.map(c => c.close);
  const volumes = candles.map(c => c.volume);

  const atrs = calcATR(candles, 14);
  const currentAtr = atrs[atrs.length - 1] ?? 0;
  const atrMa = calcSMA(atrs.filter(v => v > 0), 50);
  const adx = calcADX(candles, 14);
  const ema200 = calcEMA(closes, Math.min(200, closes.length - 1));
  const volMa = calcSMA(volumes, 20);
  const currentVol = volumes[volumes.length - 1] ?? 0;
  const price = closes[closes.length - 1];

  // Pump/Dump detection (lookback 50)
  const lookbackIdx = Math.max(0, candles.length - 51);
  const lookbackClose = candles[lookbackIdx]?.close ?? price;
  const priceChange = ((price - lookbackClose) / lookbackClose) * 100;
  const isPump = priceChange >= 8.0;
  const isDump = priceChange <= -8.0;

  // Supply/Demand zones from Pivot H/L
  const pivotLen = 6;
  const phs = calcPivotHighs(candles, pivotLen);
  const pls = calcPivotLows(candles, pivotLen);

  let bullZone: { top: number; bot: number } | null = null;
  let bearZone: { top: number; bot: number } | null = null;

  for (let i = candles.length - pivotLen - 1; i >= 0; i--) {
    if (!bearZone && !isNaN(phs[i])) {
      const w = (atrs[i] ?? currentAtr) * 0.35;
      bearZone = { top: phs[i], bot: phs[i] - w };
    }
    if (!bullZone && !isNaN(pls[i])) {
      const w = (atrs[i] ?? currentAtr) * 0.35;
      bullZone = { top: pls[i] + w, bot: pls[i] };
    }
    if (bullZone && bearZone) break;
  }

  const curr = candles[candles.length - 1];
  const body = Math.abs(curr.close - curr.open);
  const safeBody = body === 0 ? 0.00001 : body;
  const upperWick = curr.high - Math.max(curr.open, curr.close);
  const lowerWick = Math.min(curr.open, curr.close) - curr.low;

  // Bull checks
  const bullTouched = bullZone ? (curr.high >= bullZone.bot && curr.low <= bullZone.top) : false;
  const bullSweep   = bullZone ? (curr.low < bullZone.bot && curr.close > bullZone.bot) : false;
  const bullReject  = lowerWick / safeBody >= 1.4;

  // Bear checks
  const bearTouched = bearZone ? (curr.high >= bearZone.bot && curr.low <= bearZone.top) : false;
  const bearSweep   = bearZone ? (curr.high > bearZone.top && curr.close < bearZone.top) : false;
  const bearReject  = upperWick / safeBody >= 1.4;

  // Filters
  const adxOk  = adx > 25;
  const atrOk  = currentAtr > atrMa * 0.9;
  const volOk  = currentVol > volMa * 1.2;
  const bullTrend = price > ema200;
  const bearTrend = price < ema200;

  // No-Trade hard filters
  if (!adxOk || !atrOk) return HOLD(`No-Trade: ADX=${adx.toFixed(1)} ATR=${currentAtr.toFixed(4)}`);

  // === BULL Score ===
  let bullScore = 0;
  if (isDump)       bullScore += 15;
  if (bullTouched)  bullScore += 20;
  if (bullSweep)    bullScore += 20;
  if (bullReject)   bullScore += 15;
  if (volOk)        bullScore += 10;
  if (bullTrend)    bullScore += 10;
  if (adxOk)        bullScore += 5;
  if (atrOk)        bullScore += 5;

  const bullMandatory = bullTouched && bullSweep && bullReject;
  if (bullScore >= 80 && bullMandatory) {
    const parts: string[] = [];
    if (isDump)      parts.push(`Dump ${priceChange.toFixed(1)}%`);
    if (bullSweep)   parts.push('Liq. Sweep');
    if (bullReject)  parts.push('Rejection Wick');
    if (volOk)       parts.push('Vol Spike');
    return { signal: 'BUY', score: bullScore, mandatoryOk: true, reason: parts.join(' · ') };
  }

  // === BEAR Score ===
  let bearScore = 0;
  if (isPump)       bearScore += 15;
  if (bearTouched)  bearScore += 20;
  if (bearSweep)    bearScore += 20;
  if (bearReject)   bearScore += 15;
  if (volOk)        bearScore += 10;
  if (bearTrend)    bearScore += 10;
  if (adxOk)        bearScore += 5;
  if (atrOk)        bearScore += 5;

  const bearMandatory = bearTouched && bearSweep && bearReject;
  if (bearScore >= 80 && bearMandatory) {
    const parts: string[] = [];
    if (isPump)      parts.push(`Pump ${priceChange.toFixed(1)}%`);
    if (bearSweep)   parts.push('Liq. Sweep');
    if (bearReject)  parts.push('Rejection Wick');
    if (volOk)       parts.push('Vol Spike');
    return { signal: 'SELL', score: bearScore, mandatoryOk: true, reason: parts.join(' · ') };
  }

  // Return best partial score for display
  const bestScore = Math.max(bullScore, bearScore);
  const missingBull: string[] = [];
  if (!bullTouched) missingBull.push('Zone');
  if (!bullSweep)   missingBull.push('Sweep');
  if (!bullReject)  missingBull.push('Rejection');
  return HOLD(`Score: ${bestScore}/100 — Missing: ${missingBull.join(', ') || 'threshold'}`);
}

// ─── Fetch klines ─────────────────────────────────────────────────────────────

async function fetchKlines(symbol: string, interval: string): Promise<OHLCV[]> {
  try {
    const url = `${BINANCE_BASE}/api/v3/klines?symbol=${symbol}&interval=${interval}&limit=300`;
    const res = await fetch(url, { signal: AbortSignal.timeout(8_000) });
    if (!res.ok) return [];
    const raw: unknown[][] = await res.json();
    return raw.map(c => ({
      open:   parseFloat(c[1] as string),
      high:   parseFloat(c[2] as string),
      low:    parseFloat(c[3] as string),
      close:  parseFloat(c[4] as string),
      volume: parseFloat(c[5] as string),
    }));
  } catch {
    return [];
  }
}

// ─── Main Handler ─────────────────────────────────────────────────────────────

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

  try {
    const body = await req.json().catch(() => ({}));
    const timeframe: string = body.timeframe ?? '1h';
    const topN: number = body.top_n ?? 15;

    // 1. Fetch all USDT tickers from Binance
    let tickers: BinanceTicker[] = [];
    try {
      const res = await fetch(`${BINANCE_BASE}/api/v3/ticker/24hr`, { signal: AbortSignal.timeout(10_000) });
      if (!res.ok) throw new Error(`Binance HTTP ${res.status}`);
      tickers = await res.json();
    } catch (e) {
      return new Response(
        JSON.stringify({ error: `Binance API unreachable: ${(e as Error).message}` }),
        { status: 502, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // 2. Filter & sort USDT pairs by 24h change
    const usdtPairs = tickers.filter(t =>
      t.symbol.endsWith('USDT') &&
      !t.symbol.includes('UP') &&
      !t.symbol.includes('DOWN') &&
      !t.symbol.includes('BEAR') &&
      !t.symbol.includes('BULL') &&
      parseFloat(t.quoteVolume) > 2_000_000 // >$2M daily volume
    );

    const sorted = [...usdtPairs].sort((a, b) =>
      parseFloat(b.priceChangePercent) - parseFloat(a.priceChangePercent)
    );

    const topGainerTickers = sorted.slice(0, topN);
    const topLoserTickers  = sorted.slice(-topN).reverse();

    const scannedAt = new Date().toISOString();

    // 3. Fetch klines for all coins in parallel (batched)
    const allSymbols = [
      ...topGainerTickers.map(t => ({ ticker: t, type: 'gainer' as const })),
      ...topLoserTickers.map(t => ({ ticker: t, type: 'loser' as const })),
    ];

    const results = await Promise.allSettled(
      allSymbols.map(async ({ ticker, type }, idx) => {
        const price     = parseFloat(ticker.lastPrice);
        const changePct = parseFloat(ticker.priceChangePercent);
        const volume    = parseFloat(ticker.quoteVolume);

        const candles = await fetchKlines(ticker.symbol, timeframe);
        const tredzo  = runTredzoScoring(candles, changePct);

        const item: ScanItem = {
          id: `${type}-${idx}`,
          symbol: ticker.symbol,
          price,
          change_pct_24h: +changePct.toFixed(2),
          volume_24h: +volume.toFixed(0),
          scan_type: type,
          signal_direction: tredzo.signal === 'HOLD' ? null : (tredzo.signal === 'BUY' ? 'buy' : 'sell'),
          confidence: tredzo.score,
          timeframe,
          scanned_at: scannedAt,
          tredzo_score: tredzo.score,
          tredzo_reason: tredzo.reason,
          mandatory_ok: tredzo.mandatoryOk,
        };
        return item;
      })
    );

    const allItems: ScanItem[] = results
      .filter((r): r is PromiseFulfilledResult<ScanItem> => r.status === 'fulfilled')
      .map(r => r.value);

    const gainers = allItems.filter(i => i.scan_type === 'gainer');
    const losers  = allItems.filter(i => i.scan_type === 'loser');

    // Sort by Tredzo score (highest first so signals appear at top)
    gainers.sort((a, b) => b.tredzo_score - a.tredzo_score);
    losers.sort((a, b) => b.tredzo_score - a.tredzo_score);

    const totalSignals = allItems.filter(i => i.signal_direction !== null && i.mandatory_ok).length;

    // 4. Persist to DB (best-effort)
    try {
      const sb = createClient(
        Deno.env.get('SUPABASE_URL') ?? '',
        Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
      );
      await sb.from('market_scans').insert(allItems.map(s => ({
        symbol:          s.symbol,
        price:           s.price,
        change_pct_24h:  s.change_pct_24h,
        volume_24h:      s.volume_24h,
        scan_type:       s.scan_type,
        signal_direction: s.signal_direction,
        confidence:      s.tredzo_score,
        timeframe:       s.timeframe,
        scanned_at:      s.scanned_at,
      })));
    } catch { /* non-fatal */ }

    return new Response(
      JSON.stringify({ gainers, losers, totalSignals, timeframe, source: 'binance_live_tredzo' }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (err) {
    return new Response(
      JSON.stringify({ error: err instanceof Error ? err.message : 'Unknown error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
