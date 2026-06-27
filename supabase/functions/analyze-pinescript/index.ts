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

    // ── Gemini AI Enhancement ──────────────────────────────────────────────────
    const geminiKey = Deno.env.get('GEMINI_API_KEY');
    let aiInterpretation: string | null = null;

    if (geminiKey) {
      try {
        const geminiResult = await callGemini(geminiKey, code, params, risk);
        if (geminiResult) {
          // Merge Gemini-extracted values into params/risk (Gemini overrides regex)
          if (geminiResult.params) {
            if (geminiResult.params.rsi_length)      params.rsi_length      = geminiResult.params.rsi_length;
            if (geminiResult.params.overbought)       params.overbought       = geminiResult.params.overbought;
            if (geminiResult.params.oversold)         params.oversold         = geminiResult.params.oversold;
            if (geminiResult.params.ema_fast)         params.ema_fast         = geminiResult.params.ema_fast;
            if (geminiResult.params.ema_slow)         params.ema_slow         = geminiResult.params.ema_slow;
            if (geminiResult.params.st_multiplier)    params.st_multiplier    = geminiResult.params.st_multiplier;
            if (geminiResult.params.st_lookback)      params.st_lookback      = geminiResult.params.st_lookback;
            if (geminiResult.params.trade_direction)  params.trade_direction  = geminiResult.params.trade_direction;
            if (geminiResult.params.strategy_type)    params.strategy_type    = geminiResult.params.strategy_type;
            if (geminiResult.params.timeframe)        params.timeframe        = geminiResult.params.timeframe;
            if (geminiResult.params.symbol)           params.symbol           = geminiResult.params.symbol;
          }
          if (geminiResult.risk) {
            if (geminiResult.risk.stop_loss_pct    != null) risk.stop_loss_pct    = geminiResult.risk.stop_loss_pct;
            if (geminiResult.risk.take_profit_pct  != null) risk.take_profit_pct  = geminiResult.risk.take_profit_pct;
            if (geminiResult.risk.position_size_pct != null) risk.position_size_pct = geminiResult.risk.position_size_pct;
            if (geminiResult.risk.tp1_pct          != null) risk.tp1_pct          = geminiResult.risk.tp1_pct;
            if (geminiResult.risk.tp2_pct          != null) risk.tp2_pct          = geminiResult.risk.tp2_pct;
            if (geminiResult.risk.tp3_pct          != null) risk.tp3_pct          = geminiResult.risk.tp3_pct;
            if (geminiResult.risk.tp1_size_pct     != null) risk.tp1_size_pct     = geminiResult.risk.tp1_size_pct;
            if (geminiResult.risk.tp2_size_pct     != null) risk.tp2_size_pct     = geminiResult.risk.tp2_size_pct;
            if (geminiResult.risk.tp3_size_pct     != null) risk.tp3_size_pct     = geminiResult.risk.tp3_size_pct;
          }
          if (geminiResult.interpretation) {
            aiInterpretation = geminiResult.interpretation;
          }
        }
      } catch (geminiErr) {
        console.warn('Gemini enhancement failed, using regex extraction:', geminiErr);
      }
    }

    const interpretation = aiInterpretation ?? buildInterpretation(code, params, risk);

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

