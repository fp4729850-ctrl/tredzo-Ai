import { createClient } from 'npm:@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const BINANCE_BASE_REAL         = 'https://api.binance.com';
const BINANCE_BASE_TEST         = 'https://testnet.binance.vision';
const BINANCE_FUTURES_BASE_REAL = 'https://fapi.binance.com';
const BINANCE_FUTURES_BASE_TEST = 'https://testnet.binancefuture.com';
const RECV_WINDOW = '5000';

function resolveOrderUrl(base: string, tradingMode: string): string {
  return tradingMode === 'futures' ? `${base}/fapi/v1/order` : `${base}/api/v3/order`;
}
function resolveKlineUrl(base: string, tradingMode: string): string {
  return tradingMode === 'futures' ? `${base}/fapi/v1/klines` : `${base}/api/v3/klines`;
}

/* ─── Types ─── */
interface StrategyParams {
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
  rsi_filter_short_level?: number;
  symbol: string;
  timeframe: string;
  has_stop_loss: boolean;
  has_take_profit: boolean;
  trade_direction: 'long' | 'short' | 'both';
}

interface OHLCV { open: number; high: number; low: number; close: number; }
interface SignalResult {
  signal: 'BUY' | 'SELL' | 'HOLD';
  reason: string;
  rsi: number;
  ema_fast: number;
  ema_slow: number;
  price: number;
}

function sb() {
  return createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
}

/* ─── Binance helpers ─── */
async function hmacSha256(secret: string, msg: string): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(msg));
  return Array.from(new Uint8Array(sig)).map(b => b.toString(16).padStart(2, '0')).join('');
}

async function signedPost(base: string, path: string, apiKey: string, secret: string, params: Record<string, string>) {
  const ts = Date.now().toString();
  const all = { ...params, recvWindow: RECV_WINDOW, timestamp: ts };
  const qs = new URLSearchParams(all).toString();
  const sig = await hmacSha256(secret, qs);
  const res = await fetch(`${base}${path}?${qs}&signature=${sig}`, {
    method: 'POST',
    headers: { 'X-MBX-APIKEY': apiKey, 'Content-Type': 'application/json' },
  });
  const json = await res.json();
  if (!res.ok) throw new Error(json.msg || `HTTP ${res.status}`);
  return json;
}

async function fetchKlines(base: string, symbol: string, interval: string, limit: number, tradingMode = 'spot'): Promise<OHLCV[]> {
  const url = `${resolveKlineUrl(base, tradingMode)}?symbol=${symbol.toUpperCase()}&interval=${interval}&limit=${limit}`;
  const res = await fetch(url, { signal: AbortSignal.timeout(10_000) });
  if (!res.ok) throw new Error(`Klines fetch failed: ${res.status}`);
  const raw: unknown[][] = await res.json();
  return raw.map(c => ({
    open:  parseFloat(c[1] as string),
    high:  parseFloat(c[2] as string),
    low:   parseFloat(c[3] as string),
    close: parseFloat(c[4] as string),
  }));
}

/* ─── Technical Indicators ─── */
function calcRSI(closes: number[], period: number): number {
  if (closes.length < period + 1) return 50;
  let gains = 0, losses = 0;
  for (let i = closes.length - period; i < closes.length; i++) {
    const diff = closes[i] - closes[i - 1];
    if (diff > 0) gains += diff; else losses -= diff;
  }
  const avgGain = gains / period, avgLoss = losses / period;
  if (avgLoss === 0) return 100;
  return +(100 - 100 / (1 + avgGain / avgLoss)).toFixed(2);
}

function calcEMA(closes: number[], period: number): number {
  if (closes.length < period) return closes[closes.length - 1];
  const k = 2 / (period + 1);
  let ema = closes.slice(0, period).reduce((s, v) => s + v, 0) / period;
  for (let i = period; i < closes.length; i++) ema = closes[i] * k + ema * (1 - k);
  return +ema.toFixed(6);
}

