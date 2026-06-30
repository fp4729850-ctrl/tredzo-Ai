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

async function signedPost(base: string, path: string, apiKey: string, secret: string, params: Record<string, string>) {
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

async function calcQtyForSymbol(base: string, prefix: string, sym: string, price: number, pct: number, fixedUsdt: number | null): Promise<number> {
  const budget = fixedUsdt ? fixedUsdt : 1000 * (pct / 100);
  const rawQty = budget / price;
  try {
    const infoRes = await fetch(`${base}${prefix}/exchangeInfo?symbol=${sym.toUpperCase()}`);
    const infoData = await infoRes.json();
    const symbolData = infoData?.symbols?.find((s: any) => s.symbol === sym.toUpperCase());
    const filters = symbolData?.filters ?? [];
    const lotFilter = filters.find((f: { filterType: string }) => f.filterType === 'LOT_SIZE');
    const stepSize: string = lotFilter?.stepSize ?? '1';
    const decimals = stepSize.includes('.') ? stepSize.split('.')[1].replace(/0+$/, '').length : 0;
    const factor = Math.pow(10, decimals);
    return Math.floor(rawQty * factor) / factor;
  } catch {
    if (price > 1000) return +rawQty.toFixed(5);
    if (price > 1) return +rawQty.toFixed(3);
    return Math.floor(rawQty);
  }
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const url = new URL(req.url);
    const token = url.searchParams.get('token');
    
    if (!token) {
      return new Response(JSON.stringify({ error: 'Missing token parameter in URL' }), { status: 400, headers: corsHeaders });
    }

    const payload = await req.json();

    const client = sb();

    // If request comes from TradingView (US IP), Binance blocks it for REAL accounts.
    // We bypass this by forwarding the payload to the Postgres DB via an RPC,
    // which then calls this webhook back using pg_net (originating from DB's non-US region).
    if (!payload.is_proxied) {
      console.log(`[webhook] Proxying request via DB to bypass US IP restrictions...`);
      const proxyPayload = { ...payload, is_proxied: true };
      
      const { error } = await client.rpc('proxy_webhook', { 
        payload: proxyPayload, 
        token: token 
      });

      if (error) {
        console.error(`[webhook] Proxy RPC failed:`, error);
        return new Response(JSON.stringify({ error: 'Proxy failed', details: error }), { status: 500, headers: corsHeaders });
      }

      // Return immediate success to TradingView
      return new Response(JSON.stringify({ success: true, message: 'Webhook received and proxied' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const action = payload.action?.toUpperCase();
    const symbol = payload.symbol?.toUpperCase();
    const priceStr = payload.price;

    if (!action || !symbol || !priceStr) {
      return new Response(JSON.stringify({ error: 'Invalid payload. Ensure action, symbol, and price are provided.' }), { status: 400, headers: corsHeaders });
    }

    const price = parseFloat(String(priceStr));
    if (isNaN(price)) {
      return new Response(JSON.stringify({ error: 'Invalid price' }), { status: 400, headers: corsHeaders });
    }

    // 1. Fetch user by token
    const { data: settingsList, error: settingsErr } = await client
      .from('user_settings')
      .select('*')
      .eq('webhook_token', token)
      .limit(1);

    const settings = settingsList?.[0];

    if (settingsErr || !settings) {
      return new Response(JSON.stringify({ error: 'Invalid token' }), { status: 401, headers: corsHeaders });
    }

    if (!settings.binance_api_key || !settings.binance_api_secret) {
      return new Response(JSON.stringify({ error: 'Binance API keys not configured' }), { status: 400, headers: corsHeaders });
    }

    if (settings.bot_enabled === false) {
      return new Response(JSON.stringify({ message: 'Bot is disabled by user' }), { status: 200, headers: corsHeaders });
    }

    const useTestnet = settings.use_testnet ?? true;
    const tradingMode = settings.trading_mode === 'futures' ? 'futures' : 'spot';
    const base = useTestnet
      ? (tradingMode === 'futures' ? 'https://testnet.binancefuture.com' : 'https://testnet.binance.vision')
      : (tradingMode === 'futures' ? 'https://fapi.binance.com' : 'https://api.binance.com');
    const prefix = tradingMode === 'futures' ? '/fapi/v1' : '/api/v3';

    const side = action === 'BUY' ? 'BUY' : 'SELL';
    const closeSide = side === 'BUY' ? 'SELL' : 'BUY';
    const effectiveSize = settings.position_size_pct ?? 5.0;
    
    // Find active strategy to tie trade to (or default)
    let strategyId = payload.strategyId;

    const fixedUsdt = payload.fixedUsdt ?? settings.trade_amount_usdt ?? null;
    const qty = await calcQtyForSymbol(base, prefix, symbol, price, effectiveSize, fixedUsdt);
    
    let order: Record<string, unknown> | null = null;
    let reason = 'Webhook triggered';

    // 2. Place entry order
    try {
      order = await signedPost(base, `${prefix}/order`, settings.binance_api_key, settings.binance_api_secret, {
        symbol: symbol, side, type: 'MARKET', quantity: String(qty),
      });
    } catch (e) {
      const errMsg = (e as Error).message;
      console.error(`[webhook] Order failed for ${symbol}: ${errMsg}`);
      reason += ` | Order Failed: ${errMsg}`;
    }

    const effectiveSL = settings.stop_loss_pct ?? 2.0;
    const effectiveTP = settings.take_profit_pct ?? 4.0;

    // 3. Place SL and TP for futures
    if (order && tradingMode === 'futures') {
      const slPrice = +(price * (side === 'BUY' ? (1 - effectiveSL / 100) : (1 + effectiveSL / 100))).toFixed(4);
      const tpPrice = +(price * (side === 'BUY' ? (1 + effectiveTP / 100) : (1 - effectiveTP / 100))).toFixed(4);

      try {
        await signedPost(base, `${prefix}/order`, settings.binance_api_key, settings.binance_api_secret, {
          symbol: symbol, side: closeSide, type: 'STOP_MARKET',
          stopPrice: String(slPrice), closePosition: 'true',
        });
      } catch (e) {
        console.error(`[webhook] SL order failed: ${(e as Error).message}`);
      }

      try {
        await signedPost(base, `${prefix}/order`, settings.binance_api_key, settings.binance_api_secret, {
          symbol: symbol, side: closeSide, type: 'TAKE_PROFIT_MARKET',
          stopPrice: String(tpPrice), closePosition: 'true',
        });
      } catch (e) {
        console.error(`[webhook] TP order failed: ${(e as Error).message}`);
      }
    }

    const ts = new Date().toISOString();

    // 4. Log trade
    if (order) {
      await client.from('trades').insert({
        user_id: settings.user_id, signal_id: null, symbol: symbol,
        direction: side.toLowerCase(),
        entry_price: price, quantity: qty,
        stop_loss: price * (1 - effectiveSL / 100),
        take_profit: price * (1 + effectiveTP / 100),
        status: 'open', binance_order_id: String(order.orderId ?? ''), opened_at: ts,
      });
    }

    // 5. Log signal
    await client.from('signals').insert({
      user_id: settings.user_id, strategy_id: strategyId || null, symbol: symbol,
      direction: side.toLowerCase(),
      confidence: 99, entry_price: price,
      stop_loss: price * (1 - effectiveSL / 100),
      take_profit: price * (1 + effectiveTP / 100),
      timeframe: 'Webhook', reason: reason, status: order ? 'executed' : 'cancelled',
    });

    return new Response(JSON.stringify({ success: true, message: 'Webhook processed', order }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
