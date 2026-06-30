import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.21.0";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const RECV_WINDOW = '5000';

function sb() {
  return createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
}

async function hmacSha256(secret: string, msg: string): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(msg));
  return Array.from(new Uint8Array(sig)).map(b => b.toString(16).padStart(2, '0')).join('');
}

async function signedRequest(method: string, base: string, path: string, apiKey: string, secret: string, params: Record<string, string> = {}) {
  const ts = Date.now().toString();
  const all = { ...params, recvWindow: RECV_WINDOW, timestamp: ts };
  const qs = new URLSearchParams(all).toString();
  const sig = await hmacSha256(secret, qs);
  const res = await fetch(`${base}${path}?${qs}&signature=${sig}`, {
    method,
    headers: { 'X-MBX-APIKEY': apiKey, 'Content-Type': 'application/json' },
  });
  const j = await res.json();
  if (!res.ok) throw new Error(j.msg || `HTTP ${res.status}`);
  return j;
}

const signedGet = (b: string, p: string, k: string, s: string, params?: Record<string, string>) => signedRequest('GET', b, p, k, s, params);
const signedPost = (b: string, p: string, k: string, s: string, params: Record<string, string>) => signedRequest('POST', b, p, k, s, params);
const signedDelete = (b: string, p: string, k: string, s: string, params: Record<string, string>) => signedRequest('DELETE', b, p, k, s, params);

// Get step-size-rounded quantity for a symbol
async function roundToStepSize(base: string, prefix: string, sym: string, rawQty: number): Promise<number> {
  try {
    const infoRes = await fetch(`${base}${prefix}/exchangeInfo?symbol=${sym}`);
    const infoData = await infoRes.json();
    const symbolData = infoData?.symbols?.find((s: any) => s.symbol === sym);
    const lotFilter = (symbolData?.filters ?? []).find((f: any) => f.filterType === 'LOT_SIZE');
    const stepSize: string = lotFilter?.stepSize ?? '1';
    const decimals = stepSize.includes('.') ? stepSize.split('.')[1].replace(/0+$/, '').length : 0;
    const factor = Math.pow(10, decimals);
    return Math.floor(rawQty * factor) / factor;
  } catch {
    return rawQty;
  }
}

// Calculate entry quantity from USDT amount
async function calcEntryQty(base: string, prefix: string, sym: string, price: number, pct: number, fixedUsdt: number | null): Promise<number> {
  const rawQty = fixedUsdt ? fixedUsdt / price : (1000 * (pct / 100)) / price;
  return roundToStepSize(base, prefix, sym, rawQty);
}