/** Supertrend — returns array of {direction: 1=bearish/-1=bullish} for each bar */
function calcSupertrend(candles: OHLCV[], period: number, multiplier: number): { dir: number; upper: number; lower: number }[] {
  const n = candles.length;
  const result: { dir: number; upper: number; lower: number }[] = new Array(n).fill({ dir: 0, upper: 0, lower: 0 });
  if (n < period + 1) return result;

  // ATR
  const tr: number[] = [0];
  for (let i = 1; i < n; i++) {
    tr.push(Math.max(
      candles[i].high - candles[i].low,
      Math.abs(candles[i].high - candles[i - 1].close),
      Math.abs(candles[i].low  - candles[i - 1].close)
    ));
  }
  // Wilder ATR (RMA)
  const atr: number[] = new Array(n).fill(0);
  let atrSum = 0;
  for (let i = 1; i <= period; i++) atrSum += tr[i];
  atr[period] = atrSum / period;
  for (let i = period + 1; i < n; i++) atr[i] = (atr[i - 1] * (period - 1) + tr[i]) / period;

  let prevUpper = 0, prevLower = 0, prevDir = 1;

  for (let i = period; i < n; i++) {
    const hl2 = (candles[i].high + candles[i].low) / 2;
    let upper = hl2 + multiplier * atr[i];
    let lower = hl2 - multiplier * atr[i];

    // Carry-forward bands (PineScript logic)
    if (prevLower > 0 && prevUpper > 0) {
      lower = lower > prevLower || candles[i - 1].close < prevLower ? lower : prevLower;
      upper = upper < prevUpper || candles[i - 1].close > prevUpper ? upper : prevUpper;
    }

    let dir: number;
    if (i === period) {
      dir = 1; // start bearish
    } else if (prevDir === -1) {
      dir = candles[i].close < lower ? 1 : -1;  // was bullish: flip to bearish if close < lower
    } else {
      dir = candles[i].close > upper ? -1 : 1;  // was bearish: flip to bullish if close > upper
    }

    result[i] = { dir, upper, lower };
    prevUpper = upper; prevLower = lower; prevDir = dir;
  }
  return result;
}

/* ─── Signal Evaluation (strategy-type aware) ─── */
function evaluateSignal(candles: OHLCV[], params: StrategyParams): SignalResult {
  const closes = candles.map(c => c.close);
  const price = closes[closes.length - 1];
  const rsi = calcRSI(closes, params.rsi_length);
  const emaF = calcEMA(closes, params.ema_fast);
  const emaS = calcEMA(closes, params.ema_slow);
  const canLong  = params.trade_direction === 'long'  || params.trade_direction === 'both';
  const canShort = params.trade_direction === 'short' || params.trade_direction === 'both';

  const type = params.strategy_type ?? 'rsi_ema';

  // ── Supertrend signal ──
  if (type === 'supertrend' || type === 'mixed') {
    const stMult = params.st_multiplier ?? 2.0;
    const stLen  = params.st_lookback  ?? 10;
    const needBars = stLen + 3;
    const slice = candles.slice(-Math.max(needBars, 30));
    const st = calcSupertrend(slice, stLen, stMult);
    const last = st[st.length - 1];
    const prev = st[st.length - 2];

    if (!last || !prev || last.dir === 0 || prev.dir === 0) {
      return { signal: 'HOLD', reason: `Supertrend initializing | RSI=${rsi}`, rsi, ema_fast: emaF, ema_slow: emaS, price };
    }

    // Direction change: bearish(1) → bullish(-1) = BUY signal
    const stBuy  = prev.dir === 1  && last.dir === -1;
    // Direction change: bullish(-1) → bearish(1) = SELL signal
    const stSell = prev.dir === -1 && last.dir === 1;

    // RSI filter (optional)
    const rsiFilterOk = !params.rsi_filter_enabled || rsi > (params.rsi_filter_long_level ?? 50);

    if (canLong && stBuy && rsiFilterOk) {
      return {
        signal: 'BUY',
        reason: `Supertrend turned BULLISH (mult=${stMult}, len=${stLen})${params.rsi_filter_enabled ? ` | RSI=${rsi}>${params.rsi_filter_long_level}` : ''}`,
        rsi, ema_fast: emaF, ema_slow: emaS, price,
      };
    }
    if (canShort && stSell) {
      return {
        signal: 'SELL',
        reason: `Supertrend turned BEARISH (mult=${stMult}, len=${stLen}) | RSI=${rsi}`,
        rsi, ema_fast: emaF, ema_slow: emaS, price,
      };
    }
    // mixed: also check RSI+EMA crossover
    if (type === 'mixed') {
      const prevRsi  = calcRSI(closes.slice(0, -1), params.rsi_length);
      const bullCross = prevRsi <= params.oversold  && rsi > params.oversold;
      const bearCross = prevRsi >= params.overbought && rsi < params.overbought;
      if (canLong  && bullCross && emaF > emaS)
        return { signal: 'BUY',  reason: `RSI crossover above oversold (${params.oversold}) + EMA uptrend`, rsi, ema_fast: emaF, ema_slow: emaS, price };
      if (canShort && bearCross && emaF < emaS)
        return { signal: 'SELL', reason: `RSI crossunder below overbought (${params.overbought}) + EMA downtrend`, rsi, ema_fast: emaF, ema_slow: emaS, price };
    }
    return { signal: 'HOLD', reason: `Supertrend dir=${last.dir === -1 ? 'BULLISH' : 'BEARISH'} (no cross) | RSI=${rsi}`, rsi, ema_fast: emaF, ema_slow: emaS, price };
  }

  // ── RSI + EMA crossover signal (default) ──
  const prevRsi  = calcRSI(closes.slice(0, -1), params.rsi_length);
  const bullCross = prevRsi <= params.oversold  && rsi > params.oversold;
  const bearCross = prevRsi >= params.overbought && rsi < params.overbought;

  if (canLong  && bullCross && emaF > emaS)
    return { signal: 'BUY',  reason: `RSI crossed above oversold (${params.oversold}) with EMA${params.ema_fast}>${params.ema_slow}`, rsi, ema_fast: emaF, ema_slow: emaS, price };
  if (canShort && bearCross && emaF < emaS)
    return { signal: 'SELL', reason: `RSI crossed below overbought (${params.overbought}) with EMA${params.ema_fast}<${params.ema_slow}`, rsi, ema_fast: emaF, ema_slow: emaS, price };

  return { signal: 'HOLD', reason: `RSI=${rsi} | EMA${params.ema_fast}=${emaF.toFixed(2)} | no entry condition`, rsi, ema_fast: emaF, ema_slow: emaS, price };
}

