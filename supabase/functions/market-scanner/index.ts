import { createClient } from 'npm:@supabase/supabase-js@2';

/**
 * Market Scanner — Tredzo SMC Edition with Auto-Trade
 * - Fetches top gainers & losers from Binance 24hr ticker
 * - Runs Tredzo Strategy scoring engine on each coin
 * - If auto_trade=true AND user's API keys are set:
 *   → Places MARKET order on Binance with dynamic SL/TP
 *   → Deduplicates (won't trade if open trade already exists for symbol)
 */

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const BINANCE_SPOT_BASE    = 'https://api.binance.com';
const BINANCE_FUTURES_BASE = 'https://fapi.binance.com';
const RECV_WINDOW = '5000';

// ─── Types ────────────────────────────────────────────────────────────────────

interface BinanceTicker {
  symbol: string; lastPrice: string; priceChangePercent: string;
  quoteVolume: string; highPrice: string; lowPrice: string; volume: string;
}

interface OHLCV { open: number; high: number; low: number; close: number; volume: number; }

interface ScanItem {
  id: string; symbol: string; price: number; change_pct_24h: number;
  volume_24h: number; scan_type: 'gainer' | 'loser';
  signal_direction: 'buy' | 'sell' | null;
  confidence: number; timeframe: string; scanned_at: string;
  tredzo_score: number; tredzo_reason: string; mandatory_ok: boolean;
  dynamic_sl?: number; dynamic_tp1?: number; dynamic_tp2?: number;
}

interface UserSettings {
  binance_api_key?: string | null;
  binance_api_secret?: string | null;
  trading_mode?: 'spot' | 'futures';
  testnet_mode?: boolean;
  position_size_pct?: number;
  trade_amount_usdt?: number;
}

// ─── Binance Signing ──────────────────────────────────────────────────────────

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
    headers: { 'X-MBX-APIKEY': apiKey },
  });
  const j = await res.json();
  if (!res.ok) throw new Error(j.msg || `HTTP ${res.status}`);
  return j;
}

async function calcQty(base: string, prefix: string, sym: string, price: number, usdtAmount: number): Promise<number> {
  const rawQty = usdtAmount / price;
  try {
    const res = await fetch(`${base}${prefix}/exchangeInfo?symbol=${sym.toUpperCase()}`);
    const data = await res.json();
    const filters = data?.symbols?.[0]?.filters ?? [];
    const lot = filters.find((f: { filterType: string }) => f.filterType === 'LOT_SIZE');
    const step: string = lot?.stepSize ?? '1';
    const decimals = step.includes('.') ? step.split('.')[1].replace(/0+$/, '').length : 0;
    const factor = Math.pow(10, decimals);
    return Math.floor(rawQty * factor) / factor;
  } catch {
    if (price > 1000) return +rawQty.toFixed(5);
    if (price > 1)    return +rawQty.toFixed(3);
    return Math.floor(rawQty);
  }
}

// ─── Indicator Math ───────────────────────────────────────────────────────────

function calcSMA(vals: number[], period: number): number {
  if (vals.length < period) return vals[vals.length - 1] ?? 0;
  let s = 0;
  for (let i = vals.length - period; i < vals.length; i++) s += vals[i];
  return s / period;
}

function calcEMA(closes: number[], period: number): number {
  if (closes.length < period) return closes[closes.length - 1] ?? 0;
  const k = 2 / (period + 1);
  let ema = closes.slice(0, period).reduce((a, b) => a + b, 0) / period;
  for (let i = period; i < closes.length; i++) ema = closes[i] * k + ema * (1 - k);
  return ema;
}

