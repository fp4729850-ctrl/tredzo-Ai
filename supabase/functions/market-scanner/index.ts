import { createClient } from 'jsr:@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const BINANCE_BASE = 'https://api.binance.com';

interface BinanceTicker {
  symbol: string;
  lastPrice: string;
  priceChangePercent: string;
  quoteVolume: string;
  highPrice: string;
  lowPrice: string;
  volume: string;
}

interface ScanItem {
  id: string;
  symbol: string;
  price: number;
  change_pct_24h: number;
  volume_24h: number;
  scan_type: 'gainer' | 'loser';
  signal_direction: 'buy' | 'sell';
  confidence: number;
  timeframe: string;
  scanned_at: string;
}

/** Compute a simple confidence score (55–95) based on change magnitude and volume */
function confidence(changePct: number, volume: number): number {
  const changeFactor = Math.min(Math.abs(changePct) / 20, 1) * 30; // 0-30
  const volumeFactor = Math.min(volume / 1e9, 1) * 15;             // 0-15 (capped at $1B)
  return Math.round(55 + changeFactor + volumeFactor);
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

  try {
    const body = await req.json().catch(() => ({}));
    const timeframe: string = body.timeframe ?? '1h';

    /* ─── Fetch real Binance 24hr tickers (public endpoint, no auth required) ─── */
    let tickers: BinanceTicker[] = [];
    try {
      const res = await fetch(`${BINANCE_BASE}/api/v3/ticker/24hr`, {
        signal: AbortSignal.timeout(10_000),
      });
      if (!res.ok) throw new Error(`Binance HTTP ${res.status}`);
      tickers = await res.json();
    } catch (e) {
      // If Binance is unreachable (e.g. region block), fall back gracefully
      return new Response(
        JSON.stringify({ error: `Binance API unreachable: ${(e as Error).message}` }),
        { status: 502, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    /* ─── Filter to active USDT spot pairs with decent volume ─── */
    const usdtPairs = tickers.filter(t =>
      t.symbol.endsWith('USDT') &&
      parseFloat(t.quoteVolume) > 1_000_000 // > $1M 24h volume
    );

    const sorted = usdtPairs.sort((a, b) =>
      parseFloat(b.priceChangePercent) - parseFloat(a.priceChangePercent)
    );

    const scannedAt = new Date().toISOString();

    const toScanItem = (t: BinanceTicker, type: 'gainer' | 'loser', idx: number): ScanItem => {
      const price = parseFloat(t.lastPrice);
      const changePct = parseFloat(t.priceChangePercent);
      const volume = parseFloat(t.quoteVolume);
      return {
        id: `${type}-${idx}`,
        symbol: t.symbol,
        price,
        change_pct_24h: +changePct.toFixed(2),
        volume_24h: +volume.toFixed(0),
        scan_type: type,
        signal_direction: type === 'gainer' ? 'sell' : 'buy',
        confidence: confidence(changePct, volume),
        timeframe,
        scanned_at: scannedAt,
      };
    };

    const gainers: ScanItem[] = sorted.slice(0, 15).map((t, i) => toScanItem(t, 'gainer', i));
    const losers: ScanItem[] = sorted.slice(-15).reverse().map((t, i) => toScanItem(t, 'loser', i));

    const totalSignals = [...gainers, ...losers].filter(s => s.confidence >= 70).length;

    /* ─── Persist to market_scans table (best-effort) ─── */
    try {
      const sb = createClient(
        Deno.env.get('SUPABASE_URL') ?? '',
        Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
      );
      await sb.from('market_scans').insert([...gainers, ...losers].map(s => ({
        symbol: s.symbol,
        price: s.price,
        change_pct_24h: s.change_pct_24h,
        volume_24h: s.volume_24h,
        scan_type: s.scan_type,
        signal_direction: s.signal_direction,
        confidence: s.confidence,
        timeframe: s.timeframe,
        scanned_at: s.scanned_at,
      })));
    } catch { /* non-fatal */ }

    return new Response(
      JSON.stringify({ gainers, losers, totalSignals, timeframe, source: 'binance_live' }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (err) {
    return new Response(
      JSON.stringify({ error: err instanceof Error ? err.message : 'Unknown error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});