// ─── Gemini AI Analysis ────────────────────────────────────────────────────────
async function callGemini(
  apiKey: string,
  code: string,
  regexParams: StrategyParams,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  regexRisk: Record<string, any>
): Promise<{
  params?: Partial<StrategyParams>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  risk?: Record<string, number | null>;
  interpretation?: string;
} | null> {
  const prompt = `You are an expert PineScript trading strategy analyzer. Analyze this PineScript code and extract ALL parameters accurately.

Return a JSON object with EXACTLY this structure (no markdown, no code blocks, just raw JSON):
{
  "params": {
    "strategy_type": "rsi_ema" or "supertrend" or "smc" or "mixed",
    "rsi_length": <number or null>,
    "overbought": <number or null>,
    "oversold": <number or null>,
    "ema_fast": <number or null>,
    "ema_slow": <number or null>,
    "st_multiplier": <number or null>,
    "st_lookback": <number or null>,
    "trade_direction": "long" or "short" or "both",
    "timeframe": <string like "1h","4h","15m" or null>,
    "symbol": <string like "BTCUSDT" or null>
  },
  "risk": {
    "stop_loss_pct": <number or null - the SL percentage value, NOT ticks>,
    "take_profit_pct": <number or null>,
    "tp1_pct": <number or null>,
    "tp2_pct": <number or null>,
    "tp3_pct": <number or null>,
    "tp1_size_pct": <number or null - percentage of position to close at TP1>,
    "tp2_size_pct": <number or null>,
    "tp3_size_pct": <number or null>,
    "position_size_pct": <number or null>
  },
  "interpretation": "<detailed 3-5 sentence explanation of what this strategy does, its entry/exit logic, and key parameters in simple trading language>"
}

IMPORTANT RULES:
- For stop_loss_pct: if code says "loss=150" in strategy.exit, that means 1.5% (divide by 100). If it says input.float(1.5, "Stop Loss %") that means 1.5 directly.
- For ema_fast/ema_slow: find the SMALLEST and LARGEST EMA period values respectively.
- If the strategy has BOTH long AND short entries, set trade_direction = "both"
- For timeframe: look for input.timeframe() or comments mentioning TF. Return null if not found.
- Only include indicators actually present in the code.

Current regex extraction (for reference/verification):
- RSI Length: ${regexParams.rsi_length}, Overbought: ${regexParams.overbought}, Oversold: ${regexParams.oversold}
- EMA Fast: ${regexParams.ema_fast}, EMA Slow: ${regexParams.ema_slow}
- SL%: ${regexRisk.stop_loss_pct}, TP1%: ${regexRisk.tp1_pct}, TP2%: ${regexRisk.tp2_pct}, TP3%: ${regexRisk.tp3_pct}

PineScript Code:
\`\`\`pine
${code.slice(0, 6000)}
\`\`\``;

  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${apiKey}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: {
          temperature: 0.1,
          maxOutputTokens: 1024,
        },
      }),
    }
  );

  if (!response.ok) {
    throw new Error(`Gemini API error: ${response.status}`);
  }

  const data = await response.json();
  const text = data?.candidates?.[0]?.content?.parts?.[0]?.text ?? '';

  // Extract JSON from response (handle potential markdown wrapping)
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error('No JSON in Gemini response');

  return JSON.parse(jsonMatch[0]);
}

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
  const st_multiplier = flt(
    /(?:fast)?s(?:uper)?t(?:rend)?(?:multiplier|mult)[^\n]*?input\.float\s*\(\s*(\d+(?:\.\d+)?)/i,
    flt(/input\.float\s*\(\s*(\d+(?:\.\d+)?)[^)]*(?:multiplier|mult)/i, 2.0)
  );
  const st_lookback = num(
    /(?:fast)?s(?:uper)?t(?:rend)?(?:lookback|length|period)[^\n]*?input\.int\s*\(\s*(\d+)/i,
    num(/input\.int\s*\(\s*(\d+)[^)]*(?:lookback|supertrend)/i, 10)
  );

  // ── RSI params ──
  const rsiLengthInput = num(/input\.int\s*\(\s*(\d+)\s*,\s*["']RSI Length["']/i, 0) ||
    num(/input\.int\s*\(\s*(\d+)\s*,\s*["'][^"']*rsi[^"']*["']/i, 0);

  const rsi_length_entry = num(/input\.int\s*\(\s*(\d+)\s*,\s*["']?(?:RSI|rsi)(?!\s*[Ff]ilter|\s*[Ll]ength)/i, 0) ||
    num(/ta\.rsi\s*\(\s*\w+\s*,\s*(\d+)\s*\)/i, 14);

  const rsi_length = strategy_type === 'supertrend' || strategy_type === 'mixed'
    ? (rsiLengthInput || rsi_length_entry || 14)
    : (rsi_length_entry || 14);

  const overbought = num(/input\.int\s*\(\s*(\d+)\s*,\s*["']?overbought/i, 0) ||
    num(/overbought\s*=\s*(\d+)/i, 70);
  const oversold = num(/input\.int\s*\(\s*(\d+)\s*,\s*["']?oversold/i, 0) ||
    num(/oversold\s*=\s*(\d+)/i, 30);

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

  const slInline = flt(/\bsl\s*=\s*input(?:\.float|\.int)?\s*\(\s*(\d+(?:\.\d+)?)/i);
  const slLabel  = flt(/input(?:\.float|\.int)?\s*\(\s*(\d+(?:\.\d+)?)\s*,\s*["'][^"']*(?:stop.?loss|[^"']*\bsl\b)[^"']*["']/i);
  const lossTickM = code.match(/loss\s*=\s*(\d+(?:\.\d+)?)/i);
  const stop_loss_pct = slInline ?? slLabel ?? (lossTickM ? Math.min(+(parseFloat(lossTickM[1]) * 0.01).toFixed(2), 20) : null);

  const position_size_pct = flt(/input(?:\.float|\.int)?\s*\(\s*(\d+(?:\.\d+)?)\s*,\s*["'][^"']*(?:position.?size|size|qty)[^"']*["']/i);

  const tgt1Inline = flt(/\btgt1\s*=\s*input(?:\.float|\.int)?\s*\(\s*(\d+(?:\.\d+)?)/i);
  const tgt2Inline = flt(/\btgt2\s*=\s*input(?:\.float|\.int)?\s*\(\s*(\d+(?:\.\d+)?)/i);
  const tgt3Inline = flt(/\btgt3\s*=\s*input(?:\.float|\.int)?\s*\(\s*(\d+(?:\.\d+)?)/i);

  const tp1Input = tgt1Inline ?? flt(/input(?:\.float|\.int)?\s*\(\s*(\d+(?:\.\d+)?)\s*,\s*["'][^"']*(?:tp1|tp\s*1|take.?profit\s*1|target\s*1)[^"']*["']/i);
  const tp2Input = tgt2Inline ?? flt(/input(?:\.float|\.int)?\s*\(\s*(\d+(?:\.\d+)?)\s*,\s*["'][^"']*(?:tp2|tp\s*2|take.?profit\s*2|target\s*2)[^"']*["']/i);
  const tp3Input = tgt3Inline ?? flt(/input(?:\.float|\.int)?\s*\(\s*(\d+(?:\.\d+)?)\s*,\s*["'][^"']*(?:tp3|tp\s*3|take.?profit\s*3|target\s*3)[^"']*["']/i);

  const tp1SizeInput = flt(/\btp1ExitPct\s*=\s*input\.float\s*\(\s*(\d+(?:\.\d+)?)/i) ??
    flt(/input(?:\.float|\.int)?\s*\(\s*(\d+(?:\.\d+)?)\s*,\s*["'][^"']*(?:tp1\s*exit|exit.*tp1)[^"']*["']/i);
  const tp2SizeInput = flt(/\btp2ExitPct\s*=\s*input\.float\s*\(\s*(\d+(?:\.\d+)?)/i) ??
    flt(/input(?:\.float|\.int)?\s*\(\s*(\d+(?:\.\d+)?)\s*,\s*["'][^"']*(?:tp2\s*exit|exit.*tp2)[^"']*["']/i);
  const tp3SizeInput = flt(/\btp3ExitPct\s*=\s*input\.float\s*\(\s*(\d+(?:\.\d+)?)/i) ??
    flt(/input(?:\.float|\.int)?\s*\(\s*(\d+(?:\.\d+)?)\s*,\s*["'][^"']*(?:tp3\s*exit|exit.*tp3)[^"']*["']/i);

  const exitBlocks = [...code.matchAll(/strategy\.exit\s*\(\s*["']([^"']*?)["'][^)]*(?:limit|profit)\s*=\s*(\d+(?:\.\d+)?)[^)]*(?:qty_percent\s*=\s*(\d+(?:\.\d+)?))?/gi)];
  let tp1_exit: number | null = null, tp2_exit: number | null = null, tp3_exit: number | null = null;
  let tp1s_exit: number | null = null, tp2s_exit: number | null = null, tp3s_exit: number | null = null;
  for (const b of exitBlocks) {
    const label = b[1].toLowerCase();
    const raw = parseFloat(b[2]);
    const pct = raw > 20 ? Math.min(+(raw * 0.01).toFixed(2), 50) : raw;
    const sz = b[3] ? parseFloat(b[3]) : null;
    if ((label.includes('tgt1') || label.includes('tp1') || label.match(/target\s*1/)) && !tp1_exit) {
      tp1_exit = pct; tp1s_exit = sz;
    } else if ((label.includes('tgt2') || label.includes('tp2') || label.match(/target\s*2/)) && !tp2_exit) {
      tp2_exit = pct; tp2s_exit = sz;
    } else if ((label.includes('tgt3') || label.includes('tp3') || label.match(/target\s*3/)) && !tp3_exit) {
      tp3_exit = pct; tp3s_exit = sz;
    }
  }

  let tp1_pct = tp1Input ?? tp1_exit;
  let tp2_pct = tp2Input ?? tp2_exit;
  let tp3_pct = tp3Input ?? tp3_exit;
  let tp1_size_pct: number | null = tp1SizeInput ?? tp1s_exit;
  let tp2_size_pct: number | null = tp2SizeInput ?? tp2s_exit;
  let tp3_size_pct: number | null = tp3SizeInput ?? tp3s_exit;

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
