const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

/* ────────────────────────────────────────────────
   Binance Trading Edge Function v2
   Supports: test-connection | balance | create-order |
             get-order | open-orders | cancel-order
   Spot Testnet:    https://testnet.binance.vision
   Spot Real:       https://api.binance.com
   Futures Testnet: https://testnet.binancefuture.com
   Futures Real:    https://fapi.binance.com
   ──────────────────────────────────────────────── */

import { createClient } from 'npm:@supabase/supabase-js@2';

const BASE_SPOT_REAL    = 'https://api.binance.com';
const BASE_SPOT_TEST    = 'https://testnet.binance.vision';
const BASE_FUTURES_REAL = 'https://fapi.binance.com';
const BASE_FUTURES_TEST = 'https://testnet.binancefuture.com';
const RECV_WINDOW = '5000';

/* eslint-disable @typescript-eslint/no-explicit-any */

interface BinanceRequest {
  action: 'test-connection' | 'balance' | 'create-order' | 'get-order' | 'open-orders' | 'cancel-order';
  testnet?: boolean;
  tradingMode?: 'spot' | 'futures';
  symbol?: string;
  side?: 'BUY' | 'SELL';
  type?: 'MARKET' | 'LIMIT';
  quantity?: number;
  price?: number;
  orderId?: number;
}

/** Returns correct base URL + API path prefix based on mode */
function resolveBase(testnet: boolean, tradingMode: 'spot' | 'futures'): { base: string; prefix: string } {
  if (tradingMode === 'futures') {
    return {
      base: testnet ? BASE_FUTURES_TEST : BASE_FUTURES_REAL,
      prefix: '/fapi/v1',
    };
  }
  return {
    base: testnet ? BASE_SPOT_TEST : BASE_SPOT_REAL,
    prefix: '/api/v3',
  };
}

async function hmacSha256Hex(secret: string, message: string): Promise<string> {
  const encoder = new TextEncoder();
  const keyData = encoder.encode(secret);
  const msgData = encoder.encode(message);
  const cryptoKey = await crypto.subtle.importKey(
    'raw', keyData, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'],
  );
  const signature = await crypto.subtle.sign('HMAC', cryptoKey, msgData);
  return Array.from(new Uint8Array(signature))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}

async function signedFetch(
  url: string,
  apiKey: string,
  apiSecret: string,
  params: Record<string, string>,
  method: 'GET' | 'POST' | 'DELETE' = 'GET',
) {
  const timestamp = Date.now().toString();
  const allParams = { ...params, recvWindow: RECV_WINDOW, timestamp };
  const query = new URLSearchParams(allParams).toString();
  const signature = await hmacSha256Hex(apiSecret, query);
  const fullUrl = `${url}?${query}&signature=${signature}`;

  const res = await fetch(fullUrl, {
    method,
    headers: {
      'X-MBX-APIKEY': apiKey,
      'Content-Type': 'application/json',
    },
  });

  const text = await res.text();
  let json: any = null;
  try { json = JSON.parse(text); } catch { /* raw text */ }

  if (!res.ok) {
    const msg = json?.msg || text || `HTTP ${res.status}`;
    throw new Error(msg);
  }
  return json ?? text;
}

/* ─── Service-role helper to read user_settings ─── */
function getServiceClient() {
  const url = Deno.env.get('SUPABASE_URL');
  const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!url || !key) throw new Error('Supabase service credentials missing');
  return createClient(url, key);
}

async function getUserApiKeys(userId: string) {
  const sb = getServiceClient();
  const { data, error } = await sb
    .from('user_settings')
    .select('binance_api_key, binance_api_secret, trading_mode, use_testnet')
    .eq('user_id', userId)
    .maybeSingle();
  if (error) throw new Error(`Failed to load user settings: ${error.message}`);
  if (!data?.binance_api_key || !data?.binance_api_secret) {
    throw new Error('Binance API key/secret not configured. Go to Settings → Binance API.');
  }
  return {
    key: data.binance_api_key,
    secret: data.binance_api_secret,
    tradingMode: (data.trading_mode ?? 'spot') as 'spot' | 'futures',
    useTestnet: data.use_testnet ?? true,
  };
}

/* ─── Handlers ─── */
async function handleTestConnection(
  apiKey: string, apiSecret: string, testnet: boolean, tradingMode: 'spot' | 'futures',
) {
  // Always validate key against Spot account first (same key works for both spot+futures)
  // Spot endpoint is more permissive and works for API key validation
  const spotBase = testnet ? BASE_SPOT_TEST : BASE_SPOT_REAL;

  let spotRes: any = null;
  let spotError: string | null = null;
  try {
    spotRes = await signedFetch(`${spotBase}/api/v3/account`, apiKey, apiSecret, {});
  } catch (e: any) {
    spotError = e.message;
  }

  // If spot validation failed, throw with helpful message
  if (spotError) {
    if (spotError.includes('451') || spotError.includes('Unavailable For Legal Reasons')) {
      throw new Error('Binance API geo-restricted from this server region. Trade execution will work normally from your local browser.');
    }
    if (spotError.includes('Invalid API-key') || spotError.includes('API-key format invalid')) {
      throw new Error('Invalid API key — double-check the key copied from Binance.');
    }
    if (spotError.includes('IP')) {
      throw new Error('IP not whitelisted — go to Binance → API Management → edit your key → remove IP restriction or add this server IP.');
    }
    throw new Error(spotError);
  }

  // For futures mode, also try futures account to get balance info
  let futuresSummary: any = null;
  if (tradingMode === 'futures') {
    const futBase = testnet ? BASE_FUTURES_TEST : BASE_FUTURES_REAL;
    try {
      const fRes = await signedFetch(`${futBase}/fapi/v1/account`, apiKey, apiSecret, {});
      futuresSummary = {
        totalWalletBalance: fRes.totalWalletBalance,
        availableBalance: fRes.availableBalance,
      };
    } catch {
      // Futures endpoint may still geo-block; key is still valid (spot check passed)
      futuresSummary = null;
    }
  }

  return {
    success: true,
    mode: testnet ? 'testnet' : 'real',
    tradingMode,
    accountType: tradingMode === 'futures' ? 'FUTURES' : (spotRes?.accountType ?? 'SPOT'),
    summary: tradingMode === 'futures' && futuresSummary
      ? futuresSummary
      : { balances: (spotRes?.balances || []).filter((b: any) => parseFloat(b.free) > 0).slice(0, 5) },
  };
}