/* ─── Quantity helpers ─── */
function calcQuantityFromUsdt(price: number, amountUsdt: number): number {
  const qty = amountUsdt / price;
  if (price > 1000) return +qty.toFixed(5);
  if (price > 1) return +qty.toFixed(3);
  return +qty.toFixed(1);
}
function calcQuantity(price: number, positionPct: number): number {
  const qty = (1000 * positionPct / 100) / price;
  if (price > 1000) return +qty.toFixed(5);
  if (price > 1) return +qty.toFixed(3);
  return +qty.toFixed(1);
}

const TF_INTERVAL: Record<string, string> = {
  '1m': '1m', '5m': '5m', '15m': '15m', '30m': '30m',
  '1h': '1h', '4h': '4h', '1d': '1d',
};

/* ─── Main handler ─── */
Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  const token = (req.headers.get('authorization') || '').replace('Bearer ', '');
  if (!token) return json({ error: 'Missing authorization' }, 401);

  let userId = '';
  try { userId = JSON.parse(atob(token.split('.')[1])).sub; }
  catch { return json({ error: 'Invalid token' }, 401); }

  let body: { strategyId: string };
  try { body = await req.json(); } catch { return json({ error: 'Invalid JSON' }, 400); }
  if (!body.strategyId) return json({ error: 'strategyId is required' }, 400);

  const client = sb();

  /* 1. Load strategy */
  const { data: strategy, error: stratErr } = await client
    .from('strategies').select('*').eq('id', body.strategyId).eq('user_id', userId).maybeSingle();
  if (stratErr || !strategy) return json({ error: 'Strategy not found' }, 404);

  const params = strategy.strategy_params as StrategyParams | null;
  if (!params) return json({ error: 'Strategy not analyzed yet. Click "AI Analyze" first.' }, 400);

  /* 2. Load user settings */
  const { data: settings } = await client
    .from('user_settings')
    .select('binance_api_key, binance_api_secret, use_testnet, trading_mode, bot_enabled, position_size_pct, stop_loss_pct, take_profit_pct, min_confidence')
    .eq('user_id', userId).maybeSingle();
  if (!settings?.binance_api_key || !settings?.binance_api_secret)
    return json({ error: 'Binance API keys not configured in Settings.' }, 400);

  const useTestnet: boolean = settings.use_testnet ?? true;
  const tradingMode: string = settings.trading_mode ?? 'spot';
  const base = tradingMode === 'futures'
    ? (useTestnet ? BINANCE_FUTURES_BASE_TEST : BINANCE_FUTURES_BASE_REAL)
    : (useTestnet ? BINANCE_BASE_TEST : BINANCE_BASE_REAL);

  const tradeAmountUsdt: number | null = strategy.trade_amount_usdt ?? null;
  const effectiveSL: number = strategy.stop_loss_pct ?? settings.stop_loss_pct ?? 2;
  const effectiveTP: number = strategy.tp1_pct ?? strategy.take_profit_pct ?? settings.take_profit_pct ?? 4;
  const effectiveSize: number = strategy.position_size_pct ?? settings.position_size_pct ?? 5;
  const tp1: number | null = strategy.tp1_pct ?? null;
  const tp2: number | null = strategy.tp2_pct ?? null;
  const tp3: number | null = strategy.tp3_pct ?? null;
  const tp1Size: number = strategy.tp1_size_pct ?? 33;
  const tp2Size: number = strategy.tp2_size_pct ?? 33;
  const tp3Size: number = strategy.tp3_size_pct ?? 34;

  /* 3. Fetch klines — more bars for Supertrend warmup */
  const effectiveTF = strategy.timeframe ?? params.timeframe ?? '1h';
  const interval = TF_INTERVAL[effectiveTF] ?? '1h';
  const stLen = params.st_lookback ?? 10;
  const klineLimit = Math.max(params.rsi_length + 10, params.ema_slow + 10, stLen * 3 + 10, 60);
  let candles: OHLCV[];
  try {
    candles = await fetchKlines(base, params.symbol, interval, klineLimit, tradingMode);
  } catch (e: unknown) {
    return json({ error: `Binance klines error: ${(e as Error).message}` }, 502);
  }

  /* 4. Evaluate signal */
  const result = evaluateSignal(candles, params);

  if (result.signal === 'HOLD')
    return json({ signal: 'HOLD', ...result, mode: useTestnet ? 'testnet' : 'real', symbol: params.symbol });

  /* 5. Place order */
  const side = result.signal;
  const qty = tradeAmountUsdt != null
    ? calcQuantityFromUsdt(result.price, tradeAmountUsdt)
    : calcQuantity(result.price, effectiveSize);

  let order: Record<string, unknown> | null = null;
  let orderError: string | null = null;
  try {
    const orderPath = resolveOrderUrl(base, tradingMode).replace(base, '');
    const orderParams: Record<string, string> = {
      symbol: params.symbol.toUpperCase(), side, type: 'MARKET', quantity: String(qty),
    };
    if (tradingMode === 'futures') orderParams.positionSide = 'BOTH';
    order = await signedPost(base, orderPath, settings.binance_api_key, settings.binance_api_secret, orderParams);
  } catch (e: unknown) { orderError = (e as Error).message; }

  /* 6. Log trade */
  const now = new Date().toISOString();
  if (order) {
    const tpLevels = [tp1, tp2, tp3].filter(Boolean);
    const multiTpNote = tpLevels.length > 1 ? ` | TP: ${tpLevels.map((t, i) => `TP${i+1}=${t}%`).join(', ')}` : '';
    await client.from('trades').insert({
      user_id: userId, signal_id: null, symbol: params.symbol,
      direction: side === 'BUY' ? 'buy' : 'sell',
      entry_price: result.price, quantity: qty,
      stop_loss: result.price * (1 - effectiveSL / 100),
      take_profit: result.price * (1 + effectiveTP / 100),
      status: 'open', binance_order_id: String(order.orderId ?? ''), opened_at: now,
    });
    await client.from('signals').insert({
      user_id: userId, strategy_id: body.strategyId, symbol: params.symbol,
      direction: side === 'BUY' ? 'buy' : 'sell', confidence: 85,
      entry_price: result.price,
      stop_loss: result.price * (1 - effectiveSL / 100),
      take_profit: result.price * (1 + effectiveTP / 100),
      timeframe: effectiveTF, reason: result.reason + multiTpNote, status: 'executed',
    });
  }

  await client.from('strategies').update({ last_executed_at: now, last_signal: result.signal }).eq('id', body.strategyId);

  /* 7. Notification */
  fetch(`${Deno.env.get('SUPABASE_URL')}/functions/v1/send-notification`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')}` },
    body: JSON.stringify({
      userId, signal: result.signal, symbol: params.symbol, price: result.price,
      reason: result.reason, timeframe: effectiveTF, strategyName: strategy.name ?? 'Strategy',
      sl: order ? result.price * (1 - effectiveSL / 100) : null,
      tp1: tp1 ? result.price * (1 + tp1 / 100) : null,
      tp2: tp2 ? result.price * (1 + tp2 / 100) : null,
      tp3: tp3 ? result.price * (1 + tp3 / 100) : null,
      mode: useTestnet ? 'testnet' : 'real',
    }),
  }).catch(() => {});

  return json({
    signal: result.signal, reason: result.reason, rsi: result.rsi,
    ema_fast: result.ema_fast, ema_slow: result.ema_slow,
    price: result.price, quantity: qty, symbol: params.symbol,
    sl: result.price * (1 - effectiveSL / 100),
    tp1: tp1 ? result.price * (1 + tp1 / 100) : result.price * (1 + effectiveTP / 100),
    tp2: tp2 ? result.price * (1 + tp2 / 100) : null,
    tp3: tp3 ? result.price * (1 + tp3 / 100) : null,
    tp1Size, tp2Size, tp3Size,
    mode: useTestnet ? 'testnet' : 'real', order: order ?? null, orderError,
  });
});

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
}

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const BINANCE_BASE_REAL         = 'https://api.binance.com';
const BINANCE_BASE_TEST         = 'https://testnet.binance.vision';
const BINANCE_FUTURES_BASE_REAL = 'https://fapi.binance.com';
const BINANCE_FUTURES_BASE_TEST = 'https://testnet.binancefuture.com';
const RECV_WINDOW = '5000';

