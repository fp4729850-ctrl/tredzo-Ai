import { serve } from "https://deno.land/std@0.192.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { crypto } from "https://deno.land/std@0.192.0/crypto/mod.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const BINANCE_FUTURES_BASE = 'https://fapi.binance.com';
const RECV_WINDOW = '5000';

async function hmacSha256(secret: string, msg: string): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(msg));
  return Array.from(new Uint8Array(sig)).map(b => b.toString(16).padStart(2, '0')).join('');
}

async function signedGet(base: string, path: string, apiKey: string, secret: string, params: Record<string, string>) {
  const ts = Date.now().toString();
  const all = { ...params, recvWindow: RECV_WINDOW, timestamp: ts };
  const qs = new URLSearchParams(all).toString();
  const sig = await hmacSha256(secret, qs);
  const res = await fetch(`${base}${path}?${qs}&signature=${sig}`, {
    method: 'GET',
    headers: { 'X-MBX-APIKEY': apiKey },
  });
  const j = await res.json();
  if (!res.ok) throw new Error(j.msg || `HTTP ${res.status}`);
  return j;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) throw new Error('Missing Authorization header');

    const sbClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_ANON_KEY') ?? '',
      { global: { headers: { Authorization: authHeader } } }
    );
    const { data: { user }, error: authError } = await sbClient.auth.getUser();
    if (authError || !user) throw new Error('Unauthorized');

    const sbAdmin = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    // Fetch user settings for API keys
    const { data: settings } = await sbAdmin
      .from('user_settings')
      .select('binance_api_key, binance_api_secret, use_testnet')
      .eq('user_id', user.id)
      .maybeSingle();

    if (!settings?.binance_api_key || !settings?.binance_api_secret) {
      return new Response(JSON.stringify({ positions: [] }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    const base = settings.use_testnet ? 'https://testnet.binancefuture.com' : BINANCE_FUTURES_BASE;
    
    // Fetch all positions from Binance
    const positions = await signedGet(base, '/fapi/v2/positionRisk', settings.binance_api_key, settings.binance_api_secret, {});
    
    // Filter to only include open positions (quantity != 0)
    const openPositions = positions.filter((p: any) => parseFloat(p.positionAmt) !== 0);

    return new Response(JSON.stringify({ positions: openPositions }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (error) {
    return new Response(JSON.stringify({ error: (error as Error).message }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
