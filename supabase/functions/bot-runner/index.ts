import { createClient } from 'npm:@supabase/supabase-js@2';

/** Bot Runner — called every minute by pg_cron.
 *  Finds all active strategies whose timeframe interval has elapsed since last_executed_at
 *  and runs the strategy logic (same as execute-strategy) for each.
 */

const BINANCE_BASE_REAL = 'https://api.binance.com';
const BINANCE_BASE_TEST = 'https://testnet.binance.vision';
const RECV_WINDOW = '5000';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface CustomInput {
  name: string;
  type: 'int' | 'float' | 'bool' | 'string';
  defval: number | string | boolean;
  value?: number | string | boolean;
}

interface StrategyParams {
  rsi_length: number; overbought: number; oversold: number;
  ema_fast: number; ema_slow: number;
  symbol: string; timeframe: string;
  trade_direction: 'long' | 'short' | 'both';
  strategy_type?: 'rsi_ema' | 'supertrend' | 'smc' | 'mixed' | 'custom';
  st_multiplier?: number;
  st_lookback?: number;
  rsi_filter_enabled?: boolean;
  rsi_filter_long_level?: number;
  rsi_filter_short_level?: number;
  custom_inputs?: CustomInput[];
}
interface OHLCV { open: number; close: number; high: number; low: number; }
interface SignalResult { signal: 'BUY'|'SELL'|'HOLD'; reason: string; rsi: number; ema_fast: number; ema_slow: number; price: number; }

/** Timeframe → milliseconds */
const TF_MS: Record<string, number> = {
  '1m': 60_000, '5m': 300_000, '15m': 900_000, '30m': 1_800_000,
  '1h': 3_600_000, '4h': 14_400_000, '1d': 86_400_000,
};
const TF_INTERVAL: Record<string, string> = {
  '1m':'1m','5m':'5m','15m':'15m','30m':'30m','1h':'1h','4h':'4h','1d':'1d',
};

function sb() {
  return createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
}

async function hmacSha256(secret: string, msg: string): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name:'HMAC', hash:'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(msg));
  return Array.from(new Uint8Array(sig)).map(b => b.toString(16).padStart(2,'0')).join('');
}

async function signedPost(base: string, path: string, apiKey: string, secret: string, params: Record<string,string>) {
  const ts = Date.now().toString();
  const all = { ...params, recvWindow: RECV_WINDOW, timestamp: ts };
  const qs = new URLSearchParams(all).toString();
  const sig = await hmacSha256(secret, qs);
  const res = await fetch(`${base}${path}?${qs}&signature=${sig}`, {
    method: 'POST',
    headers: { 'X-MBX-APIKEY': apiKey, 'Content-Type': 'application/json' },
  });
  const j = await res.json();
  if (!res.ok) throw new Error(j.msg || `HTTP ${res.status}`);
  return j;
}

async function fetchKlines(base: string, symbol: string, interval: string, limit: number): Promise<OHLCV[]> {
  const url = `${base}/api/v3/klines?symbol=${symbol.toUpperCase()}&interval=${interval}&limit=${limit}`;
  const res = await fetch(url, { signal: AbortSignal.timeout(10_000) });
  if (!res.ok) throw new Error(`Klines fetch failed: ${res.status}`);
  const raw: unknown[][] = await res.json();
  return raw.map(c => ({ open: parseFloat(c[1] as string), high: parseFloat(c[2] as string), low: parseFloat(c[3] as string), close: parseFloat(c[4] as string) }));
}

function calcRSI(closes: number[], period: number): number {
  if (closes.length < period + 1) return 50;
  let gains = 0, losses = 0;
  for (let i = closes.length - period; i < closes.length; i++) {
    const diff = closes[i] - closes[i-1];
    if (diff > 0) gains += diff; else losses -= diff;
  }
  const avg = losses === 0 ? 100 : 100 - 100 / (1 + gains / losses);
  return +avg.toFixed(2);
}

function calcEMA(closes: number[], period: number): number {
  if (closes.length < period) return closes[closes.length - 1];
  const k = 2 / (period + 1);
  let ema = closes.slice(0, period).reduce((s,v) => s + v, 0) / period;
  for (let i = period; i < closes.length; i++) ema = closes[i] * k + ema * (1 - k);
  return +ema.toFixed(6);
}