function resolveOrderUrl(base: string, tradingMode: string): string {
  return tradingMode === 'futures' ? `${base}/fapi/v1/order` : `${base}/api/v3/order`;
}

function resolveKlineUrl(base: string, tradingMode: string): string {
  return tradingMode === 'futures' ? `${base}/fapi/v1/klines` : `${base}/api/v3/klines`;
}

/* ─── Types ─── */
interface StrategyParams {
  rsi_length: number;
  overbought: number;
  oversold: number;
  ema_fast: number;
  ema_slow: number;
  symbol: string;
  timeframe: string;
  has_stop_loss: boolean;
  has_take_profit: boolean;
  trade_direction: 'long' | 'short' | 'both';
}

interface OHLCV {
  close: number;
  high: number;
  low: number;
}

interface SignalResult {
  signal: 'BUY' | 'SELL' | 'HOLD';
  reason: string;
  rsi: number;
  ema_fast: number;
  ema_slow: number;
  price: number;
}

/* ─── Supabase service client ─── */
function sb() {
  return createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  );
}

/* ─── Binance helpers ─── */
async function hmacSha256(secret: string, msg: string): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(msg));
  return Array.from(new Uint8Array(sig)).map(b => b.toString(16).padStart(2, '0')).join('');
}

async function signedPost(base: string, path: string, apiKey: string, secret: string, params: Record<string, string>) {
  const ts = Date.now().toString();
  const all = { ...params, recvWindow: RECV_WINDOW, timestamp: ts };
  const qs = new URLSearchParams(all).toString();
  const sig = await hmacSha256(secret, qs);
  const res = await fetch(`${base}${path}?${qs}&signature=${sig}`, {
    method: 'POST',
    headers: { 'X-MBX-APIKEY': apiKey, 'Content-Type': 'application/json' },
  });
  const json = await res.json();
  if (!res.ok) throw new Error(json.msg || `HTTP ${res.status}`);
  return json;
}

