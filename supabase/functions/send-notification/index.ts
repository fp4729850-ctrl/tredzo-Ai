/**
 * send-notification — fires Telegram message when BUY/SELL signal is generated.
 * Called by bot-runner and execute-strategy after a non-HOLD signal.
 *
 * Body: { userId, signal, symbol, price, reason, timeframe, sl, tp1, mode }
 */
import { createClient } from 'npm:@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

function sb() {
  return createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  );
}

interface NotifyPayload {
  userId: string;
  signal: 'BUY' | 'SELL' | 'HOLD';
  symbol: string;
  price: number;
  reason: string;
  timeframe: string;
  strategyName: string;
  sl?: number | null;
  tp1?: number | null;
  tp2?: number | null;
  tp3?: number | null;
  mode: string;
}

function formatTelegramMessage(p: NotifyPayload): string {
  const emoji = p.signal === 'BUY' ? '🟢' : '🔴';
  const lines = [
    `${emoji} *${p.signal} Signal — ${p.symbol}*`,
    ``,
    `📈 Price: \`$${p.price.toLocaleString()}\``,
    `⏱️ Timeframe: \`${p.timeframe.toUpperCase()}\``,
    `🤖 Strategy: ${p.strategyName}`,
    `📊 Mode: ${p.mode.toUpperCase()}`,
    ``,
  ];
  if (p.sl)  lines.push(`🛡️ Stop Loss: \`$${p.sl.toFixed(2)}\``);
  if (p.tp1) lines.push(`🎯 TP1: \`$${p.tp1.toFixed(2)}\``);
  if (p.tp2) lines.push(`🎯 TP2: \`$${p.tp2.toFixed(2)}\``);
  if (p.tp3) lines.push(`🎯 TP3: \`$${p.tp3.toFixed(2)}\``);
  lines.push(``, `💡 _${p.reason}_`);
  return lines.join('\n');
}

async function sendTelegram(token: string, chatId: string, text: string): Promise<void> {
  const url = `https://api.telegram.org/bot${token}/sendMessage`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, text, parse_mode: 'Markdown' }),
    signal: AbortSignal.timeout(8_000),
  });
  if (!res.ok) {
    const err = await res.json();
    throw new Error(`Telegram error: ${err.description ?? res.status}`);
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  let payload: NotifyPayload;
  try { payload = await req.json(); } catch { return new Response('{}', { headers: corsHeaders }); }

  // Only send for non-HOLD signals
  if (payload.signal === 'HOLD') return new Response('{}', { headers: corsHeaders });

  const client = sb();
  const { data: settings } = await client
    .from('user_settings')
    .select('telegram_bot_token, telegram_chat_id, notifications_enabled, whatsapp_enabled, whatsapp_phone')
    .eq('user_id', payload.userId)
    .maybeSingle();

  if (!settings?.notifications_enabled) {
    return new Response(JSON.stringify({ skipped: 'notifications disabled' }), { headers: corsHeaders });
  }

  const results: Record<string, string> = {};

  // ── Telegram ──
  if (settings.telegram_bot_token && settings.telegram_chat_id) {
    try {
      const msg = formatTelegramMessage(payload);
      await sendTelegram(settings.telegram_bot_token, settings.telegram_chat_id, msg);
      results.telegram = 'sent';
    } catch (e) {
      results.telegram = `failed: ${(e as Error).message}`;
      console.error('[send-notification] Telegram:', (e as Error).message);
    }
  }

  // ── WhatsApp (via CallMeBot free API — user sets phone) ──
  if (settings.whatsapp_enabled && settings.whatsapp_phone) {
    try {
      const emoji = payload.signal === 'BUY' ? '🟢' : '🔴';
      const text = `${emoji} ${payload.signal} ${payload.symbol} @ $${payload.price} | TF:${payload.timeframe} | ${payload.strategyName} | ${payload.mode.toUpperCase()}`;
      const encoded = encodeURIComponent(text);
      const url = `https://api.callmebot.com/whatsapp.php?phone=${settings.whatsapp_phone}&text=${encoded}&apikey=get_from_callmebot`;
      const res = await fetch(url, { signal: AbortSignal.timeout(8_000) });
      results.whatsapp = res.ok ? 'sent' : `failed: ${res.status}`;
    } catch (e) {
      results.whatsapp = `failed: ${(e as Error).message}`;
    }
  }

  return new Response(JSON.stringify({ ok: true, results }), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
});
