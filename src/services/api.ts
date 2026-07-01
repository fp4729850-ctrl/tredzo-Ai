import { supabase } from '@/db/supabase';
import type { Strategy, Signal, Trade, UserSettings, MarketScan } from '@/types/types';

// =====================
// USER SETTINGS
// =====================
export async function getUserSettings(): Promise<UserSettings | null> {
  const { data } = await supabase
    .from('user_settings')
    .select('*')
    .maybeSingle();
    
  if (!data) {
    // Auto-initialize settings for new users to generate webhook token, etc.
    const { data: { user } } = await supabase.auth.getUser();
    if (user) {
      await supabase.from('user_settings').insert({ user_id: user.id });
      // Fetch again after inserting
      const { data: newData } = await supabase
        .from('user_settings')
        .select('*')
        .maybeSingle();
      return newData ?? null;
    }
  }
  
  return data ?? null;
}

export async function upsertUserSettings(settings: Partial<UserSettings>): Promise<{ error: string | null }> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: 'Not authenticated' };

  const { error } = await supabase
    .from('user_settings')
    .upsert({ ...settings, user_id: user.id }, { onConflict: 'user_id' });

  return { error: error?.message ?? null };
}

// =====================
// STRATEGIES
// =====================
export async function getStrategies(): Promise<Strategy[]> {
  const { data } = await supabase
    .from('strategies')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(100);
  return Array.isArray(data) ? data : [];
}

// Admin only: fetch all strategies from all users with profile join
export async function getAllStrategiesAdmin(): Promise<(Strategy & { profile_email: string | null; profile_username: string | null })[]> {
  const { data } = await supabase
    .from('strategies')
    .select('*, profiles!strategies_user_id_fkey(email, username)')
    .order('created_at', { ascending: false })
    .limit(500);
  if (!Array.isArray(data)) return [];
  return data.map((row) => {
    const p = row.profiles as { email?: string | null; username?: string | null } | null;
    return {
      ...row,
      profiles: undefined,
      profile_email: p?.email ?? null,
      profile_username: p?.username ?? null,
    };
  });
}

export async function createStrategy(strategy: {
  name: string;
  description?: string;
  pinescript_code: string;
}): Promise<{ error: string | null }> {
  const { error } = await supabase.from('strategies').insert(strategy);
  return { error: error?.message ?? null };
}

export async function updateStrategy(id: string, updates: Partial<Strategy>): Promise<{ error: string | null }> {
  const { error } = await supabase
    .from('strategies')
    .update(updates)
    .eq('id', id);
  return { error: error?.message ?? null };
}

export async function deleteStrategy(id: string): Promise<{ error: string | null }> {
  const { error } = await supabase.from('strategies').delete().eq('id', id);
  return { error: error?.message ?? null };
}

// =====================
// SIGNALS
// =====================
export async function getSignals(limit = 50, offset = 0): Promise<Signal[]> {
  const { data } = await supabase
    .from('signals')
    .select('*')
    .order('created_at', { ascending: false })
    .range(offset, offset + limit - 1);
  return Array.isArray(data) ? data : [];
}

export async function getPendingSignals(): Promise<Signal[]> {
  const { data } = await supabase
    .from('signals')
    .select('*')
    .eq('status', 'pending')
    .order('confidence', { ascending: false })
    .limit(20);
  return Array.isArray(data) ? data : [];
}

// =====================
// TRADES
// =====================
export async function getTrades(limit = 50, offset = 0): Promise<Trade[]> {
  const { data } = await supabase
    .from('trades')
    .select('*')
    .order('created_at', { ascending: false })
    .range(offset, offset + limit - 1);
  return Array.isArray(data) ? data : [];
}

export async function getOpenTrades(): Promise<Trade[]> {
  const { data } = await supabase
    .from('trades')
    .select('*')
    .eq('status', 'open')
    .order('opened_at', { ascending: false })
    .limit(50);
  return Array.isArray(data) ? data : [];
}

// Trades by symbol — for per-strategy P&L
export async function getTradesBySymbol(symbol: string): Promise<Trade[]> {
  const { data } = await supabase
    .from('trades')
    .select('*')
    .eq('symbol', symbol)
    .order('created_at', { ascending: false })
    .limit(100);
  return Array.isArray(data) ? data : [];
}

