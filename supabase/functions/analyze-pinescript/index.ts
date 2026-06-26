import { createClient } from 'jsr:@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface StrategyParams {
  rsi_length: number;
  overbought: number;
  oversold: number;
  ema_fast: number;
  ema_slow: number;
  symbol: string;
  timeframe: string | null;
  has_stop_loss: boolean;
  has_take_profit: boolean;
  trade_direction: 'long' | 'short' | 'both';
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

  try {
    const { strategyId, code } = await req.json();

    if (!code) {
      return new Response(
        JSON.stringify({ error: 'PineScript code is required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const params = extractParams(code);
    const risk = extractRiskPct(code);
    const interpretation = buildInterpretation(code, params, risk);

    if (strategyId) {
      const supabase = createClient(
        Deno.env.get('SUPABASE_URL') ?? '',
        Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
      );
      const update: Record<string, unknown> = { ai_interpretation: interpretation, strategy_params: params };
      if (risk.stop_loss_pct !== null) update.stop_loss_pct = risk.stop_loss_pct;
      if (risk.take_profit_pct !== null) update.take_profit_pct = risk.take_profit_pct;
      if (risk.position_size_pct !== null) update.position_size_pct = risk.position_size_pct;
      if (risk.tp1_pct !== null) update.tp1_pct = risk.tp1_pct;
      if (risk.tp2_pct !== null) update.tp2_pct = risk.tp2_pct;
      if (risk.tp3_pct !== null) update.tp3_pct = risk.tp3_pct;
      if (risk.tp1_size_pct !== null) update.tp1_size_pct = risk.tp1_size_pct;
      if (risk.tp2_size_pct !== null) update.tp2_size_pct = risk.tp2_size_pct;
      if (risk.tp3_size_pct !== null) update.tp3_size_pct = risk.tp3_size_pct;
      // Save extracted timeframe to top-level column
      if (params.timeframe) update.timeframe = params.timeframe;
      await supabase.from('strategies').update(update).eq('id', strategyId);
    }

    return new Response(
      JSON.stringify({ interpretation, params, risk }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (err) {
    return new Response(
      JSON.stringify({ error: err instanceof Error ? err.message : 'Analysis failed' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});

/** Extract numeric parameters from PineScript using regex patterns */
function extractParams(code: string): StrategyParams {
  const num = (pattern: RegExp, fallback: number) => {
    const m = code.match(pattern);
    return m ? parseInt(m[1], 10) : fallback;
  };

  const rsi_length = num(/input\.int\s*\(\s*(\d+)\s*,\s*["']?RSI/i, 0) ||
    num(/ta\.rsi\s*\(\s*\w+\s*,\s*(\d+)\s*\)/i, 14);

  const overbought = num(/input\.int\s*\(\s*(\d+)\s*,\s*["']?overbought/i, 0) ||
    num(/overbought\s*=\s*(\d+)/i, 70);

  const oversold = num(/input\.int\s*\(\s*(\d+)\s*,\s*["']?oversold/i, 0) ||
    num(/oversold\s*=\s*(\d+)/i, 30);

  const emaMatches = [...code.matchAll(/ta\.ema\s*\(\s*\w+\s*,\s*(\d+)\s*\)/gi)]
    .map(m => parseInt(m[1], 10))
    .sort((a, b) => a - b);

  const ema_fast = emaMatches[0] ?? num(/ema_fast\s*=.*?(\d+)/i, 20);
  const ema_slow = emaMatches[1] ?? num(/ema_slow\s*=.*?(\d+)/i, 50);

  const symbolHint = code.match(/\b(BTCUSDT|ETHUSDT|SOLUSDT|BNBUSDT)\b/i);
  const symbol = symbolHint ? symbolHint[1].toUpperCase() : 'BTCUSDT';

  // ── Timeframe detection: try many PineScript patterns ──
  const tfPatterns: RegExp[] = [
    /input\.timeframe\s*\(\s*["']([^"']+)["']/i,                          // input.timeframe("15m", ...)
    /input(?:\.string)?\s*\(\s*["']([^"']+)["']\s*,\s*["'][^"']*timeframe[^"']*["']/i, // input.string("15m", "Timeframe")
    /timeframe\s*=\s*input[^)]*["']([^"']+)["']/i,                        // tf = input.string("15m", ...)
    /resolution\s*=\s*["']([^"']+)["']/i,                                 // resolution = "15"
    /timeframe\s*[:=]\s*["']([^"']+)["']/i,                               // timeframe: "15m" / timeframe = "15m"
    /\/\/\s*(?:timeframe|tf|interval)[:\s]+["']?(\d+[mhd])["']?/i,        // comment: // TF: 15m
  ];
  const VALID_TF = new Set(['1m','3m','5m','15m','30m','1h','2h','4h','6h','12h','1d','1w']);
  let timeframe: string | null = null; // default null
  for (const pat of tfPatterns) {
    const m = code.match(pat);
    if (m) {
      const raw = m[1].toLowerCase().trim();
      // Normalize: "15" → "15m", "60" → "1h", "240" → "4h"
      const normalized = raw === '60' ? '1h' : raw === '240' ? '4h' : raw === '1440' ? '1d'
        : /^\d+$/.test(raw) ? `${raw}m` : raw;
      if (VALID_TF.has(normalized)) { timeframe = normalized; break; }
    }
  }

  const lower = code.toLowerCase();
  const has_stop_loss = lower.includes('loss=') || lower.includes('stop_loss') || lower.includes('strategy.exit');
  const has_take_profit = lower.includes('profit=') || lower.includes('take_profit');
  const hasLong = lower.includes('strategy.long');
  const hasShort = lower.includes('strategy.short');
  const trade_direction: 'long' | 'short' | 'both' = (hasLong && hasShort) ? 'both' : hasShort ? 'short' : 'long';

  return { rsi_length, overbought, oversold, ema_fast, ema_slow, symbol, timeframe, has_stop_loss, has_take_profit, trade_direction };
}

/** Extract stop-loss, single TP, and multi-TP (TP1/TP2/TP3) from PineScript */
function extractRiskPct(code: string): {
  stop_loss_pct: number | null;
  take_profit_pct: number | null;
  position_size_pct: number | null;
  tp1_pct: number | null; tp2_pct: number | null; tp3_pct: number | null;
  tp1_size_pct: number | null; tp2_size_pct: number | null; tp3_size_pct: number | null;
} {
  const flt = (pattern: RegExp) => {
    const m = code.match(pattern);
    return m ? parseFloat(m[1]) : null;
  };

  // ── Stop Loss ──
  const slInput = flt(/input(?:\.float|\.int)?\s*\(\s*(\d+(?:\.\d+)?)\s*,\s*["'][^"']*(?:stop.?loss|[^"']*\bsl\b)[^"']*["']/i);
  const lossTickM = code.match(/loss\s*=\s*(\d+(?:\.\d+)?)/i);
  const stop_loss_pct = slInput ?? (lossTickM ? Math.min(+(parseFloat(lossTickM[1]) * 0.01).toFixed(2), 20) : null);

  // ── Position Size ──
  const position_size_pct = flt(/input(?:\.float|\.int)?\s*\(\s*(\d+(?:\.\d+)?)\s*,\s*["'][^"']*(?:position.?size|size|qty)[^"']*["']/i);

  // ── Multi-TP: input.float(1.5, "TP1 %") / input.float(3, "TP1") / tp1 = input.float(1.5, "Take Profit 1") ──
  const tp1Input = flt(/input(?:\.float|\.int)?\s*\(\s*(\d+(?:\.\d+)?)\s*,\s*["'][^"']*(?:tp1|tp\s*1|take.?profit\s*1|target\s*1)[^"']*["']/i);
  const tp2Input = flt(/input(?:\.float|\.int)?\s*\(\s*(\d+(?:\.\d+)?)\s*,\s*["'][^"']*(?:tp2|tp\s*2|take.?profit\s*2|target\s*2)[^"']*["']/i);
  const tp3Input = flt(/input(?:\.float|\.int)?\s*\(\s*(\d+(?:\.\d+)?)\s*,\s*["'][^"']*(?:tp3|tp\s*3|take.?profit\s*3|target\s*3)[^"']*["']/i);

  // ── Multi-TP: strategy.exit("TP1", ..., profit=150, qty_percent=33) ──
  const exitBlocks = [...code.matchAll(/strategy\.exit\s*\(\s*["']([^"']*?)["'][^)]*profit\s*=\s*(\d+(?:\.\d+)?)[^)]*(?:qty_percent\s*=\s*(\d+(?:\.\d+)?))?/gi)];

  let tp1_exit: number | null = null, tp2_exit: number | null = null, tp3_exit: number | null = null;
  let tp1s_exit: number | null = null, tp2s_exit: number | null = null, tp3s_exit: number | null = null;

  for (const b of exitBlocks) {
    const label = b[1].toLowerCase();
    const pct = Math.min(+(parseFloat(b[2]) * 0.01).toFixed(2), 50);
    const sz = b[3] ? parseFloat(b[3]) : null;
    if (label.includes('tp1') || label.includes('tp 1') || label.includes('target1') || label.includes('1')) {
      if (!tp1_exit) { tp1_exit = pct; tp1s_exit = sz; }
    } else if (label.includes('tp2') || label.includes('tp 2') || label.includes('target2') || label.includes('2')) {
      if (!tp2_exit) { tp2_exit = pct; tp2s_exit = sz; }
    } else if (label.includes('tp3') || label.includes('tp 3') || label.includes('target3') || label.includes('3')) {
      if (!tp3_exit) { tp3_exit = pct; tp3s_exit = sz; }
    }
  }

  // Fallback: single profit= tick
  const profitTickM = code.match(/profit\s*=\s*(\d+(?:\.\d+)?)/i);
  const singleTpInput = flt(/input(?:\.float|\.int)?\s*\(\s*(\d+(?:\.\d+)?)\s*,\s*["'][^"']*(?:take.?profit|tp|target)[^"']*["']/i);

  // Resolve single TP baseline
  const singleTpRaw = singleTpInput ??
    (profitTickM && !exitBlocks.length ? Math.min(+(parseFloat(profitTickM[1]) * 0.01).toFixed(2), 50) : null);

  // ── Smart inference: if no explicit TP1/TP2/TP3, derive from single TP or SL ──
  // Priority: explicit extraction > smart inference
  let tp1_pct = tp1Input ?? tp1_exit;
  let tp2_pct = tp2Input ?? tp2_exit;
  let tp3_pct = tp3Input ?? tp3_exit;
  let tp1_size_pct = tp1s_exit;
  let tp2_size_pct = tp2s_exit;
  let tp3_size_pct = tp3s_exit;

  if (!tp1_pct && !tp2_pct && !tp3_pct) {
    if (singleTpRaw) {
      // Split single TP into 3 scaled levels: 1x, 1.5x, 2.5x
      tp1_pct = +singleTpRaw.toFixed(2);
      tp2_pct = +(singleTpRaw * 1.5).toFixed(2);
      tp3_pct = +(singleTpRaw * 2.5).toFixed(2);
    } else if (stop_loss_pct) {
      // No TP at all — infer from R:R ratios (1:1.5, 1:2.5, 1:4)
      tp1_pct = +(stop_loss_pct * 1.5).toFixed(2);
      tp2_pct = +(stop_loss_pct * 2.5).toFixed(2);
      tp3_pct = +(stop_loss_pct * 4.0).toFixed(2);
    }
  }

  // Smart default sizes if not extracted: close 50% at TP1, 30% at TP2, 20% at TP3
  if (tp1_pct && !tp1_size_pct) tp1_size_pct = 50;
  if (tp2_pct && !tp2_size_pct) tp2_size_pct = 30;
  if (tp3_pct && !tp3_size_pct) tp3_size_pct = 20;

  // single TP fallback (for backward-compat field)
  const take_profit_pct = singleTpRaw ?? tp1_pct;

  return { stop_loss_pct, take_profit_pct, position_size_pct, tp1_pct, tp2_pct, tp3_pct, tp1_size_pct, tp2_size_pct, tp3_size_pct };
}

function buildInterpretation(code: string, p: StrategyParams, risk: {
  stop_loss_pct: number | null; take_profit_pct: number | null; position_size_pct: number | null;
  tp1_pct: number | null; tp2_pct: number | null; tp3_pct: number | null;
  tp1_size_pct: number | null; tp2_size_pct: number | null; tp3_size_pct: number | null;
}): string {
  const lower = code.toLowerCase();
  const findings: string[] = [];
  if (lower.includes('rsi')) findings.push('• RSI — momentum oscillator');
  if (lower.includes('macd')) findings.push('• MACD — trend-following momentum');
  if (lower.includes('ema') || lower.includes('sma')) findings.push('• Moving Averages (EMA/SMA) — trend confirmation');
  if (lower.includes('bollinger') || lower.includes('bb.')) findings.push('• Bollinger Bands — volatility');
  if (lower.includes('stoch')) findings.push('• Stochastic — momentum');
  if (lower.includes('atr')) findings.push('• ATR — volatility/stop sizing');
  if (lower.includes('volume')) findings.push('• Volume — signal confirmation');

  const linesCount = code.split('\n').length;
  const v5 = code.includes('@version=5');
  const isStrat = lower.includes('strategy(');

  let r = `📊 AI Strategy Analysis\n\n`;
  r += `Type: ${isStrat ? 'Full Strategy' : 'Indicator'} | Version: PineScript ${v5 ? 'v5' : 'v4'} | Lines: ${linesCount}\n\n`;
  if (findings.length) r += `🔬 Indicators:\n${findings.join('\n')}\n\n`;

  r += `⚙️ Extracted Parameters:\n`;
  r += `• RSI Length: ${p.rsi_length} | Overbought: ${p.overbought} | Oversold: ${p.oversold}\n`;
  r += `• EMA Fast: ${p.ema_fast} | EMA Slow: ${p.ema_slow}\n`;
  r += `• Trade Direction: ${p.trade_direction} | Symbol: ${p.symbol}\n\n`;

  r += `🟢 Entry Conditions:\n`;
  if (lower.includes('ta.crossover')) r += `• RSI crosses above oversold (${p.oversold})\n`;
  if (lower.includes('ema_fast') || p.ema_fast) r += `• EMA${p.ema_fast} > EMA${p.ema_slow} (uptrend filter)\n`;

  r += `\n⚙️ Risk Management:\n`;
  r += p.has_stop_loss ? `• Stop Loss defined ✓` : `• ⚠️ No stop loss detected`;
  if (risk.stop_loss_pct) r += ` (≈ ${risk.stop_loss_pct}%)`;
  r += '\n';

  // Multi-TP summary
  const hasMultiTp = risk.tp1_pct || risk.tp2_pct || risk.tp3_pct;
  const isInferred = !code.match(/tp1|tp\s*1|take.?profit\s*1|target\s*1/i) && hasMultiTp;
  if (hasMultiTp) {
    r += `• Take Profit Levels${isInferred ? ' (AI-inferred from strategy)' : ' (extracted from PineScript)'}:\n`;
    if (risk.tp1_pct) r += `  TP1: ${risk.tp1_pct}%${risk.tp1_size_pct ? ` → close ${risk.tp1_size_pct}% of position` : ''}\n`;
    if (risk.tp2_pct) r += `  TP2: ${risk.tp2_pct}%${risk.tp2_size_pct ? ` → close ${risk.tp2_size_pct}% of position` : ''}\n`;
    if (risk.tp3_pct) r += `  TP3: ${risk.tp3_pct}%${risk.tp3_size_pct ? ` → close ${risk.tp3_size_pct}% of position` : ''}\n`;
    if (isInferred) r += `  ℹ️ Levels auto-calculated — edit in Risk Settings panel before executing.\n`;
  } else {
    r += p.has_take_profit ? `• Take Profit defined ✓` : `• ⚠️ No take profit detected`;
    if (risk.take_profit_pct) r += ` (≈ ${risk.take_profit_pct}%)`;
    r += '\n';
  }
  if (risk.position_size_pct) r += `• Position Size: ${risk.position_size_pct}% of balance\n`;

  r += `\n⚡ Bot Integration:\nWhen activated, the bot fetches live ${p.symbol} klines, computes RSI(${p.rsi_length}) and EMA${p.ema_fast}/EMA${p.ema_slow}, then places a ${p.trade_direction} order on Binance when entry conditions are met.`;
  return r;
}