// ── Apply user-edited custom_inputs onto strategy params ──
function applyCustomInputOverrides(p: StrategyParams): StrategyParams {
  if (!p.custom_inputs || p.custom_inputs.length === 0) return p;

  // Name → field mapping (case-insensitive, fuzzy)
  const mapping: Record<string, (v: number) => void> = {};
  const set = (keys: string[], fn: (v: number) => void) => keys.forEach(k => mapping[k] = fn);

  set(['rsi length', 'rsi_length', 'rsi period', 'rsilength'], v => { p.rsi_length = v; });
  set(['overbought', 'rsi overbought', 'ob'], v => { p.overbought = v; });
  set(['oversold', 'rsi oversold', 'os'], v => { p.oversold = v; });
  set(['ema fast', 'ema_fast', 'fast ema', 'fast period', 'ema fast period', 'fast length', 'short ema'], v => { p.ema_fast = v; });
  set(['ema slow', 'ema_slow', 'slow ema', 'slow period', 'ema slow period', 'slow length', 'long ema'], v => { p.ema_slow = v; });
  set(['supertrend multiplier', 'st multiplier', 'st_multiplier', 'multiplier', 'atr multiplier', 'factor'], v => { p.st_multiplier = v; });
  set(['supertrend lookback', 'st lookback', 'st_lookback', 'atr length', 'atr period', 'supertrend length'], v => { p.st_lookback = v; });

  for (const input of p.custom_inputs) {
    const val = input.value ?? input.defval;
    if (typeof val !== 'number') continue;
    const nameKey = input.name.toLowerCase().trim();
    if (mapping[nameKey]) {
      mapping[nameKey](val);
    }
  }
  return p;
}

// ── ATR calculation (needed for Supertrend) ──
function calcATR(candles: OHLCV[], period: number): number[] {
  const trs: number[] = [];
  for (let i = 0; i < candles.length; i++) {
    if (i === 0) {
      trs.push(candles[i].high - candles[i].low);
    } else {
      const tr = Math.max(
        candles[i].high - candles[i].low,
        Math.abs(candles[i].high - candles[i - 1].close),
        Math.abs(candles[i].low - candles[i - 1].close)
      );
      trs.push(tr);
    }
  }
  // RMA (Wilder's smoothing)
  const atr: number[] = new Array(candles.length).fill(0);
  if (trs.length < period) return atr;
  let sum = 0;
  for (let i = 0; i < period; i++) sum += trs[i];
  atr[period - 1] = sum / period;
  for (let i = period; i < trs.length; i++) {
    atr[i] = (atr[i - 1] * (period - 1) + trs[i]) / period;
  }
  return atr;
}

// ── Supertrend direction array: 1 = bullish, -1 = bearish ──
function calcSupertrendDirs(candles: OHLCV[], lookback: number, multiplier: number): number[] {
  const atr = calcATR(candles, lookback);
  const dirs: number[] = new Array(candles.length).fill(0);
  let prevUpper = 0, prevLower = 0, prevDir = 1;

  for (let i = lookback - 1; i < candles.length; i++) {
    const hl2 = (candles[i].high + candles[i].low) / 2;
    let upper = hl2 + multiplier * atr[i];
    let lower = hl2 - multiplier * atr[i];

    if (i > lookback - 1) {
      lower = lower > prevLower || candles[i - 1].close < prevLower ? lower : prevLower;
      upper = upper < prevUpper || candles[i - 1].close > prevUpper ? upper : prevUpper;
    }

    let dir: number;
    if (i === lookback - 1) {
      dir = candles[i].close > upper ? 1 : -1;
    } else {
      if (prevDir === 1 && candles[i].close < lower) dir = -1;
      else if (prevDir === -1 && candles[i].close > upper) dir = 1;
      else dir = prevDir;
    }

    dirs[i] = dir;
    prevUpper = upper;
    prevLower = lower;
    prevDir = dir;
  }
  return dirs;
}