// All trades for P&L aggregation on StrategiesPage
export async function getAllTradesSummary(): Promise<{
  bySymbol: Record<string, { totalTrades: number; wins: number; realizedPnlPct: number; openCount: number }>;
}> {
  const { data } = await supabase
    .from('trades')
    .select('symbol, status, pnl_pct')
    .limit(500);
  const trades = Array.isArray(data) ? data : [];
  const bySymbol: Record<string, { totalTrades: number; wins: number; realizedPnlPct: number; openCount: number }> = {};
  for (const t of trades) {
    if (!bySymbol[t.symbol]) bySymbol[t.symbol] = { totalTrades: 0, wins: 0, realizedPnlPct: 0, openCount: 0 };
    bySymbol[t.symbol].totalTrades++;
    if (t.status === 'open') bySymbol[t.symbol].openCount++;
    if (t.status === 'closed') {
      if ((t.pnl_pct ?? 0) > 0) bySymbol[t.symbol].wins++;
      bySymbol[t.symbol].realizedPnlPct += t.pnl_pct ?? 0;
    }
  }
  return { bySymbol };
}

// =====================
// MARKET SCANS
// =====================
export async function getLatestMarketScans(scanType: 'gainer' | 'loser', limit = 20): Promise<MarketScan[]> {
  const { data } = await supabase
    .from('market_scans')
    .select('*')
    .eq('scan_type', scanType)
    .order('scanned_at', { ascending: false })
    .limit(limit);
  return Array.isArray(data) ? data : [];
}

// =====================
// PERFORMANCE SUMMARY
// =====================
export async function getPerformanceSummary(): Promise<{
  totalTrades: number;
  winRate: number;
  totalPnl: number;
  totalPnlPct: number;
  openTrades: number;
}> {
  const { data: closedTrades } = await supabase
    .from('trades')
    .select('pnl, pnl_pct, status')
    .in('status', ['closed', 'open'])
    .order('created_at', { ascending: false })
    .limit(500);

  const trades = Array.isArray(closedTrades) ? closedTrades : [];
  const closed = trades.filter((t) => t.status === 'closed');
  const open = trades.filter((t) => t.status === 'open');
  const wins = closed.filter((t) => (t.pnl ?? 0) > 0);

  const totalPnl = closed.reduce((sum, t) => sum + (t.pnl ?? 0), 0);
  const avgPnlPct = closed.length > 0
    ? closed.reduce((sum, t) => sum + (t.pnl_pct ?? 0), 0) / closed.length
    : 0;

  return {
    totalTrades: closed.length,
    winRate: closed.length > 0 ? (wins.length / closed.length) * 100 : 0,
    totalPnl,
    totalPnlPct: avgPnlPct,
    openTrades: open.length,
  };
}

// =====================
// STRATEGY EXECUTION (Edge Function)
// =====================
export async function executeStrategy(strategyId: string): Promise<{ data?: unknown; error?: string }> {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) return { error: 'Not authenticated' };

  const res = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/execute-strategy`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${session.access_token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ strategyId }),
  });

  const json = await res.json().catch(() => ({ error: 'Invalid response' }));
  if (!res.ok || json.error) return { error: json.error || `HTTP ${res.status}` };
  return { data: json };
}

// =====================
// BINANCE TRADING (Edge Function)
// =====================
export async function callBinanceTrade(payload: {
  action: 'test-connection' | 'balance' | 'create-order' | 'get-order' | 'open-orders' | 'cancel-order';
  testnet?: boolean;
  symbol?: string;
  side?: 'BUY' | 'SELL';
  type?: 'MARKET' | 'LIMIT';
  quantity?: number;
  price?: number;
  orderId?: number;
}): Promise<{ data?: unknown; error?: string }> {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) return { error: 'Not authenticated' };

  const res = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/binance-trade`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${session.access_token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });

  const json = await res.json().catch(() => ({ error: 'Invalid response' }));
  if (!res.ok || json.error) {
    return { error: json.error || `HTTP ${res.status}` };
  }
  return { data: json };
}
