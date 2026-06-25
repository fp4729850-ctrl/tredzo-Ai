const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

/* ────────────────────────────────────────────────
   Binance Trading Edge Function
   Supports: test-connection | balance | create-order |
             get-order | open-orders | cancel-order
   Testnet: https://testnet.binance.vision
   Real:    https://api.binance.com
   ──────────────────────────────────────────────── */

import { createClient } from 'npm:@supabase/supabase-js@2';

const BASE_REAL = 'https://api.binance.com';
const BASE_TEST = 'https://testnet.binance.vision';
const RECV_WINDOW = '5000';

/* eslint-disable @typescript-eslint/no-explicit-any */

interface BinanceRequest {
  action: 'test-connection' | 'balance' | 'create-order' | 'get-order' | 'open-orders' | 'cancel-order';
  testnet?: boolean;
  symbol?: string;
  side?: 'BUY' | 'SELL';
  type?: 'MARKET' | 'LIMIT';
  quantity?: number;
  price?: number;
  orderId?: number;
}

function baseUrl(testnet: boolean) {
  return testnet ? BASE_TEST : BASE_REAL;
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
  apiKey: string, apiSecret: string, testnet: boolean,
) {
  const base = baseUrl(testnet);
  const res = await signedFetch(`${base}/api/v3/account`, apiKey, apiSecret, {});
  return {
    success: true,
    mode: testnet ? 'testnet' : 'real',
    accountType: res.accountType ?? 'unknown',
    balances: (res.balances || []).slice(0, 5),
  };
}

async function handleBalance(apiKey: string, apiSecret: string, testnet: boolean) {
  const base = baseUrl(testnet);
  const res = await signedFetch(`${base}/api/v3/account`, apiKey, apiSecret, {});
  const nonzero = (res.balances || []).filter((b: any) => parseFloat(b.free) > 0 || parseFloat(b.locked) > 0);
  return { balances: nonzero };
}

async function handleCreateOrder(
  apiKey: string, apiSecret: string, testnet: boolean, body: any,
) {
  const base = baseUrl(testnet);
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
  const res = await signedFetch(`${base}/api/v3/order`, apiKey, apiSecret, params, 'POST');
  return { order: res };
}

async function handleGetOrder(
  apiKey: string, apiSecret: string, testnet: boolean, body: any,
) {
  const base = baseUrl(testnet);
  const params: Record<string, string> = {
    symbol: body.symbol!.toUpperCase(),
    orderId: String(body.orderId!),
  };
  const res = await signedFetch(`${base}/api/v3/order`, apiKey, apiSecret, params);
  return { order: res };
}

async function handleOpenOrders(
  apiKey: string, apiSecret: string, testnet: boolean, body: any,
) {
  const base = baseUrl(testnet);
  const params: Record<string, string> = {};
  if (body.symbol) params.symbol = body.symbol.toUpperCase();
  const res = await signedFetch(`${base}/api/v3/openOrders`, apiKey, apiSecret, params);
  return { orders: res };
}

async function handleCancelOrder(
  apiKey: string, apiSecret: string, testnet: boolean, body: any,
) {
  const base = baseUrl(testnet);
  const params: Record<string, string> = {
    symbol: body.symbol!.toUpperCase(),
    orderId: String(body.orderId!),
  };
  const res = await signedFetch(`${base}/api/v3/order`, apiKey, apiSecret, params, 'DELETE');
  return { order: res };
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
    const { key, secret, useTestnet } = await getUserApiKeys(userId);
    const testnet = body.testnet ?? useTestnet ?? true; // default safe: testnet

    switch (body.action) {
      case 'test-connection':
        return jsonResponse(await handleTestConnection(key, secret, testnet));
      case 'balance':
        return jsonResponse(await handleBalance(key, secret, testnet));
      case 'create-order':
        return jsonResponse(await handleCreateOrder(key, secret, testnet, body));
      case 'get-order':
        return jsonResponse(await handleGetOrder(key, secret, testnet, body));
      case 'open-orders':
        return jsonResponse(await handleOpenOrders(key, secret, testnet, body));
      case 'cancel-order':
        return jsonResponse(await handleCancelOrder(key, secret, testnet, body));
      default:
        return jsonResponse({ error: `Unknown action: ${body.action}` }, 400);
    }
  } catch (err: any) {
    return jsonResponse({ error: err.message || 'Binance API error' }, 400);
  }
});

function jsonResponse(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}