// ── Unified signal evaluator — branches on strategy_type ──
function evaluateSignal(candles: OHLCV[], p: StrategyParams): SignalResult {
  const closes = candles.map(c => c.close);
  const rsi = calcRSI(closes, p.rsi_length);
  const prevRsi = calcRSI(closes.slice(0, -1), p.rsi_length);
  const emaF = calcEMA(closes, p.ema_fast);
  const emaS = calcEMA(closes, p.ema_slow);
  const price = closes[closes.length - 1];
  const canLong = p.trade_direction === 'long' || p.trade_direction === 'both';
  const canShort = p.trade_direction === 'short' || p.trade_direction === 'both';
  const type = p.strategy_type ?? 'rsi_ema';

  // ── Supertrend / Mixed ──
  if (type === 'supertrend' || type === 'mixed') {
    const stMult = p.st_multiplier ?? 2.0;
    const stLen = p.st_lookback ?? 10;
    const dirs = calcSupertrendDirs(candles, stLen, stMult);
    const last = dirs.length - 1;
    if (last < 1 || dirs[last] === 0 || dirs[last - 1] === 0) {
      return { signal: 'HOLD', reason: 'Supertrend not enough data', rsi, ema_fast: emaF, ema_slow: emaS, price };
    }
    const isBuy = dirs[last - 1] === -1 && dirs[last] === 1;   // bearish→bullish
    const isSell = dirs[last - 1] === 1 && dirs[last] === -1;  // bullish→bearish

    // For mixed: also check RSI filter
    if (type === 'mixed') {
      const rsiFilterEnabled = p.rsi_filter_enabled ?? false;
      const rsiLongLevel = p.rsi_filter_long_level ?? 50;
      const rsiShortLevel = p.rsi_filter_short_level ?? 50;
      if (isBuy && canLong) {
        if (rsiFilterEnabled && rsi < rsiLongLevel) {
          return { signal: 'HOLD', reason: `ST bullish but RSI(${rsi}) < ${rsiLongLevel} filter`, rsi, ema_fast: emaF, ema_slow: emaS, price };
        }
        return { signal: 'BUY', reason: `Supertrend turned bullish + RSI(${rsi}) confirmed`, rsi, ema_fast: emaF, ema_slow: emaS, price };
      }
      if (isSell && canShort) {
        if (rsiFilterEnabled && rsi > rsiShortLevel) {
          return { signal: 'HOLD', reason: `ST bearish but RSI(${rsi}) > ${rsiShortLevel} filter`, rsi, ema_fast: emaF, ema_slow: emaS, price };
        }
        return { signal: 'SELL', reason: `Supertrend turned bearish + RSI(${rsi}) confirmed`, rsi, ema_fast: emaF, ema_slow: emaS, price };
      }
    } else {
      // Pure supertrend
      if (isBuy && canLong) return { signal: 'BUY', reason: `Supertrend turned bullish`, rsi, ema_fast: emaF, ema_slow: emaS, price };
      if (isSell && canShort) return { signal: 'SELL', reason: `Supertrend turned bearish`, rsi, ema_fast: emaF, ema_slow: emaS, price };
    }
    return { signal: 'HOLD', reason: `Supertrend dir=${dirs[last]} | no direction change`, rsi, ema_fast: emaF, ema_slow: emaS, price };
  }

  // ── RSI + EMA (default for rsi_ema, custom, smc fallback) ──
  const bullishCross = prevRsi <= p.oversold && rsi > p.oversold;
  const bearishCross = prevRsi >= p.overbought && rsi < p.overbought;
  if (canLong && bullishCross && emaF > emaS) return { signal: 'BUY', reason: `RSI crossed above oversold(${p.oversold}) + uptrend confirmed`, rsi, ema_fast: emaF, ema_slow: emaS, price };
  if (canShort && bearishCross && emaF < emaS) return { signal: 'SELL', reason: `RSI crossed below overbought(${p.overbought}) + downtrend confirmed`, rsi, ema_fast: emaF, ema_slow: emaS, price };
  return { signal: 'HOLD', reason: `RSI=${rsi} | no entry condition met`, rsi, ema_fast: emaF, ema_slow: emaS, price };
}