// Check if user has an open position on Binance Futures
async function getOpenPosition(base: string, apiKey: string, secret: string, symbol: string): Promise<{ side: string; qty: number } | null> {
  try {
    const positions = await signedGet(base, '/fapi/v2/positionRisk', apiKey, secret, { symbol });
    if (!Array.isArray(positions)) return null;
    for (const pos of positions) {
      const amt = parseFloat(pos.positionAmt ?? '0');
      if (amt !== 0) {
        return { side: amt > 0 ? 'LONG' : 'SHORT', qty: Math.abs(amt) };
      }
    }
    return null;
  } catch (e) {
    console.error(`[webhook] Failed to check position: ${(e as Error).message}`);
    return null;
  }
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const url = new URL(req.url);
    const token = url.searchParams.get('token');
    
    if (!token) {
      return new Response(JSON.stringify({ error: 'Missing token' }), { status: 400, headers: corsHeaders });
    }

    const payload = await req.json();
    const client = sb();

    if (payload.action === "DEBUG_SIGNALS") {
      const { data } = await client.from("signals").select("*").order("created_at", { ascending: false }).limit(20);
      return new Response(JSON.stringify(data), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    // ── PROXY: Bypass US IP restriction ──
    if (!payload.is_proxied) {
      console.log(`[webhook] Proxying via DB...`);
      const { error } = await client.rpc('proxy_webhook', { payload: { ...payload, is_proxied: true }, token });
      if (error) {
        console.error(`[webhook] Proxy failed:`, error);
        return new Response(JSON.stringify({ error: 'Proxy failed', details: error }), { status: 500, headers: corsHeaders });
      }
      return new Response(JSON.stringify({ success: true, message: 'Proxied' }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    // ── PARSE PAYLOAD ──
    const action = payload.action?.toUpperCase();
    const symbol = payload.symbol?.toUpperCase();
    const price = parseFloat(String(payload.price ?? '0'));
    const tradeType = payload.type?.toLowerCase(); // "entry", "tp", "sl", or undefined

    if (!symbol) {
      return new Response(JSON.stringify({ error: 'Missing symbol' }), { status: 400, headers: corsHeaders });
    }

    // ── FETCH USER SETTINGS ──
    const { data: settingsList, error: settingsErr } = await client
      .from('user_settings').select('*').eq('webhook_token', token).limit(1);
    const settings = settingsList?.[0];

    if (settingsErr || !settings) {
      return new Response(JSON.stringify({ error: 'Invalid token' }), { status: 401, headers: corsHeaders });
    }
    if (!settings.binance_api_key || !settings.binance_api_secret) {
      return new Response(JSON.stringify({ error: 'API keys not configured' }), { status: 400, headers: corsHeaders });
    }
    if (settings.bot_enabled === false) {
      return new Response(JSON.stringify({ message: 'Bot disabled' }), { status: 200, headers: corsHeaders });
    }

    const apiKey = settings.binance_api_key;
    const apiSecret = settings.binance_api_secret;
    const useTestnet = settings.use_testnet ?? true;
    const tradingMode = settings.trading_mode === 'futures' ? 'futures' : 'spot';
    const base = useTestnet
      ? (tradingMode === 'futures' ? 'https://testnet.binancefuture.com' : 'https://testnet.binance.vision')
      : (tradingMode === 'futures' ? 'https://fapi.binance.com' : 'https://api.binance.com');
    const prefix = tradingMode === 'futures' ? '/fapi/v1' : '/api/v3';

    let order: Record<string, unknown> | null = null;
    let reason = '';
    let logDirection = action === 'BUY' ? 'buy' : 'sell';

    // ══════════════════════════════════════════════
    //  EXIT LOGIC: type = "tp" (partial) or "sl" (full)
    // ══════════════════════════════════════════════
    if (tradeType === 'tp' || tradeType === 'sl') {
      
      if (tradingMode !== 'futures') {
        return new Response(JSON.stringify({ error: 'TP/SL exits only supported for futures' }), { status: 400, headers: corsHeaders });
      }

      const existingPos = await getOpenPosition(base, apiKey, apiSecret, symbol);
      
      if (!existingPos) {
        console.log(`[webhook] ${tradeType.toUpperCase()} for ${symbol}: No open position, skipping.`);
        return new Response(JSON.stringify({ success: true, message: `No open position for ${symbol}` }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      const closeSide = existingPos.side === 'LONG' ? 'SELL' : 'BUY';
      logDirection = existingPos.side === 'LONG' ? 'buy' : 'sell';
      let closeQty = existingPos.qty;

      if (tradeType === 'tp') {
        const exitPct = Math.min(payload.exitPct ?? 100, 100);
        if (exitPct < 100) {
          closeQty = await roundToStepSize(base, prefix, symbol, existingPos.qty * exitPct / 100);
        }
        reason = `TP Exit: ${exitPct}% (${closeQty} of ${existingPos.qty})`;
      } else {
        reason = `SL Exit: Full close (${closeQty})`;
      }

      if (closeQty <= 0) {
        console.log(`[webhook] ${symbol}: closeQty is 0, skipping.`);
        return new Response(JSON.stringify({ success: true, message: 'Qty too small' }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      // Cancel any existing open orders (cleanup old Binance SL/TP if any)
      if (tradeType === 'sl') {
        try {
          await signedDelete(base, `${prefix}/allOpenOrders`, apiKey, apiSecret, { symbol });
          console.log(`[webhook] Cancelled open orders for ${symbol}`);
        } catch (e) {
          console.error(`[webhook] Cancel orders failed: ${(e as Error).message}`);
        }
      }

      // Place reduceOnly MARKET order
      try {
        order = await signedPost(base, `${prefix}/order`, apiKey, apiSecret, {
          symbol, side: closeSide, type: 'MARKET',
          quantity: String(closeQty), reduceOnly: 'true',
        });
        console.log(`[webhook] ${tradeType.toUpperCase()} exit success: ${symbol} ${closeSide} ${closeQty}`);
      } catch (e) {
        const errMsg = (e as Error).message;
        console.error(`[webhook] ${tradeType.toUpperCase()} exit failed: ${errMsg}`);
        reason += ` | Failed: ${errMsg}`;
      }

      // Log signal
      await client.from('signals').insert({
        user_id: settings.user_id, strategy_id: payload.strategyId || null, symbol,
        direction: logDirection, confidence: 99, entry_price: price || 0,
        stop_loss: 0, take_profit: 0,
        timeframe: 'Webhook', reason, status: order ? 'executed' : 'cancelled',
      });

      // Update trade status if full exit
      if (order && (tradeType === 'sl' || (payload.exitPct ?? 100) >= 100)) {
        await client.from('trades')
          .update({ status: 'closed', closed_at: new Date().toISOString() })
          .eq('user_id', settings.user_id)
          .eq('symbol', symbol)
          .eq('status', 'open');
      }

      return new Response(JSON.stringify({ success: true, message: reason, order }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // ══════════════════════════════════════════════
    //  ENTRY LOGIC: type = "entry" or no type (legacy)
    // ══════════════════════════════════════════════
    if (!action) {
      return new Response(JSON.stringify({ error: 'Missing action' }), { status: 400, headers: corsHeaders });
    }
    if (isNaN(price) || price <= 0) {
      return new Response(JSON.stringify({ error: 'Invalid price' }), { status: 400, headers: corsHeaders });
    }

    const side = action === 'BUY' ? 'BUY' : 'SELL';
    const closeSide = side === 'BUY' ? 'SELL' : 'BUY';
    logDirection = side === 'BUY' ? 'buy' : 'sell';

    // Check existing position (skip if already in a trade)
    if (tradingMode === 'futures') {
      const existingPos = await getOpenPosition(base, apiKey, apiSecret, symbol);
      if (existingPos) {
        console.log(`[webhook] SKIP entry: ${symbol} already has ${existingPos.side} position (${existingPos.qty})`);
        await client.from('signals').insert({
          user_id: settings.user_id, strategy_id: payload.strategyId || null, symbol,
          direction: logDirection, confidence: 99, entry_price: price,
          stop_loss: 0, take_profit: 0, timeframe: 'Webhook',
          reason: `Skipped: Already ${existingPos.side} (${existingPos.qty})`, status: 'cancelled',
        });
        return new Response(JSON.stringify({ success: true, message: `Skipped: existing ${existingPos.side} position` }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
    }

    // Calculate entry quantity
    const fixedUsdt = payload.fixedUsdt ?? null;
    const effectiveSize = settings.position_size_pct ?? 5.0;
    const qty = await calcEntryQty(base, prefix, symbol, price, effectiveSize, fixedUsdt);
    reason = `Entry: ${side} ${qty} ${symbol} @ ${price}`;

    // Place entry order
    try {
      order = await signedPost(base, `${prefix}/order`, apiKey, apiSecret, {
        symbol, side, type: 'MARKET', quantity: String(qty),
      });
      console.log(`[webhook] Entry success: ${symbol} ${side} ${qty}`);
    } catch (e) {
      const errMsg = (e as Error).message;
      console.error(`[webhook] Entry failed: ${errMsg}`);
      reason += ` | Failed: ${errMsg}`;
    }

    // ── Place Binance SL/TP ONLY for legacy mode (no type field) ──
    // When type="entry", PineScript handles exits via TP/SL alerts.
    // When no type, use app settings for Binance SL/TP.
    const effectiveSL = settings.stop_loss_pct ?? 2.0;
    const effectiveTP = settings.take_profit_pct ?? 4.0;

    if (!tradeType && order && tradingMode === 'futures') {
      const slPrice = +(price * (side === 'BUY' ? (1 - effectiveSL / 100) : (1 + effectiveSL / 100))).toFixed(4);
      const tpPrice = +(price * (side === 'BUY' ? (1 + effectiveTP / 100) : (1 - effectiveTP / 100))).toFixed(4);

      try {
        await signedPost(base, `${prefix}/order`, apiKey, apiSecret, {
          symbol, side: closeSide, type: 'STOP_MARKET',
          stopPrice: String(slPrice), closePosition: 'true',
        });
        console.log(`[webhook] SL placed at ${slPrice}`);
      } catch (e) {
        console.error(`[webhook] SL failed: ${(e as Error).message}`);
      }

      try {
        await signedPost(base, `${prefix}/order`, apiKey, apiSecret, {
          symbol, side: closeSide, type: 'TAKE_PROFIT_MARKET',
          stopPrice: String(tpPrice), closePosition: 'true',
        });
        console.log(`[webhook] TP placed at ${tpPrice}`);
      } catch (e) {
        console.error(`[webhook] TP failed: ${(e as Error).message}`);
      }
    }

    // Log trade
    if (order) {
      await client.from('trades').insert({
        user_id: settings.user_id, signal_id: null, symbol,
        direction: logDirection, entry_price: price, quantity: qty,
        stop_loss: price * (1 - effectiveSL / 100),
        take_profit: price * (1 + effectiveTP / 100),
        status: 'open', binance_order_id: String(order.orderId ?? ''),
        opened_at: new Date().toISOString(),
      });
    }

    // Log signal
    await client.from('signals').insert({
      user_id: settings.user_id, strategy_id: payload.strategyId || null, symbol,
      direction: logDirection, confidence: 99, entry_price: price,
      stop_loss: price * (1 - effectiveSL / 100),
      take_profit: price * (1 + effectiveTP / 100),
      timeframe: 'Webhook', reason, status: order ? 'executed' : 'cancelled',
    });

    return new Response(JSON.stringify({ success: true, message: reason, order }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (err) {
    console.error(`[webhook] Unhandled error:`, err);
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