async function fetchKlines(base: string, symbol: string, interval: string, limit: number, tradingMode = 'spot'): Promise<OHLCV[]> {
  const klinesPath = resolveKlineUrl(base, tradingMode);
  const url = `${klinesPath}?symbol=${symbol.toUpperCase()}&interval=${interval}&limit=${limit}`;
  const res = await fetch(url, { signal: AbortSignal.timeout(10_000) });
  if (!res.ok) throw new Error(`Klines fetch failed: ${res.status}`);
  const raw: unknown[][] = await res.json();
  return raw.map(c => ({
    close: parseFloat(c[4] as string),
    high: parseFloat(c[2] as string),
    low: parseFloat(c[3] as string),
  }));
}

/* ─── Technical Indicators ─── */
function calcRSI(closes: number[], period: number): number {
  if (closes.length < period + 1) return 50;
  let gains = 0, losses = 0;
  for (let i = closes.length - period; i < closes.length; i++) {
    const diff = closes[i] - closes[i - 1];
    if (diff > 0) gains += diff; else losses -= diff;
  }
  const avgGain = gains / period;
  const avgLoss = losses / period;
  if (avgLoss === 0) return 100;
  const rs = avgGain / avgLoss;
  return +(100 - 100 / (1 + rs)).toFixed(2);
}

