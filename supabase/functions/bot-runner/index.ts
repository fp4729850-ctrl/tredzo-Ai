import { createClient } from 'npm:@supabase/supabase-js@2';

/** Bot Runner — called every minute by pg_cron.
 *  Finds all active strategies whose timeframe interval has elapsed since last_executed_at
 *  and runs the strategy logic (same as execute-strategy) for each.
 */

const BASE_SPOT_REAL = 'https://api.binance.com';
const BASE_SPOT_TEST = 'https://testnet.binance.vision';
const BASE_FUTURES_REAL = 'https://fapi.binance.com';
const BASE_FUTURES_TEST = 'https://testnet.binancefuture.com';
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

async function fetchKlines(base: string, prefix: string, symbol: string, interval: string, limit: number): Promise<OHLCV[]> {
  const url = `${base}${prefix}/klines?symbol=${symbol.toUpperCase()}&interval=${interval}&limit=${limit}`;
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
  set(['supertrend multiplier', 'fast supertrend multiplier', 'st multiplier', 'st_multiplier', 'multiplier', 'atr multiplier', 'factor'], v => { p.st_multiplier = v; });
  set(['supertrend lookback', 'fast supertrend lookback', 'st lookback', 'st_lookback', 'atr length', 'atr period', 'supertrend length'], v => { p.st_lookback = v; });

  // NOTE: Symbol is intentionally NOT in overrides — strategy_params.symbol is the source of truth
  // (set by user in UI Risk Settings, not from PineScript default inputs)

  for (const input of p.custom_inputs) {
    const val = input.value ?? input.defval;
    const nameKey = input.name.toLowerCase().trim();
    if (typeof val === 'number') {
      if (mapping[nameKey]) mapping[nameKey](val);
    }
    // Strings like ETHUSDT from PineScript are intentionally skipped to not override user's symbol
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
    
    // Check for a flip in the last 5 candles
    let isBuy = false, isSell = false;
    for (let i = Math.max(1, last - 4); i <= last; i++) {
      if (dirs[i-1] === -1 && dirs[i] === 1) isBuy = true;
      if (dirs[i-1] === 1 && dirs[i] === -1) isSell = true;
    }

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
  // Check for crossover in last 5 candles
  let bullishCross = false, bearishCross = false;
  for (let i = closes.length - 5; i < closes.length; i++) {
    if (i < 1) continue;
    const rsiNow = calcRSI(closes.slice(0, i + 1), p.rsi_length);
    const rsiPrev = calcRSI(closes.slice(0, i), p.rsi_length);
    if (rsiPrev <= p.oversold && rsiNow > p.oversold) bullishCross = true;
    if (rsiPrev >= p.overbought && rsiNow < p.overbought) bearishCross = true;
  }

  if (canLong && bullishCross && emaF > emaS) return { signal: 'BUY', reason: `RSI crossed above oversold(${p.oversold}) + uptrend confirmed`, rsi, ema_fast: emaF, ema_slow: emaS, price };
  if (canShort && bearishCross && emaF < emaS) return { signal: 'SELL', reason: `RSI crossed below overbought(${p.overbought}) + downtrend confirmed`, rsi, ema_fast: emaF, ema_slow: emaS, price };
  return { signal: 'HOLD', reason: `RSI=${rsi} | no entry condition met`, rsi, ema_fast: emaF, ema_slow: emaS, price };
}

async function calcQtyForSymbol(base: string, prefix: string, sym: string, price: number, pct: number, fixedUsdt: number | null): Promise<number> {
  const budget = fixedUsdt ? fixedUsdt : 1000 * (pct / 100);
  const rawQty = budget / price;
  try {
    const infoRes = await fetch(`${base}${prefix}/exchangeInfo?symbol=${sym.toUpperCase()}`);
    const infoData = await infoRes.json();
    const filters = infoData?.symbols?.[0]?.filters ?? [];
    const lotFilter = filters.find((f: { filterType: string }) => f.filterType === 'LOT_SIZE');
    const stepSize: string = lotFilter?.stepSize ?? '1';
    const decimals = stepSize.includes('.') ? stepSize.split('.')[1].replace(/0+$/, '').length : 0;
    const factor = Math.pow(10, decimals);
    return Math.floor(rawQty * factor) / factor;
  } catch {
    // fallback: basic rounding if exchange info fails
    if (price > 1000) return +rawQty.toFixed(5);
    if (price > 1) return +rawQty.toFixed(3);
    return Math.floor(rawQty);
  }
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
          .select('binance_api_key, binance_api_secret, use_testnet, bot_enabled, trading_mode, position_size_pct, stop_loss_pct, take_profit_pct')
          .eq('user_id', userId)
          .maybeSingle();

        if (!settings?.binance_api_key || !settings?.binance_api_secret) {
          results.push({ strategyId: strategy.id, userId, signal: 'HOLD', symbol: 'N/A', reason: `❌ No API keys in user_settings for userId=${userId}. has_settings=${!!settings}, has_key=${!!settings?.binance_api_key}` });
          continue;
        }
        if (settings.bot_enabled === false) {
          results.push({ strategyId: strategy.id, userId, signal: 'HOLD', symbol: 'N/A', reason: '❌ Bot is disabled in settings' });
          continue;
        }

        const useTestnet: boolean = settings.use_testnet ?? true;
        const tradingMode = settings.trading_mode === 'futures' ? 'futures' : 'spot';
        let base = '';
        let prefix = '';
        if (tradingMode === 'futures') {
          base = useTestnet ? BASE_FUTURES_TEST : BASE_FUTURES_REAL;
          prefix = '/fapi/v1';
        } else {
          base = useTestnet ? BASE_SPOT_TEST : BASE_SPOT_REAL;
          prefix = '/api/v3';
        }

        // Risk priority: per-strategy > global
        const effectiveSL: number = strategy.stop_loss_pct ?? settings.stop_loss_pct ?? 2;
        const effectiveTP: number = strategy.tp1_pct ?? strategy.take_profit_pct ?? settings.take_profit_pct ?? 4;
        const effectiveSize: number = strategy.position_size_pct ?? settings.position_size_pct ?? 5;
        const tp1: number|null = strategy.tp1_pct ?? null;
        const tp2: number|null = strategy.tp2_pct ?? null;
        const tp3: number|null = strategy.tp3_pct ?? null;
        const tradeAmountUsdt: number|null = strategy.trade_amount_usdt ?? null;

        // ✅ Run for ALL active symbols in the strategy
        const symbolsToRun = strategy.symbols && strategy.symbols.length > 0 
          ? strategy.symbols 
          : [params.symbol ?? 'BTCUSDT'];

        for (const sym of symbolsToRun) {
          try {
            // 4. Fetch klines
            const interval = TF_INTERVAL[tf] ?? '1h';
            const stLen = params.st_lookback ?? 10;
            const klineLimit = Math.max(params.rsi_length + 10, params.ema_slow + 10, stLen * 3, 60);
            const candles = await fetchKlines(base, prefix, sym, interval, klineLimit);

            // 5. Evaluate signal
            const result = evaluateSignal(candles, params);
            const ts = new Date().toISOString();

            results.push({ strategyId: strategy.id, userId, signal: result.signal, symbol: sym, reason: result.reason });

            if (result.signal === 'HOLD') continue;

            // ✅ Deduplication: only skip if last signal was successfully executed
            const { data: lastDbSignal } = await client
              .from('signals')
              .select('direction, status')
              .eq('strategy_id', strategy.id)
              .eq('symbol', sym)
              .eq('status', 'executed')
              .order('created_at', { ascending: false })
              .limit(1)
              .maybeSingle();

            const lastSignalDir = lastDbSignal ? (lastDbSignal.direction === 'buy' ? 'BUY' : 'SELL') : null;

            if (lastSignalDir === result.signal) {
              console.log(`[bot-runner] Skipping duplicate ${result.signal} for ${strategy.id} on ${sym} — already executed this flip`);
              continue;
            }

            // 7. Place entry order
            const side = result.signal as 'BUY' | 'SELL';
            const closeSide = side === 'BUY' ? 'SELL' : 'BUY'; // opposite side for TP/SL
            const qty = await calcQtyForSymbol(base, prefix, sym, result.price, effectiveSize, tradeAmountUsdt);
            let order: Record<string,unknown> | null = null;
            try {
              order = await signedPost(base, `${prefix}/order`, settings.binance_api_key, settings.binance_api_secret, {
                symbol: sym.toUpperCase(), side, type: 'MARKET', quantity: String(qty),
              });
            } catch (e) {
              const errMsg = (e as Error).message;
              console.error(`[bot-runner] Order failed for ${strategy.id} on ${sym}: ${errMsg}`);
              result.reason += ` | Order Failed: ${errMsg}`;
            }

            // 7b. Place SL and TP orders on Futures (STOP_MARKET + TAKE_PROFIT_MARKET)
            if (order && tradingMode === 'futures') {
              const slPrice = +(result.price * (side === 'BUY' ? (1 - effectiveSL / 100) : (1 + effectiveSL / 100))).toFixed(4);
              const tpPrice = +(result.price * (side === 'BUY' ? (1 + effectiveTP / 100) : (1 - effectiveTP / 100))).toFixed(4);

              // Stop Loss
              try {
                await signedPost(base, `${prefix}/order`, settings.binance_api_key, settings.binance_api_secret, {
                  symbol: sym.toUpperCase(), side: closeSide, type: 'STOP_MARKET',
                  stopPrice: String(slPrice), closePosition: 'true',
                });
                console.log(`[bot-runner] SL order placed at ${slPrice} for ${sym}`);
              } catch (e) {
                console.error(`[bot-runner] SL order failed for ${sym}: ${(e as Error).message}`);
              }

              // Take Profit (use tp1 if available, else effectiveTP)
              const tpUsed = tp1 ?? effectiveTP;
              const tpFinalPrice = +(result.price * (side === 'BUY' ? (1 + tpUsed / 100) : (1 - tpUsed / 100))).toFixed(4);
              try {
                await signedPost(base, `${prefix}/order`, settings.binance_api_key, settings.binance_api_secret, {
                  symbol: sym.toUpperCase(), side: closeSide, type: 'TAKE_PROFIT_MARKET',
                  stopPrice: String(tpFinalPrice), closePosition: 'true',
                });
                console.log(`[bot-runner] TP order placed at ${tpFinalPrice} for ${sym}`);
              } catch (e) {
                console.error(`[bot-runner] TP order failed for ${sym}: ${(e as Error).message}`);
              }
            }

            // 8. Log trade (only if successful)
            if (order) {
              const tpLevels = [tp1, tp2, tp3].filter(Boolean);
              const multiTpNote = tpLevels.length > 1
                ? ` | TP: ${tpLevels.map((t,i) => `TP${i+1}=${t}%`).join(', ')}`
                : '';
              await client.from('trades').insert({
                user_id: userId, signal_id: null, symbol: sym,
                direction: side === 'BUY' ? 'buy' : 'sell',
                entry_price: result.price, quantity: qty,
                stop_loss: result.price * (1 - effectiveSL / 100),
                take_profit: result.price * (1 + effectiveTP / 100),
                status: 'open', binance_order_id: String(order.orderId ?? ''), opened_at: ts,
              });
            }

            // 8b. Always log the signal, whether order succeeded or failed
            await client.from('signals').insert({
              user_id: userId, strategy_id: strategy.id, symbol: sym,
              direction: side === 'BUY' ? 'buy' : 'sell',
              confidence: 85, entry_price: result.price,
              stop_loss: result.price * (1 - effectiveSL / 100),
              take_profit: result.price * (1 + effectiveTP / 100),
              timeframe: tf, reason: result.reason, status: order ? 'executed' : 'cancelled',
            });

            // 9. Send notification
            fetch(`${Deno.env.get('SUPABASE_URL')}/functions/v1/send-notification`, {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')}`,
              },
              body: JSON.stringify({
                userId,
                signal: result.signal,
                symbol: sym,
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
            console.error(`[bot-runner] Error on strategy ${strategy.id} for symbol ${sym}: ${(e as Error).message}`);
          }
        }

        // Update last_executed_at (we don't need last_signal column anymore)
        const ts = new Date().toISOString();
        await client.from('strategies').update({
          last_executed_at: ts,
        }).eq('id', strategy.id);

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