async function handleBalance(apiKey: string, apiSecret: string, testnet: boolean, tradingMode: 'spot' | 'futures') {
  const { base, prefix } = resolveBase(testnet, tradingMode);
  const res = await signedFetch(`${base}${prefix}/account`, apiKey, apiSecret, {});
  if (tradingMode === 'futures') {
    return {
      tradingMode,
      totalWalletBalance: res.totalWalletBalance,
      availableBalance: res.availableBalance,
      assets: (res.assets || []).filter((a: any) => parseFloat(a.walletBalance) > 0),
    };
  }
  const nonzero = (res.balances || []).filter((b: any) => parseFloat(b.free) > 0 || parseFloat(b.locked) > 0);
  return { tradingMode, balances: nonzero };
}

async function handleCreateOrder(
  apiKey: string, apiSecret: string, testnet: boolean, tradingMode: 'spot' | 'futures', body: any,
) {
  const { base, prefix } = resolveBase(testnet, tradingMode);
  const params: Record<string, string> = {
    symbol: body.symbol!.toUpperCase(),
    side: body.side!,
    type: body.type ?? 'MARKET',
    quantity: String(body.quantity!),
  };
  if (body.type === 'LIMIT' && body.price) {
    params.price = String(body.price);
    params.timeInForce = 'GTC';
  }
  // Futures requires positionSide for hedge mode (default: BOTH for one-way mode)
  if (tradingMode === 'futures') {
    params.positionSide = 'BOTH';
  }
  const res = await signedFetch(`${base}${prefix}/order`, apiKey, apiSecret, params, 'POST');
  return { order: res, tradingMode };
}

async function handleGetOrder(
  apiKey: string, apiSecret: string, testnet: boolean, tradingMode: 'spot' | 'futures', body: any,
) {
  const { base, prefix } = resolveBase(testnet, tradingMode);
  const params: Record<string, string> = {
    symbol: body.symbol!.toUpperCase(),
    orderId: String(body.orderId!),
  };
  const res = await signedFetch(`${base}${prefix}/order`, apiKey, apiSecret, params);
  return { order: res };
}

async function handleOpenOrders(
  apiKey: string, apiSecret: string, testnet: boolean, tradingMode: 'spot' | 'futures', body: any,
) {
  const { base, prefix } = resolveBase(testnet, tradingMode);
  const params: Record<string, string> = {};
  if (body.symbol) params.symbol = body.symbol.toUpperCase();
  const res = await signedFetch(`${base}${prefix}/openOrders`, apiKey, apiSecret, params);
  return { orders: res };
}

async function handleCancelOrder(
  apiKey: string, apiSecret: string, testnet: boolean, tradingMode: 'spot' | 'futures', body: any,
) {
  const { base, prefix } = resolveBase(testnet, tradingMode);
  const params: Record<string, string> = {
    symbol: body.symbol!.toUpperCase(),
    orderId: String(body.orderId!),
  };
  const res = await signedFetch(`${base}${prefix}/order`, apiKey, apiSecret, params, 'DELETE');
  return { order: res };
}

function jsonResponse(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

/* ─── Deno handler ─── */
Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  let body: BinanceRequest;
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON body' }), {
      status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  const authHeader = req.headers.get('authorization') || '';
  const token = authHeader.replace('Bearer ', '');
  if (!token) {
    return new Response(JSON.stringify({ error: 'Missing authorization token' }), {
      status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  /* Decode JWT to get user id (no verification needed — Supabase proxy already validated) */
  let userId = '';
  try {
    const payload = JSON.parse(atob(token.split('.')[1]));
    userId = payload.sub;
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid token' }), {
      status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  try {
    const { key, secret, useTestnet, tradingMode: dbTradingMode } = await getUserApiKeys(userId);
    const testnet = body.testnet ?? useTestnet ?? true; // default safe: testnet
    const tradingMode = body.tradingMode ?? dbTradingMode ?? 'spot';

    switch (body.action) {
      case 'test-connection':
        return jsonResponse(await handleTestConnection(key, secret, testnet, tradingMode));
      case 'balance':
        return jsonResponse(await handleBalance(key, secret, testnet, tradingMode));
      case 'create-order':
        return jsonResponse(await handleCreateOrder(key, secret, testnet, tradingMode, body));
      case 'get-order':
        return jsonResponse(await handleGetOrder(key, secret, testnet, tradingMode, body));
      case 'open-orders':
        return jsonResponse(await handleOpenOrders(key, secret, testnet, tradingMode, body));
      case 'cancel-order':
        return jsonResponse(await handleCancelOrder(key, secret, testnet, tradingMode, body));
      default:
        return jsonResponse({ error: `Unknown action: ${body.action}` }, 400);
    }
  } catch (err: any) {
    return jsonResponse({ error: err.message || 'Binance API error' }, 400);
  }
});