function calcEMA(closes: number[], period: number): number {
  if (closes.length < period) return closes[closes.length - 1];
  const k = 2 / (period + 1);
  let ema = closes.slice(0, period).reduce((s, v) => s + v, 0) / period;
  for (let i = period; i < closes.length; i++) {
    ema = closes[i] * k + ema * (1 - k);
  }
  return +ema.toFixed(6);
}

/* ─── Signal evaluation ─── */
function evaluateSignal(closes: number[], params: StrategyParams): SignalResult {
  const rsi = calcRSI(closes, params.rsi_length);
  const emaF = calcEMA(closes, params.ema_fast);
  const emaS = calcEMA(closes, params.ema_slow);
  const price = closes[closes.length - 1];

  const prevRsi = calcRSI(closes.slice(0, -1), params.rsi_length);
  const bullishCross = prevRsi <= params.oversold && rsi > params.oversold;
  const bearishCross = prevRsi >= params.overbought && rsi < params.overbought;
  const uptrend = emaF > emaS;
  const downtrend = emaF < emaS;

  const canLong = params.trade_direction === 'long' || params.trade_direction === 'both';
  const canShort = params.trade_direction === 'short' || params.trade_direction === 'both';

  if (canLong && bullishCross && uptrend) {
    return { signal: 'BUY', reason: `RSI crossed above oversold (${params.oversold}) with EMA${params.ema_fast} > EMA${params.ema_slow} uptrend confirmed`, rsi, ema_fast: emaF, ema_slow: emaS, price };
  }
  if (canShort && bearishCross && downtrend) {
    return { signal: 'SELL', reason: `RSI crossed below overbought (${params.overbought}) with EMA${params.ema_fast} < EMA${params.ema_slow} downtrend confirmed`, rsi, ema_fast: emaF, ema_slow: emaS, price };
  }

  return {
    signal: 'HOLD',
    reason: `RSI=${rsi} | EMA${params.ema_fast}=${emaF.toFixed(2)} | EMA${params.ema_slow}=${emaS.toFixed(2)} — no entry condition met`,
    rsi, ema_fast: emaF, ema_slow: emaS, price,
  };
}

/* ─── Quantity helpers ─── */
// Fixed USDT amount → quantity
function calcQuantityFromUsdt(price: number, amountUsdt: number, _symbol: string): number {
  const qty = amountUsdt / price;
  if (price > 1000) return +qty.toFixed(5);
  if (price > 1) return +qty.toFixed(3);
  return +qty.toFixed(1);
}
// Position size % of assumed $1000 base → quantity
function calcQuantity(price: number, positionPct: number, _symbol: string): number {
  const budget = 1000 * (positionPct / 100); // assume $1000 base (real: fetch account balance)
  const qty = budget / price;
  if (price > 1000) return +qty.toFixed(5);
  if (price > 1) return +qty.toFixed(3);
  return +qty.toFixed(1);
}