function calcQty(price: number, pct: number, fixedUsdt: number | null): number {
  const budget = fixedUsdt ? fixedUsdt : 1000 * (pct / 100);
  const qty = budget / price;
  if (price > 1000) return +qty.toFixed(5);
  if (price > 1) return +qty.toFixed(3);
  return +qty.toFixed(1);
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  const client = sb();
  const now = Date.now();
  const results: Array<{ strategyId: string; userId: string; signal: string; symbol: string; reason: string }> = [];

  try {
    // 1. Fetch all active strategies with analyzed params
    const { data: strategies, error } = await client
      .from('strategies')
      .select('*, user_id')
      .eq('status', 'active')
      .not('strategy_params', 'is', null);

    if (error) throw new Error(error.message);
    if (!strategies || strategies.length === 0) {
      return new Response(JSON.stringify({ ran: 0, message: 'No active strategies' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    for (const strategy of strategies) {
      try {
        const rawParams = strategy.strategy_params as StrategyParams;
        // Apply user-edited dynamic custom_inputs over AI-extracted defaults
        const params = applyCustomInputOverrides({ ...rawParams });
        const tf = strategy.timeframe ?? params.timeframe ?? '1h';
        const intervalMs = TF_MS[tf] ?? TF_MS['1h'];

        // 2. Check if it's time to run (last_executed_at + interval <= now)
        const lastRan = strategy.last_executed_at ? new Date(strategy.last_executed_at).getTime() : 0;
        const nextRunAt = lastRan + intervalMs;
        if (now < nextRunAt) continue; // Not yet due — skip

        const userId: string = strategy.user_id;

        // 3. Load user settings
        const { data: settings } = await client
          .from('user_settings')
          .select('binance_api_key, binance_api_secret, use_testnet, bot_enabled, position_size_pct, stop_loss_pct, take_profit_pct')
          .eq('user_id', userId)
          .maybeSingle();

        if (!settings?.binance_api_key || !settings?.binance_api_secret) continue;
        if (settings.bot_enabled === false) continue;

        const useTestnet: boolean = settings.use_testnet ?? true;
        const base = useTestnet ? BINANCE_BASE_TEST : BINANCE_BASE_REAL;

        // Risk priority: per-strategy > global
        const effectiveSL: number = strategy.stop_loss_pct ?? settings.stop_loss_pct ?? 2;
        const effectiveTP: number = strategy.tp1_pct ?? strategy.take_profit_pct ?? settings.take_profit_pct ?? 4;
        const effectiveSize: number = strategy.position_size_pct ?? settings.position_size_pct ?? 5;
        const tp1: number|null = strategy.tp1_pct ?? null;
        const tp2: number|null = strategy.tp2_pct ?? null;
        const tp3: number|null = strategy.tp3_pct ?? null;
        const tradeAmountUsdt: number|null = strategy.trade_amount_usdt ?? null;

        // 4. Fetch klines (need OHLCV for Supertrend ATR calc)
        const interval = TF_INTERVAL[tf] ?? '1h';
        const stLen = params.st_lookback ?? 10;
        const klineLimit = Math.max(params.rsi_length + 10, params.ema_slow + 10, stLen * 3, 60);
        const candles = await fetchKlines(base, params.symbol, interval, klineLimit);

        // 5. Evaluate signal (passes full candles for Supertrend)
        const result = evaluateSignal(candles, params);
        const ts = new Date().toISOString();

        // 6. Always update last_executed_at + last_signal
        await client.from('strategies').update({
          last_executed_at: ts,
          last_signal: result.signal,
        }).eq('id', strategy.id);

        results.push({ strategyId: strategy.id, userId, signal: result.signal, symbol: params.symbol, reason: result.reason });

        if (result.signal === 'HOLD') continue;

        // 7. Place order
        const side = result.signal as 'BUY' | 'SELL';
        const qty = calcQty(result.price, effectiveSize, tradeAmountUsdt);
        let order: Record<string,unknown> | null = null;
        try {
          order = await signedPost(base, '/api/v3/order', settings.binance_api_key, settings.binance_api_secret, {
            symbol: params.symbol.toUpperCase(), side, type: 'MARKET', quantity: String(qty),
          });
        } catch (e) {
          console.error(`[bot-runner] Order failed for ${strategy.id}: ${(e as Error).message}`);
        }

        // 8. Log trade
        if (order) {
          const tpLevels = [tp1, tp2, tp3].filter(Boolean);
          const multiTpNote = tpLevels.length > 1
            ? ` | TP: ${tpLevels.map((t,i) => `TP${i+1}=${t}%`).join(', ')}`
            : '';
          await client.from('trades').insert({
            user_id: userId, signal_id: null, symbol: params.symbol,
            direction: side === 'BUY' ? 'buy' : 'sell',
            entry_price: result.price, quantity: qty,
            stop_loss: result.price * (1 - effectiveSL / 100),
            take_profit: result.price * (1 + effectiveTP / 100),
            status: 'open', binance_order_id: String(order.orderId ?? ''), opened_at: ts,
          });
          await client.from('signals').insert({
            user_id: userId, strategy_id: strategy.id, symbol: params.symbol,
            direction: side === 'BUY' ? 'buy' : 'sell',
            confidence: 85, entry_price: result.price,
            stop_loss: result.price * (1 - effectiveSL / 100),
            take_profit: result.price * (1 + effectiveTP / 100),
            timeframe: tf, reason: result.reason + multiTpNote, status: 'executed',
          });
        }

        // 9. Send notification (fire-and-forget)
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
            timeframe: tf,
            strategyName: strategy.name ?? 'Strategy',
            sl: result.price * (1 - effectiveSL / 100),
            tp1: tp1 ? result.price * (1 + tp1 / 100) : null,
            tp2: tp2 ? result.price * (1 + tp2 / 100) : null,
            tp3: tp3 ? result.price * (1 + tp3 / 100) : null,
            mode: useTestnet ? 'testnet' : 'real',
          }),
        }).catch(() => {});
      } catch (e) {
        console.error(`[bot-runner] Error on strategy ${strategy.id}: ${(e as Error).message}`);
      }
    }

    return new Response(JSON.stringify({ ran: results.length, results }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: (e as Error).message }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
