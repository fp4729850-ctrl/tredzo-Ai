import { createClient } from 'npm:@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const BINANCE_FUTURES_REAL = 'https://fapi.binance.com';
const BINANCE_FUTURES_TEST = 'https://testnet.binancefuture.com';

async function hmacSha256Hex(secret: string, message: string): Promise<string> {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const signature = await crypto.subtle.sign('HMAC', key, encoder.encode(message));
  return Array.from(new Uint8Array(signature)).map(b => b.toString(16).padStart(2, '0')).join('');
}

async function signedBinanceFetch(base: string, path: string, apiKey: string, apiSecret: string, params: Record<string, string> = {}) {
  const timestamp = Date.now().toString();
  const queryParams = new URLSearchParams({ ...params, recvWindow: '5000', timestamp });
  const signature = await hmacSha256Hex(apiSecret, queryParams.toString());
  const url = `${base}${path}?${queryParams.toString()}&signature=${signature}`;

  const res = await fetch(url, {
    method: 'GET',
    headers: { 'X-MBX-APIKEY': apiKey },
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Binance error: ${text}`);
  }
  return res.json();
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) throw new Error('Missing Authorization header');

    const sbClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_ANON_KEY') ?? '',
      { global: { headers: { Authorization: authHeader } } }
    );
    const { data: { user }, error: authErr } = await sbClient.auth.getUser();
    if (authErr || !user) throw new Error('Unauthorized');

    const sbAdmin = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    // Get user settings
    const { data: settings } = await sbAdmin
      .from('user_settings')
      .select('binance_api_key, binance_api_secret, use_testnet')
      .eq('user_id', user.id)
      .single();

    if (!settings?.binance_api_key || !settings?.binance_api_secret) {
      throw new Error('Binance API keys not configured');
    }

    const isTestnet = settings.use_testnet ?? false;
    const base = isTestnet ? BINANCE_FUTURES_TEST : BINANCE_FUTURES_REAL;

    // Get open trades
    const { data: openTrades } = await sbAdmin
      .from('trades')
      .select('*')
      .eq('user_id', user.id)
      .eq('status', 'open');

    if (!openTrades || openTrades.length === 0) {
      return new Response(JSON.stringify({ success: true, message: 'No open trades to sync', synced: 0 }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    let syncedCount = 0;

    for (const trade of openTrades) {
      try {
        const symbol = trade.symbol.toUpperCase();
        // Give a little buffer (e.g. -5000ms) to ensure we don't miss the execution due to slight time drifts
        const startTime = new Date(trade.opened_at).getTime() - 5000;
        
        // Fetch user trades for this symbol
        const tradesFromBinance = await signedBinanceFetch(base, '/fapi/v1/userTrades', settings.binance_api_key, settings.binance_api_secret, {
          symbol,
          startTime: startTime.toString(),
          limit: '100'
        });

        // Closing side is opposite to entry direction
        const closeSide = trade.direction === 'buy' ? 'SELL' : 'BUY';
        const closingTrades = tradesFromBinance.filter((t: any) => t.side === closeSide);

        if (closingTrades.length > 0) {
          // Calculate total closed qty
          const totalClosedQty = closingTrades.reduce((sum: number, t: any) => sum + parseFloat(t.qty), 0);
          
          // We consider the position closed if we have closed at least 95% of the qty 
          // (sometimes exact floating point matching can fail)
          if (totalClosedQty >= trade.quantity * 0.95) {
            const totalRealizedPnl = closingTrades.reduce((sum: number, t: any) => sum + parseFloat(t.realizedPnl), 0);
            
            let totalValue = 0;
            closingTrades.forEach((t: any) => {
              totalValue += parseFloat(t.price) * parseFloat(t.qty);
            });
            const avgExitPrice = totalValue / totalClosedQty;

            const closedAtTime = Math.max(...closingTrades.map((t: any) => t.time));
            const pnlPct = (totalRealizedPnl / (trade.quantity * trade.entry_price)) * 100;

            await sbAdmin.from('trades').update({
              status: 'closed',
              exit_price: avgExitPrice,
              pnl: totalRealizedPnl,
              pnl_pct: pnlPct,
              closed_at: new Date(closedAtTime).toISOString()
            }).eq('id', trade.id);

            syncedCount++;
          }
        }
      } catch (err) {
        console.error(`Error syncing trade ${trade.id}:`, err);
      }
    }

    return new Response(JSON.stringify({ success: true, message: `Synced ${syncedCount} trades`, synced: syncedCount }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });

  } catch (e) {
    const err = e as Error;
    return new Response(JSON.stringify({ success: false, error: err.message }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
});