const TF_INTERVAL: Record<string, string> = {
  '1m': '1m', '5m': '5m', '15m': '15m', '30m': '30m',
  '1h': '1h', '4h': '4h', '1d': '1d',
};

/* ─── Main handler ─── */
Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  const authHeader = req.headers.get('authorization') || '';
  const token = authHeader.replace('Bearer ', '');
  if (!token) return json({ error: 'Missing authorization' }, 401);

  let userId = '';
  try {
    const payload = JSON.parse(atob(token.split('.')[1]));
    userId = payload.sub;
  } catch {
    return json({ error: 'Invalid token' }, 401);
  }

  let body: { strategyId: string };
  try { body = await req.json(); } catch { return json({ error: 'Invalid JSON' }, 400); }
  if (!body.strategyId) return json({ error: 'strategyId is required' }, 400);

  const client = sb();

  /* 1. Load strategy */
  const { data: strategy, error: stratErr } = await client
    .from('strategies')
    .select('*')
    .eq('id', body.strategyId)
    .eq('user_id', userId)
    .maybeSingle();

  if (stratErr || !strategy) return json({ error: 'Strategy not found' }, 404);

  const params = strategy.strategy_params as StrategyParams | null;
  if (!params) return json({ error: 'Strategy not analyzed yet. Click "AI Analyze" first.' }, 400);

  /* 2. Load user settings (API keys + risk params + testnet flag) */
  const { data: settings } = await client
    .from('user_settings')
    .select('binance_api_key, binance_api_secret, use_testnet, trading_mode, bot_enabled, position_size_pct, stop_loss_pct, take_profit_pct, min_confidence')
    .eq('user_id', userId)
    .maybeSingle();

  if (!settings?.binance_api_key || !settings?.binance_api_secret) {
    return json({ error: 'Binance API keys not configured in Settings.' }, 400);
  }

  const useTestnet: boolean = settings.use_testnet ?? true;
  const tradingMode: string = settings.trading_mode ?? 'spot';
  const base = tradingMode === 'futures'
    ? (useTestnet ? BINANCE_FUTURES_BASE_TEST : BINANCE_FUTURES_BASE_REAL)
    : (useTestnet ? BINANCE_BASE_TEST : BINANCE_BASE_REAL);

  // Priority: per-strategy fixed USDT > per-strategy % > global user_settings fallback
  const tradeAmountUsdt: number | null = strategy.trade_amount_usdt ?? null;
  const effectiveSL: number = (strategy.stop_loss_pct ?? settings.stop_loss_pct ?? 2);
  const effectiveTP: number = (strategy.tp1_pct ?? strategy.take_profit_pct ?? settings.take_profit_pct ?? 4);
  const effectiveSize: number = (strategy.position_size_pct ?? settings.position_size_pct ?? 5);
  // Multi-TP levels (null = not configured)
  const tp1: number | null = strategy.tp1_pct ?? null;
  const tp2: number | null = strategy.tp2_pct ?? null;
  const tp3: number | null = strategy.tp3_pct ?? null;
  const tp1Size: number = strategy.tp1_size_pct ?? 33;
  const tp2Size: number = strategy.tp2_size_pct ?? 33;
  const tp3Size: number = strategy.tp3_size_pct ?? 34;

  /* 3. Fetch live klines — strategy.timeframe top-level takes priority over strategy_params.timeframe */
  const effectiveTF: string = (strategy.timeframe ?? params.timeframe ?? '1h');
  const interval = TF_INTERVAL[effectiveTF] ?? '1h';
  const klineLimit = Math.max(params.rsi_length + 10, params.ema_slow + 10, 60);
  let candles: OHLCV[];
  try {
    candles = await fetchKlines(base, params.symbol, interval, klineLimit, tradingMode);
  } catch (e: unknown) {
    return json({ error: `Binance klines error: ${(e as Error).message}` }, 502);
  }

  const closes = candles.map(c => c.close);

  /* 4. Evaluate signal */
  const result = evaluateSignal(closes, params);

  if (result.signal === 'HOLD') {
    return json({ signal: 'HOLD', ...result, mode: useTestnet ? 'testnet' : 'real', symbol: params.symbol });
  }

  /* 5. Place order */
  const side = result.signal; // 'BUY' | 'SELL'
  // Use fixed USDT amount if set, otherwise fall back to position size %
  const qty = tradeAmountUsdt != null
    ? calcQuantityFromUsdt(result.price, tradeAmountUsdt, params.symbol)
    : calcQuantity(result.price, effectiveSize, params.symbol);

  let order: Record<string, unknown> | null = null;
  let orderError: string | null = null;
  try {
    const orderPath = resolveOrderUrl(base, tradingMode);
    const orderParams: Record<string, string> = {
      symbol: params.symbol.toUpperCase(),
      side,
      type: 'MARKET',
      quantity: String(qty),
    };
    // Futures one-way mode requires positionSide=BOTH
    if (tradingMode === 'futures') orderParams.positionSide = 'BOTH';
    order = await signedPost(base, orderPath.replace(base, ''), settings.binance_api_key, settings.binance_api_secret, orderParams);
  } catch (e: unknown) {
    orderError = (e as Error).message;
  }

  /* 6. Log trade to DB */
  const now = new Date().toISOString();
  if (order) {
    // Use TP1 as primary take_profit for DB record; log multi-TP as metadata in reason
    const tpLevels = [tp1, tp2, tp3].filter(Boolean);
    const multiTpNote = tpLevels.length > 1
      ? ` | TP levels: ${tpLevels.map((t, i) => `TP${i+1}=${t}%`).join(', ')}`
      : '';
    await client.from('trades').insert({
      user_id: userId,
      signal_id: null,
      symbol: params.symbol,
      direction: side === 'BUY' ? 'buy' : 'sell',
      entry_price: result.price,
      quantity: qty,
      stop_loss: result.price * (1 - effectiveSL / 100),
      take_profit: result.price * (1 + effectiveTP / 100),
      status: 'open',
      binance_order_id: String(order.orderId ?? ''),
      opened_at: now,
    });

    /* 7. Log signal */
    await client.from('signals').insert({
      user_id: userId,
      strategy_id: body.strategyId,
      symbol: params.symbol,
      direction: side === 'BUY' ? 'buy' : 'sell',
      confidence: 85,
      entry_price: result.price,
      stop_loss: result.price * (1 - effectiveSL / 100),
      take_profit: result.price * (1 + effectiveTP / 100),
      timeframe: effectiveTF,
      reason: result.reason + multiTpNote,
      status: 'executed',
    });
  }

  /* 8. Always update last_executed_at + last_signal on strategy */
  await client.from('strategies').update({
    last_executed_at: now,
    last_signal: result.signal,
  }).eq('id', body.strategyId);

  /* 9. Send notification (non-blocking) */
  const stratName = strategy.name ?? 'Strategy';
  fetch(`${Deno.env.get('SUPABASE_URL')}/functions/v1/send-notification`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')}`,
    },
    body: JSON.stringify({
      userId,
      signal: result.signal,
      symbol: params.symbol,
      price: result.price,
      reason: result.reason,
      timeframe: effectiveTF,
      strategyName: stratName,
      sl: order ? result.price * (1 - effectiveSL / 100) : null,
      tp1: tp1 ? result.price * (1 + tp1 / 100) : null,
      tp2: tp2 ? result.price * (1 + tp2 / 100) : null,
      tp3: tp3 ? result.price * (1 + tp3 / 100) : null,
      mode: useTestnet ? 'testnet' : 'real',
    }),
  }).catch(() => {}); // fire-and-forget

  return json({
    signal: result.signal,
    reason: result.reason,
    rsi: result.rsi,
    ema_fast: result.ema_fast,
    ema_slow: result.ema_slow,
    price: result.price,
    quantity: qty,
    symbol: params.symbol,
    sl: result.price * (1 - effectiveSL / 100),
    tp1: tp1 ? result.price * (1 + tp1 / 100) : result.price * (1 + effectiveTP / 100),
    tp2: tp2 ? result.price * (1 + tp2 / 100) : null,
    tp3: tp3 ? result.price * (1 + tp3 / 100) : null,
    tp1Size, tp2Size, tp3Size,
    mode: useTestnet ? 'testnet' : 'real',
    order: order ?? null,
    orderError,
  });
});

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}
