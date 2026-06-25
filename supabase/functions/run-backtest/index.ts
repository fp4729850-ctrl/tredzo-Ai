const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const BINANCE_BASE = 'https://api.binance.com';
const KLINES_LIMIT = 1000; // Binance max per request
const MAX_CANDLES = 5000;  // Safety cap to avoid oversized payloads

// Map user-facing timeframe labels to Binance interval strings
const TF_TO_INTERVAL: Record<string, string> = {
  '1m': '1m', '5m': '5m', '15m': '15m',
  '1h': '1h', '4h': '4h', '1d': '1d',
};

// Milliseconds per bar, used to advance pagination cursor
const TF_MS: Record<string, number> = {
  '1m': 60_000, '5m': 300_000, '15m': 900_000,
  '1h': 3_600_000, '4h': 14_400_000, '1d': 86_400_000,
};

interface OHLCV {
  time: number; // unix ms
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

interface BacktestTrade {
  entry_time: string;
  exit_time: string;
  direction: 'buy' | 'sell';
  entry_price: number;
  exit_price: number;
  pnl: number;
  pnl_pct: number;
  duration_hours: number;
  exit_reason: 'tp' | 'sl' | 'signal';
}

interface EquityPoint {
  date: string;
  equity: number;
  drawdown: number;
}

/**
 * Fetch historical OHLCV candles from Binance public klines API.
 * Paginates automatically when the date range exceeds 1000 bars.
 */
async function fetchBinanceKlines(
  symbol: string,
  timeframe: string,
  startMs: number,
  endMs: number,
): Promise<OHLCV[]> {
  const interval = TF_TO_INTERVAL[timeframe];
  if (!interval) throw new Error(`Unsupported timeframe: ${timeframe}`);

  const barMs = TF_MS[timeframe];
  const allCandles: OHLCV[] = [];
  let cursorMs = startMs;

  while (cursorMs < endMs && allCandles.length < MAX_CANDLES) {
    const params = new URLSearchParams({
      symbol: symbol.toUpperCase(),
      interval,
      startTime: String(cursorMs),
      endTime: String(endMs),
      limit: String(KLINES_LIMIT),
    });

    const url = `${BINANCE_BASE}/api/v3/klines?${params}`;
    let res: Response;
    try {
      res = await fetch(url, { signal: AbortSignal.timeout(15_000) });
    } catch (fetchErr) {
      throw new Error(
        `Unable to reach Binance API. Please check your network and try again. (${fetchErr instanceof Error ? fetchErr.message : fetchErr})`
      );
    }

    if (!res.ok) {
      let detail = '';
      try { const body = await res.json(); detail = body?.msg ?? ''; } catch { /* ignore */ }
      throw new Error(
        `Binance API error ${res.status}${detail ? ': ' + detail : ''}. ` +
        `Verify the symbol "${symbol}" is correct and the date range is valid.`
      );
    }

    // Binance kline format: [openTime, open, high, low, close, volume, closeTime, ...]
    const rows: unknown[][] = await res.json();
    if (!Array.isArray(rows) || rows.length === 0) break;

    for (const row of rows) {
      allCandles.push({
        time:   Number(row[0]),
        open:   parseFloat(row[1] as string),
        high:   parseFloat(row[2] as string),
        low:    parseFloat(row[3] as string),
        close:  parseFloat(row[4] as string),
        volume: parseFloat(row[5] as string),
      });
    }

    // Advance cursor past the last returned candle
    const lastTime = Number(rows[rows.length - 1][0]);
    cursorMs = lastTime + barMs;

    // Stop if Binance returned fewer rows than the limit (no more data)
    if (rows.length < KLINES_LIMIT) break;

    // Brief pause to be polite to the public API
    await new Promise(r => setTimeout(r, 120));
  }

  return allCandles;
}

// Simple indicator calculations
function calcRSI(closes: number[], period = 14): number[] {
  const rsi: number[] = new Array(period).fill(50);
  for (let i = period; i < closes.length; i++) {
    let gains = 0, losses = 0;
    for (let j = i - period + 1; j <= i; j++) {
      const d = closes[j] - closes[j - 1];
      if (d > 0) gains += d; else losses -= d;
    }
    const rs = losses === 0 ? 100 : gains / losses;
    rsi.push(100 - 100 / (1 + rs));
  }
  return rsi;
}

function calcEMA(closes: number[], period: number): number[] {
  const k = 2 / (period + 1);
  const ema: number[] = [closes[0]];
  for (let i = 1; i < closes.length; i++) {
    ema.push(closes[i] * k + ema[i - 1] * (1 - k));
  }
  return ema;
}

function runBacktest(
  candles: OHLCV[],
  stopLossPct: number,
  takeProfitPct: number,
  positionSizePct: number
): { trades: BacktestTrade[]; equityCurve: EquityPoint[] } {
  const closes = candles.map(c => c.close);
  const rsi = calcRSI(closes, 14);
  const ema20 = calcEMA(closes, 20);
  const ema50 = calcEMA(closes, 50);

  const trades: BacktestTrade[] = [];
  const equityCurve: EquityPoint[] = [];
  let equity = 10000;
  let peak = equity;
  let inTrade = false;
  let entryPrice = 0;
  let entryTime = 0;
  let tradeDirection: 'buy' | 'sell' = 'buy';

  const sl = stopLossPct / 100;
  const tp = takeProfitPct / 100;

  for (let i = 51; i < candles.length; i++) {
    const bar = candles[i];
    const date = new Date(bar.time).toISOString().slice(0, 10);

    if (!inTrade) {
      // Long entry: RSI crosses above 30 (oversold) + EMA20 > EMA50
      const longEntry = rsi[i - 1] < 30 && rsi[i] >= 30 && ema20[i] > ema50[i];
      // Short entry: RSI crosses below 70 (overbought) + EMA20 < EMA50
      const shortEntry = rsi[i - 1] > 70 && rsi[i] <= 70 && ema20[i] < ema50[i];

      if (longEntry) {
        inTrade = true;
        entryPrice = bar.close;
        entryTime = bar.time;
        tradeDirection = 'buy';
      } else if (shortEntry) {
        inTrade = true;
        entryPrice = bar.close;
        entryTime = bar.time;
        tradeDirection = 'sell';
      }
    } else {
      const priceMoveRatio = tradeDirection === 'buy'
        ? (bar.close - entryPrice) / entryPrice
        : (entryPrice - bar.close) / entryPrice;

      let exitPrice = 0;
      let exitReason: 'tp' | 'sl' | 'signal' = 'signal';
      let shouldExit = false;

      // Check SL/TP using high/low for realism
      if (tradeDirection === 'buy') {
        if (bar.low <= entryPrice * (1 - sl)) { exitPrice = entryPrice * (1 - sl); exitReason = 'sl'; shouldExit = true; }
        else if (bar.high >= entryPrice * (1 + tp)) { exitPrice = entryPrice * (1 + tp); exitReason = 'tp'; shouldExit = true; }
      } else {
        if (bar.high >= entryPrice * (1 + sl)) { exitPrice = entryPrice * (1 + sl); exitReason = 'sl'; shouldExit = true; }
        else if (bar.low <= entryPrice * (1 - tp)) { exitPrice = entryPrice * (1 - tp); exitReason = 'tp'; shouldExit = true; }
      }

      // Signal-based exit
      if (!shouldExit) {
        const exitLong = tradeDirection === 'buy' && rsi[i] > 65;
        const exitShort = tradeDirection === 'sell' && rsi[i] < 35;
        if (exitLong || exitShort) { exitPrice = bar.close; shouldExit = true; exitReason = 'signal'; }
      }

      if (shouldExit) {
        const pnlPct = tradeDirection === 'buy'
          ? (exitPrice - entryPrice) / entryPrice * 100
          : (entryPrice - exitPrice) / entryPrice * 100;
        const posValue = equity * (positionSizePct / 100);
        const pnl = posValue * (pnlPct / 100);
        const durationHours = (bar.time - entryTime) / (1000 * 60 * 60);

        equity += pnl;
        if (equity > peak) peak = equity;

        trades.push({
          entry_time: new Date(entryTime).toISOString(),
          exit_time: bar.time === entryTime ? new Date(bar.time + 60000).toISOString() : new Date(bar.time).toISOString(),
          direction: tradeDirection,
          entry_price: +entryPrice.toFixed(6),
          exit_price: +exitPrice.toFixed(6),
          pnl: +pnl.toFixed(2),
          pnl_pct: +pnlPct.toFixed(2),
          duration_hours: +durationHours.toFixed(2),
          exit_reason: exitReason,
        });
        inTrade = false;
      }
    }

    // Sample equity every ~20 bars to keep payload manageable
    if (i % 20 === 0 || i === candles.length - 1) {
      const drawdown = peak > 0 ? ((peak - equity) / peak) * 100 : 0;
      equityCurve.push({ date, equity: +equity.toFixed(2), drawdown: +drawdown.toFixed(2) });
    }
  }

  return { trades, equityCurve };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

  try {
    const {
      strategyId,
      symbol = 'BTCUSDT',
      startDate,
      endDate,
      timeframe = '1h',
      stopLossPct = 2,
      takeProfitPct = 4,
      positionSizePct = 10,
    } = await req.json();

    if (!startDate || !endDate) {
      return new Response(JSON.stringify({ error: 'startDate and endDate are required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    const startMs = new Date(startDate).getTime();
    const endMs   = new Date(endDate + 'T23:59:59Z').getTime();

    if (endMs <= startMs) {
      return new Response(JSON.stringify({ error: 'endDate must be after startDate' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    // ── Fetch real Binance historical klines ──────────────────────────────────
    console.log(`Fetching Binance klines: ${symbol} ${timeframe} ${startDate}→${endDate}`);
    const candles = await fetchBinanceKlines(symbol, timeframe, startMs, endMs);
    console.log(`Fetched ${candles.length} candles from Binance`);

    if (candles.length < 60) {
      return new Response(
        JSON.stringify({
          error: `Only ${candles.length} candles returned — need at least 60. ` +
                 `Try a wider date range or a smaller timeframe.`,
        }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Run backtest simulation
    const { trades, equityCurve } = runBacktest(candles, stopLossPct, takeProfitPct, positionSizePct);

    // Compute metrics
    const wins = trades.filter(t => t.pnl > 0);
    const losses = trades.filter(t => t.pnl <= 0);
    const totalPnl = trades.reduce((s, t) => s + t.pnl, 0);
    const initialEquity = 10000;
    const finalEquity = initialEquity + totalPnl;
    const totalReturnPct = ((finalEquity - initialEquity) / initialEquity) * 100;

    const maxDrawdownPct = equityCurve.length > 0
      ? Math.max(...equityCurve.map(e => e.drawdown))
      : 0;

    // Simplified Sharpe: avg daily return / std dev
    const dailyReturns = equityCurve.slice(1).map((e, i) =>
      (e.equity - equityCurve[i].equity) / equityCurve[i].equity * 100
    );
    const avgReturn = dailyReturns.length > 0
      ? dailyReturns.reduce((s, r) => s + r, 0) / dailyReturns.length : 0;
    const stdDev = dailyReturns.length > 1
      ? Math.sqrt(dailyReturns.reduce((s, r) => s + (r - avgReturn) ** 2, 0) / (dailyReturns.length - 1)) : 1;
    const sharpeRatio = stdDev > 0 ? (avgReturn / stdDev) * Math.sqrt(252) : 0;

    const avgDuration = trades.length > 0
      ? trades.reduce((s, t) => s + t.duration_hours, 0) / trades.length : 0;

    // Downsample OHLCV to max 500 candles for the candlestick chart payload
    const OHLCV_SAMPLE_MAX = 500;
    const step = Math.max(1, Math.floor(candles.length / OHLCV_SAMPLE_MAX));
    const ohlcvSample = candles
      .filter((_, i) => i % step === 0 || i === candles.length - 1)
      .slice(0, OHLCV_SAMPLE_MAX)
      .map(c => ({
        time: Math.floor(c.time / 1000), // lightweight-charts expects seconds
        open: c.open,
        high: c.high,
        low: c.low,
        close: c.close,
        volume: c.volume,
      }));

    const result = {
      symbol,
      timeframe,
      startDate,
      endDate,
      totalCandles: candles.length,
      metrics: {
        total_trades: trades.length,
        win_trades: wins.length,
        loss_trades: losses.length,
        win_rate: trades.length > 0 ? (wins.length / trades.length) * 100 : 0,
        total_return_pct: +totalReturnPct.toFixed(2),
        total_pnl: +totalPnl.toFixed(2),
        max_drawdown_pct: +maxDrawdownPct.toFixed(2),
        sharpe_ratio: +sharpeRatio.toFixed(2),
        avg_trade_duration_hours: +avgDuration.toFixed(2),
        initial_equity: initialEquity,
        final_equity: +finalEquity.toFixed(2),
      },
      equity_curve: equityCurve,
      trade_list: trades.slice(0, 500),
      ohlcv_sample: ohlcvSample,
    };

    return new Response(JSON.stringify(result),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

  } catch (err) {
    console.error('Backtest error:', err);
    return new Response(JSON.stringify({ error: err instanceof Error ? err.message : 'Backtest failed' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }
});