function calcATR(candles: OHLCV[], period: number): number[] {
  const trs: number[] = [];
  for (let i = 0; i < candles.length; i++) {
    trs.push(i === 0 ? candles[i].high - candles[i].low : Math.max(
      candles[i].high - candles[i].low,
      Math.abs(candles[i].high - candles[i - 1].close),
      Math.abs(candles[i].low  - candles[i - 1].close),
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
    const up = candles[i].high - candles[i - 1].high;
    const dn = candles[i - 1].low - candles[i].low;
    if (up > dn && up > 0) plusDM += up;
    if (dn > up && dn > 0) minusDM += dn;
    trSum += Math.max(candles[i].high - candles[i].low,
      Math.abs(candles[i].high - candles[i - 1].close),
      Math.abs(candles[i].low  - candles[i - 1].close));
  }
  if (trSum === 0) return 0;
  const pDI = 100 * plusDM / trSum, mDI = 100 * minusDM / trSum;
  if (pDI + mDI === 0) return 0;
  return 100 * Math.abs(pDI - mDI) / (pDI + mDI);
}

function calcPivotHighs(c: OHLCV[], len: number): number[] {
  const ph = new Array(c.length).fill(NaN);
  for (let i = len; i < c.length - len; i++) {
    let ok = true;
    for (let j = i - len; j <= i + len; j++) { if (j !== i && c[j].high >= c[i].high) { ok = false; break; } }
    if (ok) ph[i] = c[i].high;
  }
  return ph;
}

function calcPivotLows(c: OHLCV[], len: number): number[] {
  const pl = new Array(c.length).fill(NaN);
  for (let i = len; i < c.length - len; i++) {
    let ok = true;
    for (let j = i - len; j <= i + len; j++) { if (j !== i && c[j].low <= c[i].low) { ok = false; break; } }
    if (ok) pl[i] = c[i].low;
  }
  return pl;
}

// ─── Tredzo SMC Scoring ───────────────────────────────────────────────────────

interface TredzoResult {
  signal: 'BUY' | 'SELL' | 'HOLD';
  score: number; mandatoryOk: boolean; reason: string;
  dynamicSL?: number; dynamicTP1?: number; dynamicTP2?: number;
}

function runTredzoScoring(candles: OHLCV[]): TredzoResult {
  const HOLD = (r: string): TredzoResult => ({ signal: 'HOLD', score: 0, mandatoryOk: false, reason: r });
  if (candles.length < 60) return HOLD('Not enough data');

  const closes  = candles.map(c => c.close);
  const volumes = candles.map(c => c.volume);
  const atrs    = calcATR(candles, 14);
  const atr     = atrs[atrs.length - 1] ?? 0;
  const atrMa   = calcSMA(atrs.filter(v => v > 0), 50);
  const adx     = calcADX(candles, 14);
  const ema200  = calcEMA(closes, Math.min(200, closes.length - 1));
  const volMa   = calcSMA(volumes, 20);
  const currVol = volumes[volumes.length - 1] ?? 0;
  const price   = closes[closes.length - 1];

  // Pump/Dump (lookback 50)
  const lbIdx   = Math.max(0, candles.length - 51);
  const lbClose = candles[lbIdx]?.close ?? price;
  const pctChg  = ((price - lbClose) / lbClose) * 100;
  const isPump  = pctChg >= 8;
  const isDump  = pctChg <= -8;

  // Zones via Pivot H/L
  const phs = calcPivotHighs(candles, 6);
  const pls = calcPivotLows(candles, 6);
  let bullZone: { top: number; bot: number } | null = null;
  let bearZone: { top: number; bot: number } | null = null;
  for (let i = candles.length - 7; i >= 0; i--) {
    if (!bearZone && !isNaN(phs[i])) bearZone = { top: phs[i], bot: phs[i] - (atrs[i] ?? atr) * 0.35 };
    if (!bullZone && !isNaN(pls[i])) bullZone = { top: pls[i] + (atrs[i] ?? atr) * 0.35, bot: pls[i] };
    if (bullZone && bearZone) break;
  }

  const curr = candles[candles.length - 1];
  const body  = Math.abs(curr.close - curr.open);
  const safe  = body === 0 ? 0.00001 : body;
  const uWick = curr.high - Math.max(curr.open, curr.close);
  const lWick = Math.min(curr.open, curr.close) - curr.low;

  const bullTouch  = bullZone ? curr.high >= bullZone.bot && curr.low <= bullZone.top : false;
  const bullSweep  = bullZone ? curr.low < bullZone.bot && curr.close > bullZone.bot : false;
  const bullReject = lWick / safe >= 1.4;
  const bearTouch  = bearZone ? curr.high >= bearZone.bot && curr.low <= bearZone.top : false;
  const bearSweep  = bearZone ? curr.high > bearZone.top && curr.close < bearZone.top : false;
  const bearReject = uWick / safe >= 1.4;

  const adxOk  = adx > 25;
  const atrOk  = atr > atrMa * 0.9;
  const volOk  = currVol > volMa * 1.2;
  const bTrend = price > ema200;
  const sTrend = price < ema200;

  if (!adxOk || !atrOk) return HOLD(`No-Trade: ADX=${adx.toFixed(1)}`);

  // Bull score
  let bullScore = 0;
  if (isDump)     bullScore += 15;
  if (bullTouch)  bullScore += 20;
  if (bullSweep)  bullScore += 20;
  if (bullReject) bullScore += 15;
  if (volOk)      bullScore += 10;
  if (bTrend)     bullScore += 10;
  if (adxOk)      bullScore += 5;
  if (atrOk)      bullScore += 5;

  if (bullScore >= 80 && bullTouch && bullSweep && bullReject) {
    const sl   = bullZone!.bot - atr * 0.5;
    const risk = price - sl;
    const parts = [
      isDump      && `Dump ${pctChg.toFixed(1)}%`,
      bullSweep   && 'Liq.Sweep',
      bullReject  && 'Rejection',
      volOk       && 'Vol Spike',
    ].filter(Boolean).join(' · ');
    return { signal: 'BUY', score: bullScore, mandatoryOk: true, reason: parts,
      dynamicSL: sl, dynamicTP1: price + risk, dynamicTP2: price + risk * 2 };
  }

  // Bear score
  let bearScore = 0;
  if (isPump)     bearScore += 15;
  if (bearTouch)  bearScore += 20;
  if (bearSweep)  bearScore += 20;
  if (bearReject) bearScore += 15;
  if (volOk)      bearScore += 10;
  if (sTrend)     bearScore += 10;
  if (adxOk)      bearScore += 5;
  if (atrOk)      bearScore += 5;

  if (bearScore >= 80 && bearTouch && bearSweep && bearReject) {
    const sl   = bearZone!.top + atr * 0.5;
    const risk = sl - price;
    const parts = [
      isPump      && `Pump ${pctChg.toFixed(1)}%`,
      bearSweep   && 'Liq.Sweep',
      bearReject  && 'Rejection',
      volOk       && 'Vol Spike',
    ].filter(Boolean).join(' · ');
    return { signal: 'SELL', score: bearScore, mandatoryOk: true, reason: parts,
      dynamicSL: sl, dynamicTP1: price - risk, dynamicTP2: price - risk * 2 };
  }

  const best = Math.max(bullScore, bearScore);
  return HOLD(`Score: ${best}/100 — No full setup`);
}

// ─── Fetch klines ─────────────────────────────────────────────────────────────

async function fetchKlines(symbol: string, interval: string): Promise<OHLCV[]> {
  try {
    const res = await fetch(
      `${BINANCE_FUTURES_BASE}/fapi/v1/klines?symbol=${symbol}&interval=${interval}&limit=300`,
      { signal: AbortSignal.timeout(8_000) }
    );
    if (!res.ok) return [];
    const raw: unknown[][] = await res.json();
    return raw.map(c => ({
      open: parseFloat(c[1] as string), high: parseFloat(c[2] as string),
      low:  parseFloat(c[3] as string), close: parseFloat(c[4] as string),
      volume: parseFloat(c[5] as string),
    }));
  } catch { return []; }
}

// ─── Auto Trade Execution ─────────────────────────────────────────────────────

async function executeAutoTrade(
  item: ScanItem,
  settings: UserSettings,
  userId: string,
  sb: ReturnType<typeof createClient>
): Promise<{ success: boolean; msg: string }> {
  try {
    const { binance_api_key: apiKey, binance_api_secret: apiSecret } = settings;
    if (!apiKey || !apiSecret) return { success: false, msg: 'No Binance API keys' };

    // Market Scanner is strictly a Futures bot (needs SL/TP closePosition='true')
    const isFutures = true;
    const isTestnet = settings.testnet_mode ?? false;
    const base   = isFutures
      ? (isTestnet ? 'https://testnet.binancefuture.com' : BINANCE_FUTURES_BASE)
      : (isTestnet ? 'https://testnet.binance.vision' : BINANCE_SPOT_BASE);
    const prefix = isFutures ? '/fapi/v1' : '/api/v3';

    const side      = item.signal_direction === 'buy' ? 'BUY' : 'SELL';
    const closeSide = side === 'BUY' ? 'SELL' : 'BUY';
    const symbol    = item.symbol.toUpperCase();

    // Dedup: check for existing open trade on this symbol
    const { data: existingTrade } = await sb
      .from('trades')
      .select('id')
      .eq('user_id', userId)
      .eq('symbol', symbol)
      .eq('status', 'open')
      .maybeSingle();

    if (existingTrade) return { success: false, msg: `Open trade already exists for ${symbol}` };

    // Calculate budget
    const usdtBudget = settings.trade_amount_usdt
      ?? (settings.position_size_pct ? 1000 * settings.position_size_pct / 100 : 10);

    const qty = await calcQty(base, prefix, symbol, item.price, usdtBudget);
    if (qty <= 0) return { success: false, msg: 'Qty too small' };

    // Place market order
    let order;
    try {
      order = await signedPost(base, `${prefix}/order`, apiKey, apiSecret, {
        symbol, side, type: 'MARKET', quantity: String(qty),
      });
    } catch (e) {
      return { success: false, msg: `Market Order Error: ${(e as Error).message}` };
    }

    // Place SL order (futures only)
    if (isFutures && item.dynamic_sl) {
      const slPrice = +item.dynamic_sl.toFixed(4);
      try {
        await signedPost(base, `${prefix}/order`, apiKey, apiSecret, {
          symbol, side: closeSide, type: 'STOP_MARKET',
          stopPrice: String(slPrice), closePosition: 'true',
        });
      } catch (e) {
        console.error(`[market-scanner] SL order failed: ${(e as Error).message}`);
      }
    }

    // ----- Quantity split for TP1 and Trailing SL -----
    const qtyHalf = Number((qty / 2).toFixed(4)); // first half for TP1
    const qtyRemaining = Number((qty - qtyHalf).toFixed(4));

    // Place market order for full qty (already done above)
    // Place TP1 order for first half
    if (isFutures && item.dynamic_tp1) {
      const tpPrice = +item.dynamic_tp1.toFixed(4);
      try {
        await signedPost(base, `${prefix}/order`, apiKey, apiSecret, {
          symbol,
          side: closeSide,
          type: 'TAKE_PROFIT_MARKET',
          stopPrice: String(tpPrice),
          quantity: String(qtyHalf),
          closePosition: 'false',
        });
      } catch (e) {
        console.error(`[market-scanner] TP1 order failed: ${(e as Error).message}`);
      }
    }

    // Place Trailing Stop order for remaining half (if supported)
    const trailingRate = settings.trailing_sl_percent ?? 2; // default 2%
    if (isFutures && trailingRate > 0 && qtyRemaining > 0) {
      try {
        await signedPost(base, `${prefix}/order`, apiKey, apiSecret, {
          symbol,
          side: closeSide,
          type: 'TRAILING_STOP_MARKET',
          callbackRate: String(trailingRate),
          quantity: String(qtyRemaining),
          closePosition: 'false',
        });
        console.log(`[market-scanner] Trailing SL placed for ${symbol} @ ${trailingRate}%`);
      } catch (e) {
        console.error(`[market-scanner] Trailing SL order failed: ${(e as Error).message}`);
      }
    }

    // Place SL order for the whole position (if needed)
    if (isFutures && item.dynamic_sl) {
      const slPrice = +item.dynamic_sl.toFixed(4);
      try {
        await signedPost(base, `${prefix}/order`, apiKey, apiSecret, {
          symbol,
          side: closeSide,
          type: 'STOP_MARKET',
          stopPrice: String(slPrice),
          quantity: String(qty),
          closePosition: 'true',
        });
      } catch (e) {
        console.error(`[market-scanner] SL order failed: ${(e as Error).message}`);
      }
    }

    // Log to trades table (store full qty; individual TP/TSL handled separately)
    await sb.from('trades').insert({
      user_id:          userId,
      symbol,
      direction:        side === 'BUY' ? 'buy' : 'sell',
      entry_price:      item.price,
      quantity:         qty,
      stop_loss:        item.dynamic_sl ?? null,
      take_profit:      item.dynamic_tp1 ?? null,
      status:           'open',
      binance_order_id: String(order.orderId ?? ''),
      opened_at:        new Date().toISOString(),
    });

    // End of trade execution block
    // Log signal
    await sb.from('signals').insert({
      user_id:    userId,
      symbol,
      direction:  side === 'BUY' ? 'buy' : 'sell',
      price:      item.price,
      status:     'executed',
      reason:     `Tredzo Scanner (Score ${item.tredzo_score}/100): ${item.tredzo_reason}`,
      created_at: new Date().toISOString(),
    });

    return { success: true, msg: `${side} ${qty} ${symbol} @ $${item.price} [Score: ${item.tredzo_score}]` };
  } catch (e) {
    return { success: false, msg: (e as Error).message };
  }
}

// ─── Main Handler ─────────────────────────────────────────────────────────────

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

  try {
    const body        = await req.json().catch(() => ({}));
    const timeframe   = body.timeframe ?? '1h';
    const topN        = body.top_n ?? 15;
    const autoTrade   = body.auto_trade === true;
    const customTradeAmount = body.trade_amount_usdt ? Number(body.trade_amount_usdt) : null;

    // 1. Fetch all USDT tickers from Binance Futures
    let tickers: BinanceTicker[] = [];
    try {
      const res = await fetch(`${BINANCE_FUTURES_BASE}/fapi/v1/ticker/24hr`, { signal: AbortSignal.timeout(10_000) });
      if (!res.ok) throw new Error(`Binance HTTP ${res.status}`);
      tickers = await res.json();
    } catch (e) {
      return new Response(
        JSON.stringify({ error: `Binance API unreachable: ${(e as Error).message}` }),
        { status: 502, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // 2. Filter and sort
    const usdt = tickers.filter(t =>
      t.symbol.endsWith('USDT') &&
      !t.symbol.includes('UP') && !t.symbol.includes('DOWN') &&
      !t.symbol.includes('BEAR') && !t.symbol.includes('BULL') &&
      parseFloat(t.quoteVolume) > 2_000_000
    );
    const sorted = [...usdt].sort((a, b) => parseFloat(b.priceChangePercent) - parseFloat(a.priceChangePercent));
    const topGainers = sorted.slice(0, topN);
    const topLosers  = sorted.slice(-topN).reverse();
    const allPairs   = [
      ...topGainers.map(t => ({ ticker: t, type: 'gainer' as const })),
      ...topLosers.map(t  => ({ ticker: t, type: 'loser'  as const })),
    ];

    const scannedAt = new Date().toISOString();

    // 3. Fetch klines + run Tredzo scoring in parallel
    const results = await Promise.allSettled(
      allPairs.map(async ({ ticker, type }, idx) => {
        const price     = parseFloat(ticker.lastPrice);
        const changePct = parseFloat(ticker.priceChangePercent);
        const volume    = parseFloat(ticker.quoteVolume);
        const candles   = await fetchKlines(ticker.symbol, timeframe);
        const tredzo    = runTredzoScoring(candles);

        const item: ScanItem = {
          id: `${type}-${idx}`, symbol: ticker.symbol,
          price, change_pct_24h: +changePct.toFixed(2), volume_24h: +volume.toFixed(0),
          scan_type: type,
          signal_direction: tredzo.signal === 'HOLD' ? null : (tredzo.signal === 'BUY' ? 'buy' : 'sell'),
          confidence: tredzo.score, timeframe, scanned_at: scannedAt,
          tredzo_score: tredzo.score, tredzo_reason: tredzo.reason,
          mandatory_ok: tredzo.mandatoryOk,
          dynamic_sl:   tredzo.dynamicSL,
          dynamic_tp1:  tredzo.dynamicTP1,
          dynamic_tp2:  tredzo.dynamicTP2,
        };
        return item;
      })
    );

    const allItems: ScanItem[] = results
      .filter((r): r is PromiseFulfilledResult<ScanItem> => r.status === 'fulfilled')
      .map(r => r.value);

    const gainers = allItems.filter(i => i.scan_type === 'gainer').sort((a, b) => b.tredzo_score - a.tredzo_score);
    const losers  = allItems.filter(i => i.scan_type === 'loser').sort((a, b) => b.tredzo_score - a.tredzo_score);
    const signals = allItems.filter(i => i.signal_direction !== null && i.mandatory_ok);

    // 4. Auto-Trade execution
    const tradeResults: Array<{ symbol: string; success: boolean; msg: string }> = [];

    if (autoTrade && signals.length > 0) {
      // Get user from JWT
      const authHeader = req.headers.get('Authorization');
      if (authHeader) {
        const sbClient = createClient(
          Deno.env.get('SUPABASE_URL') ?? '',
          Deno.env.get('SUPABASE_ANON_KEY') ?? '',
          { global: { headers: { Authorization: authHeader } } }
        );
        const { data: { user } } = await sbClient.auth.getUser();

        if (user) {
          const sbAdmin = createClient(
            Deno.env.get('SUPABASE_URL') ?? '',
            Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
          );

          // Fetch user settings
          const { data: settings } = await sbAdmin
            .from('user_settings')
            .select('binance_api_key, binance_api_secret, trading_mode, testnet_mode, position_size_pct, trade_amount_usdt')
            .eq('user_id', user.id)
            .single() as { data: UserSettings | null };

          if (settings?.binance_api_key) {
            // Override trade amount if provided by the client request
            if (customTradeAmount && customTradeAmount > 0) {
              settings.trade_amount_usdt = customTradeAmount;
            }
            
            for (const signal of signals) {
              const result = await executeAutoTrade(signal, settings, user.id, sbAdmin);
              tradeResults.push({ symbol: signal.symbol, ...result });
              // Small delay between orders to avoid rate limits
              await new Promise(r => setTimeout(r, 300));
            }
          } else {
            tradeResults.push({ symbol: 'ALL', success: false, msg: 'Binance API keys not configured in Settings' });
          }
        }
      }
    }

    // 5. Persist scan results to DB (best-effort)
    try {
      const sbAdmin = createClient(
        Deno.env.get('SUPABASE_URL') ?? '',
        Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
      );
      await sbAdmin.from('market_scans').insert(allItems.map(s => ({
        symbol: s.symbol, price: s.price,
        change_pct_24h: s.change_pct_24h, volume_24h: s.volume_24h,
        scan_type: s.scan_type, signal_direction: s.signal_direction,
        confidence: s.tredzo_score, timeframe: s.timeframe, scanned_at: s.scanned_at,
      })));
    } catch { /* non-fatal */ }

    return new Response(
      JSON.stringify({
        gainers, losers,
        totalSignals: signals.length,
        tradesPlaced: tradeResults.filter(r => r.success).length,
        tradeResults,
        timeframe,
        source: 'binance_live_tredzo',
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (err) {
    return new Response(
      JSON.stringify({ error: err instanceof Error ? err.message : 'Unknown error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
