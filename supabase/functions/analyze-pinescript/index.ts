import { createClient } from 'jsr:@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

/** Extended strategy params — strategy_type drives which signal logic is used */
interface StrategyParams {
  strategy_type: 'rsi_ema' | 'supertrend' | 'smc' | 'mixed';
  // RSI / EMA (used when strategy_type = 'rsi_ema' or 'mixed')
  rsi_length: number;
  overbought: number;
  oversold: number;
  ema_fast: number;
  ema_slow: number;
  // Supertrend (used when strategy_type = 'supertrend' or 'mixed')
  st_multiplier: number;
  st_lookback: number;
  // RSI as filter only (for supertrend strategies with RSI filter)
  rsi_filter_enabled: boolean;
  rsi_filter_long_level: number;
  rsi_filter_short_level: number;
  // Common
  symbol: string;
  timeframe: string;
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
      const { data: existing } = await supabase
        .from('strategies')
        .select('timeframe')
        .eq('id', strategyId)
        .single();

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
      if (params.timeframe && !existing?.timeframe) {
        update.timeframe = params.timeframe;
      }
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

// ─── Strategy Type Detection ──────────────────────────────────────────────────
function detectStrategyType(code: string): StrategyParams['strategy_type'] {
  const lower = code.toLowerCase();
  const hasSupertrend = lower.includes('ta.supertrend') || lower.includes('supertrend(');
  const hasSMC = lower.includes('bos') || lower.includes('order block') || lower.includes('displacement') || lower.includes('fair value gap');
  const hasRSI = lower.includes('ta.rsi') || lower.includes('ta.rsi(');
  const hasEMACross = (lower.match(/ta\.ema/g) || []).length >= 2 &&
    (lower.includes('crossover') || lower.includes('crossunder') || lower.includes('ema_fast') || lower.includes('ema_slow'));

  if (hasSupertrend && (hasSMC || hasRSI)) return 'mixed';
  if (hasSupertrend) return 'supertrend';
  if (hasSMC) return 'smc';
  if (hasRSI || hasEMACross) return 'rsi_ema';
  return 'rsi_ema'; // safe fallback
}

// ─── Parameter Extraction ─────────────────────────────────────────────────────
function extractParams(code: string): StrategyParams {
  const num = (pattern: RegExp, fallback: number) => {
    const m = code.match(pattern);
    return m ? parseInt(m[1], 10) : fallback;
  };
  const flt = (pattern: RegExp, fallback: number) => {
    const m = code.match(pattern);
    return m ? parseFloat(m[1]) : fallback;
  };

  const strategy_type = detectStrategyType(code);

  // ── Supertrend params ──
  // fastSTMultiplier = input.float(1.1, "Fast Supertrend Multiplier", ...)
  const st_multiplier = flt(
    /(?:fast)?s(?:uper)?t(?:rend)?(?:multiplier|mult)[^\n]*?input\.float\s*\(\s*(\d+(?:\.\d+)?)/i,
    flt(/input\.float\s*\(\s*(\d+(?:\.\d+)?)[^)]*(?:multiplier|mult)/i, 2.0)
  );
  // fastSTLookback = input.int(5, "Fast Supertrend Lookback", ...)
  const st_lookback = num(
    /(?:fast)?s(?:uper)?t(?:rend)?(?:lookback|length|period)[^\n]*?input\.int\s*\(\s*(\d+)/i,
    num(/input\.int\s*\(\s*(\d+)[^)]*(?:lookback|supertrend)/i, 10)
  );

  // ── RSI params ──
  // If supertrend strategy, RSI is a filter; extract filter-level params
  // fastRSILength = input.int(7, "RSI Length", ...)
  const rsiLengthInput = num(/input\.int\s*\(\s*(\d+)\s*,\s*["']RSI Length["']/i, 0) ||
    num(/input\.int\s*\(\s*(\d+)\s*,\s*["'][^"']*rsi[^"']*["']/i, 0);

  // For non-supertrend: RSI is the entry signal
  const rsi_length_entry = num(/input\.int\s*\(\s*(\d+)\s*,\s*["']?(?:RSI|rsi)(?!\s*[Ff]ilter|\s*[Ll]ength)/i, 0) ||
    num(/ta\.rsi\s*\(\s*\w+\s*,\s*(\d+)\s*\)/i, 14);

  // Primary RSI length: for supertrend use rsiLengthInput as filter, for rsi_ema use entry rsi
  const rsi_length = strategy_type === 'supertrend' || strategy_type === 'mixed'
    ? (rsiLengthInput || rsi_length_entry || 14)
    : (rsi_length_entry || 14);

  const overbought = num(/input\.int\s*\(\s*(\d+)\s*,\s*["']?overbought/i, 0) ||
    num(/overbought\s*=\s*(\d+)/i, 70);
  const oversold = num(/input\.int\s*\(\s*(\d+)\s*,\s*["']?oversold/i, 0) ||
    num(/oversold\s*=\s*(\d+)/i, 30);

  // RSI filter: fastRSILongLevel = input.float(50.0, "Long Above RSI", ...)
  const rsi_filter_enabled = /use.*rsi.*filter|rsi.*filter.*true/i.test(code);
  const rsi_filter_long_level = flt(/input\.float\s*\(\s*(\d+(?:\.\d+)?)[^)]*(?:long above rsi|rsi.*long)/i, 50.0);
  const rsi_filter_short_level = flt(/input\.float\s*\(\s*(\d+(?:\.\d+)?)[^)]*(?:short below rsi|rsi.*short)/i, 50.0);

  // ── EMA params ──
  const emaMatches = [...code.matchAll(/ta\.ema\s*\(\s*\w+\s*,\s*(\d+)\s*\)/gi)]
    .map(m => parseInt(m[1], 10))
    .sort((a, b) => a - b);
  const ema_fast = emaMatches[0] ?? num(/ema_fast\s*=.*?(\d+)/i, 20);
  const ema_slow = emaMatches[1] ?? num(/ema_slow\s*=.*?(\d+)/i, 50);

  // ── Symbol ──
  const symbolHint = code.match(/\b(BTCUSDT|ETHUSDT|SOLUSDT|BNBUSDT|XRPUSDT|DOGEUSDT)\b/i);
  const symbol = symbolHint ? symbolHint[1].toUpperCase() : 'BTCUSDT';

  // ── Timeframe ──
  // From strategy title e.g. 'FAST 1m 5m'
  const titleTFMatch = code.match(/strategy\s*\(\s*['"][^'"]*\b(1m|5m|15m|30m|1h|4h|1d)\b/i);
  const tfPatterns: RegExp[] = [
    /input\.timeframe\s*\(\s*["']([^"']+)["']/i,
    /input(?:\.string)?\s*\(\s*["']([^"']+)["']\s*,\s*["'][^"']*timeframe[^"']*["']/i,
    /timeframe\s*=\s*input[^)]*["']([^"']+)["']/i,
    /resolution\s*=\s*["']([^"']+)["']/i,
    /timeframe\s*[:=]\s*["']([^"']+)["']/i,
    /\/\/\s*(?:timeframe|tf|interval)[:\s]+["']?(\d+[mhd])["']?/i,
  ];
  const VALID_TF = new Set(['1m','3m','5m','15m','30m','1h','2h','4h','6h','12h','1d','1w']);
  let timeframe = titleTFMatch ? titleTFMatch[1].toLowerCase() : '1h';
  if (!VALID_TF.has(timeframe)) timeframe = '1h';
  for (const pat of tfPatterns) {
    const m = code.match(pat);
    if (m) {
      const raw = m[1].toLowerCase().trim();
      const normalized = raw === '60' ? '1h' : raw === '240' ? '4h' : raw === '1440' ? '1d'
        : /^\d+$/.test(raw) ? `${raw}m` : raw;
      if (VALID_TF.has(normalized)) { timeframe = normalized; break; }
    }
  }

  // ── Trade direction ──
  const lower = code.toLowerCase();
  const has_stop_loss = lower.includes('loss=') || lower.includes('stop_loss') || lower.includes('strategy.exit') || /\bsl\b/.test(code);
  const has_take_profit = lower.includes('profit=') || lower.includes('take_profit') || /\btgt\d?\b/.test(lower);
  const hasLong = lower.includes('strategy.long') || lower.includes('"buy"') || lower.includes("'buy'");
  const hasShort = lower.includes('strategy.short') || lower.includes('"sell"') || lower.includes("'sell'");
  const trade_direction: 'long' | 'short' | 'both' = (hasLong && hasShort) ? 'both' : hasShort ? 'short' : 'long';

  return {
    strategy_type, rsi_length, overbought, oversold,
    ema_fast, ema_slow,
    st_multiplier, st_lookback,
    rsi_filter_enabled, rsi_filter_long_level, rsi_filter_short_level,
    symbol, timeframe, has_stop_loss, has_take_profit, trade_direction,
  };
}

// ─── Risk Extraction ──────────────────────────────────────────────────────────
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
  // Pattern: sl = input(1.0, inline = "sl") OR input.float(1.0, inline = "sl") OR input.float(X, "Stop Loss %")
  const slInline = flt(/\bsl\s*=\s*input(?:\.float|\.int)?\s*\(\s*(\d+(?:\.\d+)?)/i);
  const slLabel  = flt(/input(?:\.float|\.int)?\s*\(\s*(\d+(?:\.\d+)?)\s*,\s*["'][^"']*(?:stop.?loss|[^"']*\bsl\b)[^"']*["']/i);
  const lossTickM = code.match(/loss\s*=\s*(\d+(?:\.\d+)?)/i);
  const stop_loss_pct = slInline ?? slLabel ?? (lossTickM ? Math.min(+(parseFloat(lossTickM[1]) * 0.01).toFixed(2), 20) : null);

  // ── Position Size ──
  const position_size_pct = flt(/input(?:\.float|\.int)?\s*\(\s*(\d+(?:\.\d+)?)\s*,\s*["'][^"']*(?:position.?size|size|qty)[^"']*["']/i);

  // ── Multi-TP: tgt1/tgt2/tgt3 = input(X, inline="tgt1") ──
  // "Market Pulse" style: tgt1 = input(X, inline="tgt1") / tgt2 / tgt3
  const tgt1Inline = flt(/\btgt1\s*=\s*input(?:\.float|\.int)?\s*\(\s*(\d+(?:\.\d+)?)/i);
  const tgt2Inline = flt(/\btgt2\s*=\s*input(?:\.float|\.int)?\s*\(\s*(\d+(?:\.\d+)?)/i);
  const tgt3Inline = flt(/\btgt3\s*=\s*input(?:\.float|\.int)?\s*\(\s*(\d+(?:\.\d+)?)/i);

  // Label-based: input.float(X, "TP1 %") / "Target 1"
  const tp1Input = tgt1Inline ?? flt(/input(?:\.float|\.int)?\s*\(\s*(\d+(?:\.\d+)?)\s*,\s*["'][^"']*(?:tp1|tp\s*1|take.?profit\s*1|target\s*1)[^"']*["']/i);
  const tp2Input = tgt2Inline ?? flt(/input(?:\.float|\.int)?\s*\(\s*(\d+(?:\.\d+)?)\s*,\s*["'][^"']*(?:tp2|tp\s*2|take.?profit\s*2|target\s*2)[^"']*["']/i);
  const tp3Input = tgt3Inline ?? flt(/input(?:\.float|\.int)?\s*\(\s*(\d+(?:\.\d+)?)\s*,\s*["'][^"']*(?:tp3|tp\s*3|take.?profit\s*3|target\s*3)[^"']*["']/i);

  // ── tp exit size: tp1ExitPct / tp2ExitPct / tp3ExitPct ──
  const tp1SizeInput = flt(/\btp1ExitPct\s*=\s*input\.float\s*\(\s*(\d+(?:\.\d+)?)/i) ??
    flt(/input(?:\.float|\.int)?\s*\(\s*(\d+(?:\.\d+)?)\s*,\s*["'][^"']*(?:tp1\s*exit|exit.*tp1)[^"']*["']/i);
  const tp2SizeInput = flt(/\btp2ExitPct\s*=\s*input\.float\s*\(\s*(\d+(?:\.\d+)?)/i) ??
    flt(/input(?:\.float|\.int)?\s*\(\s*(\d+(?:\.\d+)?)\s*,\s*["'][^"']*(?:tp2\s*exit|exit.*tp2)[^"']*["']/i);
  const tp3SizeInput = flt(/\btp3ExitPct\s*=\s*input\.float\s*\(\s*(\d+(?:\.\d+)?)/i) ??
    flt(/input(?:\.float|\.int)?\s*\(\s*(\d+(?:\.\d+)?)\s*,\s*["'][^"']*(?:tp3\s*exit|exit.*tp3)[^"']*["']/i);

  // ── strategy.exit() profit blocks ──
  const exitBlocks = [...code.matchAll(/strategy\.exit\s*\(\s*["']([^"']*?)["'][^)]*(?:limit|profit)\s*=\s*(\d+(?:\.\d+)?)[^)]*(?:qty_percent\s*=\s*(\d+(?:\.\d+)?))?/gi)];
  let tp1_exit: number | null = null, tp2_exit: number | null = null, tp3_exit: number | null = null;
  let tp1s_exit: number | null = null, tp2s_exit: number | null = null, tp3s_exit: number | null = null;
  for (const b of exitBlocks) {
    const label = b[1].toLowerCase();
    // limit= is % directly in Market Pulse style (strategy.exit uses limit = price * (1 + tgt/100))
    // But in classic style profit= is ticks → multiply by 0.01
    const raw = parseFloat(b[2]);
    const pct = raw > 20 ? Math.min(+(raw * 0.01).toFixed(2), 50) : raw; // if >20 assume ticks
    const sz = b[3] ? parseFloat(b[3]) : null;
    if ((label.includes('tgt1') || label.includes('tp1') || label.match(/target\s*1/)) && !tp1_exit) {
      tp1_exit = pct; tp1s_exit = sz;
    } else if ((label.includes('tgt2') || label.includes('tp2') || label.match(/target\s*2/)) && !tp2_exit) {
      tp2_exit = pct; tp2s_exit = sz;
    } else if ((label.includes('tgt3') || label.includes('tp3') || label.match(/target\s*3/)) && !tp3_exit) {
      tp3_exit = pct; tp3s_exit = sz;
    }
  }

  // Merge
  let tp1_pct = tp1Input ?? tp1_exit;
  let tp2_pct = tp2Input ?? tp2_exit;
  let tp3_pct = tp3Input ?? tp3_exit;
  let tp1_size_pct: number | null = tp1SizeInput ?? tp1s_exit;
  let tp2_size_pct: number | null = tp2SizeInput ?? tp2s_exit;
  let tp3_size_pct: number | null = tp3SizeInput ?? tp3s_exit;

  // Fallback single TP
  const profitTickM = code.match(/profit\s*=\s*(\d+(?:\.\d+)?)/i);
  const singleTpInput = flt(/input(?:\.float|\.int)?\s*\(\s*(\d+(?:\.\d+)?)\s*,\s*["'][^"']*(?:take.?profit|tp|target)[^"']*["']/i);
  const singleTpRaw = singleTpInput ??
    (profitTickM && !exitBlocks.length ? Math.min(+(parseFloat(profitTickM[1]) * 0.01).toFixed(2), 50) : null);

  if (!tp1_pct && !tp2_pct && !tp3_pct) {
    if (singleTpRaw) {
      tp1_pct = +singleTpRaw.toFixed(2);
      tp2_pct = +(singleTpRaw * 1.5).toFixed(2);
      tp3_pct = +(singleTpRaw * 2.5).toFixed(2);
    } else if (stop_loss_pct) {
      tp1_pct = +(stop_loss_pct * 1.5).toFixed(2);
      tp2_pct = +(stop_loss_pct * 2.5).toFixed(2);
      tp3_pct = +(stop_loss_pct * 4.0).toFixed(2);
    }
  }

  if (tp1_pct && !tp1_size_pct) tp1_size_pct = 33;
  if (tp2_pct && !tp2_size_pct) tp2_size_pct = 33;
  if (tp3_pct && !tp3_size_pct) tp3_size_pct = 34;

  const take_profit_pct = singleTpRaw ?? tp1_pct;
  return { stop_loss_pct, take_profit_pct, position_size_pct, tp1_pct, tp2_pct, tp3_pct, tp1_size_pct, tp2_size_pct, tp3_size_pct };
}

// ─── Interpretation Builder ───────────────────────────────────────────────────
function buildInterpretation(code: string, p: StrategyParams, risk: {
  stop_loss_pct: number | null; take_profit_pct: number | null; position_size_pct: number | null;
  tp1_pct: number | null; tp2_pct: number | null; tp3_pct: number | null;
  tp1_size_pct: number | null; tp2_size_pct: number | null; tp3_size_pct: number | null;
}): string {
  const lower = code.toLowerCase();
  const findings: string[] = [];

  // Detect indicators present
  if (lower.includes('ta.supertrend') || lower.includes('supertrend(')) findings.push('• Supertrend — trend direction signal');
  if (lower.includes('ta.rsi')) findings.push('• RSI — momentum oscillator');
  if (lower.includes('macd')) findings.push('• MACD — trend-following momentum');
  if (lower.includes('ta.ema') || lower.includes('ta.sma')) findings.push('• Moving Averages (EMA/SMA) — trend confirmation');
  if (lower.includes('bollinger') || lower.includes('bb.')) findings.push('• Bollinger Bands — volatility');
  if (lower.includes('stoch')) findings.push('• Stochastic — momentum');
  if (lower.includes('ta.atr')) findings.push('• ATR — volatility/stop sizing');
  if (lower.includes('volume')) findings.push('• Volume — signal confirmation');
  if (lower.includes('vwap')) findings.push('• VWAP — institutional price reference');
  if (lower.includes('bos') || lower.includes('break of structure')) findings.push('• SMC BOS — break-of-structure detection');
  if (lower.includes('displacement') || lower.includes('impulsive')) findings.push('• SMC Displacement — impulsive move detection');
  if (lower.includes('ta.highest') || lower.includes('ta.lowest')) findings.push('• Swing High/Low — structure points');
  if (lower.includes('entropy')) findings.push('• Entropy Squeeze — creative momentum');

  const linesCount = code.split('\n').length;
  const v6 = code.includes('@version=6');
  const v5 = code.includes('@version=5');
  const isStrat = lower.includes('strategy(');

  let r = `📊 AI Strategy Analysis\n\n`;
  r += `Type: ${isStrat ? 'Full Strategy' : 'Indicator'} | Version: PineScript ${v6 ? 'v6' : v5 ? 'v5' : 'v4'} | Lines: ${linesCount}\n`;
  r += `Signal Engine: ${p.strategy_type === 'supertrend' ? '⚡ Supertrend' : p.strategy_type === 'smc' ? '🧠 SMC (Smart Money)' : p.strategy_type === 'mixed' ? '🔀 Supertrend + RSI/EMA' : '📉 RSI + EMA Crossover'}\n\n`;

  if (findings.length) r += `🔬 Indicators Detected:\n${findings.join('\n')}\n\n`;

  r += `⚙️ Extracted Parameters:\n`;

  if (p.strategy_type === 'supertrend' || p.strategy_type === 'mixed') {
    r += `• Supertrend Multiplier: ${p.st_multiplier} | Lookback: ${p.st_lookback}\n`;
    if (p.rsi_filter_enabled) {
      r += `• RSI Filter: ON | Long when RSI > ${p.rsi_filter_long_level}\n`;
    }
  }
  if (p.strategy_type === 'rsi_ema' || p.strategy_type === 'mixed') {
    r += `• RSI Length: ${p.rsi_length} | Overbought: ${p.overbought} | Oversold: ${p.oversold}\n`;
    r += `• EMA Fast: ${p.ema_fast} | EMA Slow: ${p.ema_slow}\n`;
  }
  r += `• Trade Direction: ${p.trade_direction} | Symbol: ${p.symbol} | Timeframe: ${p.timeframe}\n\n`;

  r += `🟢 Entry Conditions:\n`;
  if (p.strategy_type === 'supertrend' || p.strategy_type === 'mixed') {
    r += `• Supertrend direction change → BUY (bearish→bullish) / SELL (bullish→bearish)\n`;
    if (p.rsi_filter_enabled) r += `• RSI(${p.rsi_length}) > ${p.rsi_filter_long_level} required for LONG entry\n`;
  }
  if (p.strategy_type === 'rsi_ema') {
    r += `• RSI crosses above oversold (${p.oversold}) → BUY\n`;
    r += `• EMA${p.ema_fast} > EMA${p.ema_slow} (uptrend filter)\n`;
  }
  if (p.strategy_type === 'smc') {
    r += `• Impulsive BOS (Break of Structure) detected\n`;
    r += `• Displacement candle confirms direction\n`;
  }

  r += `\n⚙️ Risk Management:\n`;
  r += p.has_stop_loss ? `• Stop Loss defined ✓` : `• ⚠️ No stop loss detected`;
  if (risk.stop_loss_pct) r += ` (${risk.stop_loss_pct}%)`;
  r += '\n';

  const hasMultiTp = risk.tp1_pct || risk.tp2_pct || risk.tp3_pct;
  const isInferred = !code.match(/tgt1|tgt2|tgt3|tp1|tp\s*1|take.?profit\s*1|target\s*1/i) && hasMultiTp;
  if (hasMultiTp) {
    r += `• Take Profit Levels${isInferred ? ' (AI-inferred)' : ' (extracted from PineScript)'}:\n`;
    if (risk.tp1_pct) r += `  TP1: ${risk.tp1_pct}%${risk.tp1_size_pct ? ` → close ${risk.tp1_size_pct}%` : ''}\n`;
    if (risk.tp2_pct) r += `  TP2: ${risk.tp2_pct}%${risk.tp2_size_pct ? ` → close ${risk.tp2_size_pct}%` : ''}\n`;
    if (risk.tp3_pct) r += `  TP3: ${risk.tp3_pct}%${risk.tp3_size_pct ? ` → close ${risk.tp3_size_pct}%` : ''}\n`;
  }
  if (risk.position_size_pct) r += `• Position Size: ${risk.position_size_pct}%\n`;

  r += `\n⚡ Bot Integration:\n`;
  if (p.strategy_type === 'supertrend' || p.strategy_type === 'mixed') {
    r += `Bot fetches live ${p.symbol} OHLCV, computes Supertrend(${p.st_multiplier}, ${p.st_lookback}), and fires BUY/SELL on direction change.`;
  } else {
    r += `Bot fetches live ${p.symbol} klines, computes RSI(${p.rsi_length}) and EMA${p.ema_fast}/EMA${p.ema_slow}, fires ${p.trade_direction} order on entry condition.`;
  }
  return r;
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
      // Fetch current strategy to check if user has already set a timeframe manually
      const { data: existing } = await supabase
        .from('strategies')
        .select('timeframe')
        .eq('id', strategyId)
        .single();

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
      // Only save AI-extracted timeframe if user has NOT manually set one
      if (params.timeframe && !existing?.timeframe) {
        update.timeframe = params.timeframe;
      }
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
  let timeframe = '1h'; // default
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
