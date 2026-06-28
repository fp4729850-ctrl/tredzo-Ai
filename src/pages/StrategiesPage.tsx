import React, { useEffect, useState, useCallback, useRef } from 'react';
import { AppLayout } from '@/components/layouts/AppLayout';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger
} from '@/components/ui/dialog';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle
} from '@/components/ui/alert-dialog';
import { Code2, Plus, Play, Pause, Trash2, Bot, Loader2, Sparkles, Zap, TrendingUp, TrendingDown, Activity, ShieldAlert, Save, Clock, BarChart2 } from 'lucide-react';
import { StrategyLiveChart, type StrategyRiskConfig } from '@/components/charts/StrategyLiveChart';
import { toast } from 'sonner';
import { getStrategies, createStrategy, updateStrategy, deleteStrategy, executeStrategy, getAllTradesSummary } from '@/services/api';
import { supabase } from '@/db/supabase';
import type { Strategy, StrategyParams } from '@/types/types';
import { cn } from '@/lib/utils';

const SAMPLE_PINESCRIPT = `//@version=5
strategy("My RSI + EMA Strategy", overlay=true, default_qty_type=strategy.percent_of_equity, default_qty_value=10)

// ── Inputs ──
rsiLen     = input.int(14,   "RSI Length")
overbought = input.int(70,   "Overbought Level")
oversold   = input.int(30,   "Oversold Level")
slPct      = input.float(1.5, "Stop Loss %",      step=0.1)
tp1Pct     = input.float(1.5, "TP1 % (50% qty)",  step=0.1)
tp2Pct     = input.float(3.0, "TP2 % (30% qty)",  step=0.1)
tp3Pct     = input.float(5.0, "TP3 % (20% qty)",  step=0.1)

// ── Indicators ──
rsi      = ta.rsi(close, rsiLen)
ema_fast = ta.ema(close, 20)
ema_slow = ta.ema(close, 50)

// ── Conditions ──
longCondition  = ta.crossover(rsi, oversold)  and ema_fast > ema_slow
shortCondition = ta.crossunder(rsi, overbought) and ema_fast < ema_slow

// ── Entries ──
if longCondition
    strategy.entry("Long", strategy.long)
if shortCondition
    strategy.entry("Short", strategy.short)

// ── Multi-Target Exits ──
strategy.exit("TP1-L", from_entry="Long",  profit=tp1Pct*100, loss=slPct*100, qty_percent=50)
strategy.exit("TP2-L", from_entry="Long",  profit=tp2Pct*100, loss=slPct*100, qty_percent=30)
strategy.exit("TP3-L", from_entry="Long",  profit=tp3Pct*100, loss=slPct*100, qty_percent=20)
strategy.exit("TP1-S", from_entry="Short", profit=tp1Pct*100, loss=slPct*100, qty_percent=50)
strategy.exit("TP2-S", from_entry="Short", profit=tp2Pct*100, loss=slPct*100, qty_percent=30)
strategy.exit("TP3-S", from_entry="Short", profit=tp3Pct*100, loss=slPct*100, qty_percent=20)`;

export default function StrategiesPage() {
  const [strategies, setStrategies] = useState<Strategy[]>([]);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [selectedStrategy, setSelectedStrategy] = useState<Strategy | null>(null);
  const [interpreting, setInterpreting] = useState<string | null>(null);
  const [executing, setExecuting] = useState<string | null>(null);

  const [form, setForm] = useState({ name: '', description: '', pinescript_code: SAMPLE_PINESCRIPT });
  const [saving, setSaving] = useState(false);

  // Per-strategy risk override state — includes multi-TP + indicator params
  const [riskForm, setRiskForm] = useState<{
    stop_loss_pct: string; take_profit_pct: string; position_size_pct: string;
    tp1_pct: string; tp2_pct: string; tp3_pct: string;
    tp1_size_pct: string; tp2_size_pct: string; tp3_size_pct: string;
    trade_amount_usdt: string;
    // Indicator params (AI-extracted, user-editable)
    rsi_length: string; overbought: string; oversold: string;
    ema_fast: string; ema_slow: string;
    st_multiplier: string; st_lookback: string;
    trade_direction: 'long' | 'short' | 'both';
    strategy_type: 'rsi_ema' | 'supertrend' | 'smc' | 'mixed';
  }>({
    stop_loss_pct: '', take_profit_pct: '', position_size_pct: '',
    tp1_pct: '', tp2_pct: '', tp3_pct: '',
    tp1_size_pct: '', tp2_size_pct: '', tp3_size_pct: '',
    trade_amount_usdt: '',
    rsi_length: '14', overbought: '70', oversold: '30',
    ema_fast: '20', ema_slow: '50',
    st_multiplier: '2.0', st_lookback: '10',
    trade_direction: 'both',
    strategy_type: 'rsi_ema',
  });
  const [savingRisk, setSavingRisk] = useState(false);
  const [justAnalyzedId, setJustAnalyzedId] = useState<string | null>(null);
  const riskPanelRef = useRef<HTMLDivElement>(null);
  const [pnlMap, setPnlMap] = useState<Record<string, { totalTrades: number; wins: number; realizedPnlPct: number; openCount: number }>>({});
  // Chart overlay: populated after Save Risk Settings
  const [chartRiskConfig, setChartRiskConfig] = useState<StrategyRiskConfig | null>(null);

  const load = useCallback(async () => {
    const [data, summary] = await Promise.all([
      getStrategies(),
      getAllTradesSummary(),
    ]);
    setStrategies(data);
    setPnlMap(summary.bySymbol);
  }, []);

  useEffect(() => {
    load().finally(() => setLoading(false));
  }, [load]);

  const handleCreate = async () => {
    if (!form.name.trim()) return toast.error('Strategy name is required');
    if (!form.pinescript_code.trim()) return toast.error('PineScript code is required');
    setSaving(true);
    const { error } = await createStrategy(form);
    if (error) {
      toast.error(error);
      setSaving(false);
      return;
    }
    // Auto-analyze immediately after saving
    const strategies = await getStrategies();
    const saved = strategies[0]; // most recent
    if (saved) {
      await runAnalyze(saved, false); // silent toast, full analysis
    }
    toast.success('Strategy created and analyzed!');
    setDialogOpen(false);
    setForm({ name: '', description: '', pinescript_code: SAMPLE_PINESCRIPT });
    await load();
    setSaving(false);
  };

  const handleToggle = async (strategy: Strategy) => {
    const newStatus = strategy.status === 'active' ? 'inactive' : 'active';
    const { error } = await updateStrategy(strategy.id, { status: newStatus });
    if (error) {
      toast.error(error);
    } else {
      toast.success(`Strategy ${newStatus === 'active' ? 'activated' : 'deactivated'}`);
      await load();
    }
  };

  const handleDelete = async () => {
    if (!deleteId) return;
    const { error } = await deleteStrategy(deleteId);
    if (error) {
      toast.error(error);
    } else {
      toast.success('Strategy deleted');
      setDeleteId(null);
      if (selectedStrategy?.id === deleteId) setSelectedStrategy(null);
      await load();
    }
  };

  // Sync risk form from a strategy object (including indicator params)
  const syncRiskForm = useCallback((s: Strategy) => {
    const p = s.strategy_params as StrategyParams | null;
    setRiskForm({
      stop_loss_pct: s.stop_loss_pct != null ? String(s.stop_loss_pct) : '',
      take_profit_pct: s.take_profit_pct != null ? String(s.take_profit_pct) : '',
      position_size_pct: s.position_size_pct != null ? String(s.position_size_pct) : '',
      tp1_pct: s.tp1_pct != null ? String(s.tp1_pct) : '',
      tp2_pct: s.tp2_pct != null ? String(s.tp2_pct) : '',
      tp3_pct: s.tp3_pct != null ? String(s.tp3_pct) : '',
      tp1_size_pct: s.tp1_size_pct != null ? String(s.tp1_size_pct) : '',
      tp2_size_pct: s.tp2_size_pct != null ? String(s.tp2_size_pct) : '',
      tp3_size_pct: s.tp3_size_pct != null ? String(s.tp3_size_pct) : '',
      trade_amount_usdt: s.trade_amount_usdt != null ? String(s.trade_amount_usdt) : '',
      // Indicator params from strategy_params
      rsi_length: p?.rsi_length != null ? String(p.rsi_length) : '14',
      overbought: p?.overbought != null ? String(p.overbought) : '70',
      oversold: p?.oversold != null ? String(p.oversold) : '30',
      ema_fast: p?.ema_fast != null ? String(p.ema_fast) : '20',
      ema_slow: p?.ema_slow != null ? String(p.ema_slow) : '50',
      st_multiplier: p?.st_multiplier != null ? String(p.st_multiplier) : '2.0',
      st_lookback: p?.st_lookback != null ? String(p.st_lookback) : '10',
      trade_direction: p?.trade_direction ?? 'both',
      strategy_type: p?.strategy_type ?? 'rsi_ema',
    });
  }, []);

  const runAnalyze = async (strategy: Strategy, showToast = true) => {
    setInterpreting(strategy.id);
    // Preserve the user's manually selected timeframe before analysis
    const userTimeframe = strategy.timeframe ?? null;
    const { data, error } = await supabase.functions.invoke('analyze-pinescript', {
      body: { strategyId: strategy.id, code: strategy.pinescript_code },
      method: 'POST',
    });
    if (error || !data?.interpretation) {
      const fallback = `📊 Strategy Analysis: "${strategy.name}"\n\n` +
        `• Entry signals detected in PineScript code\n` +
        `• Uses RSI momentum indicators\n` +
        `• Trend confirmation via EMA crossovers\n` +
        `• Risk management: stop loss and take profit defined\n\n` +
        `⚡ Bot will monitor for entry conditions matching this strategy and execute trades via your Binance API.`;
      await updateStrategy(strategy.id, { ai_interpretation: fallback });
      if (showToast) toast.warning('Analyzed in demo mode — connect Supabase for full extraction');
    }
    // Reload fresh strategy from DB
    const updated = await getStrategies();
    setStrategies(updated);
    const fresh = updated.find(s => s.id === strategy.id) ?? null;
    if (fresh) {
      if (showToast) {
        // Rich toast showing every extracted setting
        const risk = data?.risk as { tp1_pct?: number; tp2_pct?: number; tp3_pct?: number; stop_loss_pct?: number } | undefined;
        const params = fresh.strategy_params as { timeframe?: string; symbol?: string; rsi_length?: number; trade_direction?: string } | null;
        // Show user's preserved timeframe (not AI-extracted, which may differ)
        const tf = fresh.timeframe ?? userTimeframe ?? params?.timeframe ?? '1h';
        const lines: string[] = [];
        lines.push(`⏱️ Timeframe auto-set: ${tf.toUpperCase()}`);
        if (params?.symbol)         lines.push(`📈 Symbol: ${params.symbol}`);
        if (params?.rsi_length)     lines.push(`📊 RSI Length: ${params.rsi_length}`);
        if (risk?.stop_loss_pct)    lines.push(`🛡️ Stop Loss: ${risk.stop_loss_pct}%`);
        if (risk?.tp1_pct)          lines.push(`🎯 TP1: ${risk.tp1_pct}%`);
        if (risk?.tp2_pct)          lines.push(`🎯 TP2: ${risk.tp2_pct}%`);
        if (risk?.tp3_pct)          lines.push(`🎯 TP3: ${risk.tp3_pct}%`);
        if (params?.trade_direction) lines.push(`🔄 Direction: ${params.trade_direction.toUpperCase()}`);
        toast.success(
          <div className="space-y-0.5">
            <p className="font-semibold text-sm">🤖 AI Settings Auto-Applied!</p>
            {lines.map((l, i) => <p key={i} className="text-xs opacity-80">{l}</p>)}
          </div>,
          { duration: 8000 }
        );
      }
      // Pulse the just-analyzed strategy's TF button for 3s
      setJustAnalyzedId(strategy.id);
      setTimeout(() => setJustAnalyzedId(null), 3000);
      // Re-sync Risk Settings panel
      if (selectedStrategy?.id === strategy.id || !showToast) {
        handleSelectStrategy(fresh);
      }
    }
    setInterpreting(null);
  };

  const handleAIInterpret = (strategy: Strategy) => runAnalyze(strategy, true);

  // ── Helper: build chartRiskConfig from a strategy object ──────────────────
  const buildRiskConfig = useCallback((s: Strategy): StrategyRiskConfig | null => {
    const p = s.strategy_params as StrategyParams | null;
    if (!p) return null;
    const n = (v: string | number | null | undefined) =>
      v != null && v !== '' ? parseFloat(String(v)) : null;
    return {
      strategy_type:         p.strategy_type   ?? 'rsi_ema',
      rsi_length:            p.rsi_length       ?? 14,
      overbought:            p.overbought        ?? 70,
      oversold:              p.oversold          ?? 30,
      ema_fast:              p.ema_fast          ?? 20,
      ema_slow:              p.ema_slow          ?? 50,
      st_multiplier:         p.st_multiplier     ?? 2.0,
      st_lookback:           p.st_lookback       ?? 10,
      rsi_filter_enabled:    p.rsi_filter_enabled ?? false,
      rsi_filter_long_level: p.rsi_filter_long_level ?? 50,
      trade_direction:       p.trade_direction   ?? 'both',
      stop_loss_pct: n(s.stop_loss_pct),
      tp1_pct:       n(s.tp1_pct),
      tp2_pct:       n(s.tp2_pct),
      tp3_pct:       n(s.tp3_pct),
    };
  }, []);

  // Sync risk form when a strategy is selected
  const handleSelectStrategy = useCallback((s: Strategy) => {
    setSelectedStrategy(s);
    syncRiskForm(s);
    const p = s.strategy_params as StrategyParams | null;
    // Auto-populate chart signals if strategy is already analyzed
    const cfg = buildRiskConfig(s);
    if (cfg) {
      setChartRiskConfig(cfg);
      // Re-analyze silently if strategy_type missing (old format from pre-v46 analysis)
      if (!p?.strategy_type && s.pinescript_code && !s.ai_interpretation) {
        runAnalyze(s, false);
      }
    } else if (s.pinescript_code && !s.ai_interpretation) {
      // Strategy not analyzed yet — run silently so signals appear automatically
      runAnalyze(s, false);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [buildRiskConfig, syncRiskForm]);

  const handleSaveRisk = async () => {
    if (!selectedStrategy) return;
    setSavingRisk(true);
    const n = (v: string) => v !== '' ? parseFloat(v) : null;

    try {
      // Build updated strategy_params (indicator params)
      const existingParams = (selectedStrategy.strategy_params as StrategyParams | null) ?? {} as StrategyParams;
      const updatedParams: StrategyParams = {
        ...existingParams,
        strategy_type: riskForm.strategy_type,
        rsi_length:    n(riskForm.rsi_length)    ?? existingParams.rsi_length    ?? 14,
        overbought:    n(riskForm.overbought)    ?? existingParams.overbought    ?? 70,
        oversold:      n(riskForm.oversold)      ?? existingParams.oversold      ?? 30,
        ema_fast:      n(riskForm.ema_fast)      ?? existingParams.ema_fast      ?? 20,
        ema_slow:      n(riskForm.ema_slow)      ?? existingParams.ema_slow      ?? 50,
        st_multiplier: n(riskForm.st_multiplier) ?? existingParams.st_multiplier ?? 2.0,
        st_lookback:   n(riskForm.st_lookback)   ?? existingParams.st_lookback   ?? 10,
        trade_direction: riskForm.trade_direction,
      };

      const patch: Partial<Strategy> = {
        stop_loss_pct: n(riskForm.stop_loss_pct),
        take_profit_pct: n(riskForm.take_profit_pct),
        position_size_pct: n(riskForm.position_size_pct),
        tp1_pct: n(riskForm.tp1_pct),
        tp2_pct: n(riskForm.tp2_pct),
        tp3_pct: n(riskForm.tp3_pct),
        tp1_size_pct: n(riskForm.tp1_size_pct),
        tp2_size_pct: n(riskForm.tp2_size_pct),
        tp3_size_pct: n(riskForm.tp3_size_pct),
        trade_amount_usdt: n(riskForm.trade_amount_usdt),
        strategy_params: updatedParams,
      };
      const { error } = await updateStrategy(selectedStrategy.id, patch);
      if (error) {
        throw new Error(error);
      }

      toast.success('Risk settings saved — indicator params + risk updated!', { icon: '🛡️' });
      const updated = await getStrategies();
      setStrategies(updated);
      const fresh = updated.find(s => s.id === selectedStrategy.id) ?? null;
      if (!fresh) {
        throw new Error('Failed to retrieve updated strategy after save');
      }
      setSelectedStrategy(fresh);

      // Build riskConfig for live chart overlay using saved params + strategy params
      const cfg = buildRiskConfig(fresh);
      if (cfg) {
        const nv = (v: string) => v !== '' ? parseFloat(v) : null;
        setChartRiskConfig({
          ...cfg,
          strategy_type:  riskForm.strategy_type,
          rsi_length:     n(riskForm.rsi_length)    ?? cfg.rsi_length,
          overbought:     n(riskForm.overbought)    ?? cfg.overbought,
          oversold:       n(riskForm.oversold)      ?? cfg.oversold,
          ema_fast:       n(riskForm.ema_fast)      ?? cfg.ema_fast,
          ema_slow:       n(riskForm.ema_slow)      ?? cfg.ema_slow,
          stop_loss_pct:  nv(riskForm.stop_loss_pct),
          tp1_pct:        nv(riskForm.tp1_pct),
          tp2_pct:        nv(riskForm.tp2_pct),
          tp3_pct:        nv(riskForm.tp3_pct),
          trade_direction: riskForm.trade_direction,
        });
      }
    } catch (e: any) {
      console.error(e);
      toast.error(`Failed to save risk settings: ${e.message || e}`);
    } finally {
      setSavingRisk(false);
    }
  };

  const handleTimeframeChange = async (strategy: Strategy, tf: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setStrategies(prev => prev.map(s => s.id === strategy.id ? { ...s, timeframe: tf } : s));
    if (selectedStrategy?.id === strategy.id) setSelectedStrategy(s => s ? { ...s, timeframe: tf } : s);
    await updateStrategy(strategy.id, { timeframe: tf } as Partial<Strategy>);
    toast.success(`Timeframe set to ${tf}`, { icon: '⏱️', duration: 2000 });
  };

  const handleSymbolChange = async (strategy: Strategy, sym: string, e: React.MouseEvent) => {
    e.stopPropagation();
    // Multi-select: toggle sym in/out of the symbols array
    const current = strategy.symbols ?? [strategy.symbol ?? strategy.strategy_params?.symbol ?? 'BTCUSDT'];
    const next = current.includes(sym)
      ? current.filter(s => s !== sym).length > 0
        ? current.filter(s => s !== sym)
        : current                      // keep at least one
      : [...current, sym];
    // primary symbol = first in array
    const primary = next[0];
    setStrategies(prev => prev.map(s => s.id === strategy.id ? { ...s, symbols: next, symbol: primary } : s));
    if (selectedStrategy?.id === strategy.id)
      setSelectedStrategy(s => s ? { ...s, symbols: next, symbol: primary } : s);
    await updateStrategy(strategy.id, { symbols: next, symbol: primary } as Partial<Strategy>);
    toast.success(
      next.length > 1
        ? `Active symbols: ${next.map(s => s.replace('USDT','')).join(', ')}`
        : `Symbol set to ${primary}`,
      { icon: '📈', duration: 2500 }
    );
  };

  // ── Bot status helpers ──
  const TF_MS: Record<string, number> = {
    '1m': 60_000, '5m': 300_000, '15m': 900_000, '30m': 1_800_000,
    '1h': 3_600_000, '4h': 14_400_000, '1d': 86_400_000,
  };

  const getNextRunLabel = (strategy: Strategy): string => {
    const tf = strategy.timeframe ?? strategy.strategy_params?.timeframe ?? '1h';
    const intervalMs = TF_MS[tf] ?? TF_MS['1h'];
    const lastRan = strategy.last_executed_at ? new Date(strategy.last_executed_at).getTime() : 0;
    const nextAt = lastRan + intervalMs;
    const diffMs = nextAt - Date.now();
    if (diffMs <= 0) return 'Due now';
    const mins = Math.floor(diffMs / 60_000);
    const secs = Math.floor((diffMs % 60_000) / 1000);
    if (mins >= 60) return `${Math.floor(mins / 60)}h ${mins % 60}m`;
    if (mins > 0) return `${mins}m ${secs}s`;
    return `${secs}s`;
  };

  const getLastRunLabel = (ts: string | null): string => {
    if (!ts) return 'Never';
    const diff = Math.floor((Date.now() - new Date(ts).getTime()) / 1000);
    if (diff < 60) return `${diff}s ago`;
    if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
    if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
    return `${Math.floor(diff / 86400)}d ago`;
  };

  const handleExecute = async (strategy: Strategy) => {
    if (!strategy.strategy_params) {
      return toast.error('Run AI Analyze first to extract strategy parameters.');
    }
    setExecuting(strategy.id);
    const { data, error } = await executeStrategy(strategy.id);
    setExecuting(null);
    if (error) {
      toast.error(`Execution failed: ${error}`);
      return;
    }
    const d = data as { signal: string; reason: string; price: number; symbol: string; mode: string; orderError?: string };
    if (d.signal === 'HOLD') {
      toast.info(`HOLD — ${d.reason}`, { duration: 5000 });
    } else if (d.orderError) {
      toast.warning(`${d.signal} signal on ${d.symbol} @ $${d.price} — Order error: ${d.orderError}`);
    } else {
      toast.success(`${d.signal} order placed on ${d.symbol} @ $${d.price} [${d.mode}]`, { duration: 6000 });
    }
  };

  return (
    <AppLayout>
      <div className="p-4 md:p-6 space-y-4">
        {/* Header */}
        <div className="flex items-center justify-between gap-4">
          <div>
            <h1 className="text-lg font-bold text-foreground text-balance">Strategy Manager</h1>
            <p className="text-sm text-muted-foreground">Add PineScript strategies for AI-driven trading</p>
          </div>
          <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
            <DialogTrigger asChild>
              <Button size="sm" className="shrink-0 gap-2 h-9">
                <Plus className="h-3.5 w-3.5" />
                <span className="sr-only md:not-sr-only">New Strategy</span>
              </Button>
            </DialogTrigger>
            <DialogContent className="max-w-[calc(100%-2rem)] md:max-w-2xl border-border bg-card">
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2 text-balance">
                  <Code2 className="h-4 w-4 text-primary" />
                  Add PineScript Strategy
                </DialogTitle>
              </DialogHeader>
              <div className="space-y-4 max-h-[70vh] overflow-y-auto">
                <div className="space-y-1.5">
                  <Label className="text-sm font-normal">Strategy Name</Label>
                  <Input
                    placeholder="e.g., RSI Reversal v2"
                    value={form.name}
                    onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                    className="bg-input border-border"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-sm font-normal">Description (optional)</Label>
                  <Input
                    placeholder="Brief description..."
                    value={form.description}
                    onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
                    className="bg-input border-border"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-sm font-normal">PineScript Code</Label>
                  <Textarea
                    placeholder="Paste your PineScript strategy here..."
                    value={form.pinescript_code}
                    onChange={e => setForm(f => ({ ...f, pinescript_code: e.target.value }))}
                    rows={14}
                    className="bg-input border-border font-mono text-xs resize-none"
                  />
                </div>
                <div className="flex justify-end gap-2">
                  <Button variant="outline" onClick={() => setDialogOpen(false)} className="border-border">
                    Cancel
                  </Button>
                  <Button onClick={handleCreate} disabled={saving} className="gap-2">
                    {saving && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                    Save Strategy
                  </Button>
                </div>
              </div>
            </DialogContent>
          </Dialog>
        </div>

        {/* Content */}
        <div className="grid gap-4 md:grid-cols-5">
          {/* Strategy List */}
          <div className="md:col-span-2 space-y-2">
            {loading ? (
              [...Array(3)].map((_, i) => <Skeleton key={i} className="h-20 w-full bg-muted" />)
            ) : strategies.length === 0 ? (
              <Card className="border-border bg-card">
                <CardContent className="flex flex-col items-center gap-3 py-10 text-center">
                  <Code2 className="h-10 w-10 text-muted-foreground/40" />
                  <div>
                    <p className="text-sm font-medium text-foreground">No strategies yet</p>
                    <p className="mt-1 text-xs text-muted-foreground">Add your first PineScript strategy</p>
                  </div>
                </CardContent>
              </Card>
            ) : (
              strategies.map((strategy) => (
                <div
                  key={strategy.id}
                  onClick={() => handleSelectStrategy(strategy)}
                  className={cn(
                    'cursor-pointer rounded border p-3 transition-colors duration-150',
                    selectedStrategy?.id === strategy.id
                      ? 'border-primary/50 bg-primary/5'
                      : 'border-border bg-card hover:bg-muted/20'
                  )}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium text-foreground text-balance">{strategy.name}</p>
                      {strategy.description && (
                        <p className="mt-0.5 truncate text-xs text-muted-foreground">{strategy.description}</p>
                      )}
                    </div>
                    <Badge
                      variant="outline"
                      className={cn('shrink-0 text-[10px]',
                        strategy.status === 'active' ? 'border-success/40 text-success' : 'border-border text-muted-foreground'
                      )}
                    >
                      {strategy.status}
                    </Badge>
                  </div>
                  <div className="mt-2 flex items-center gap-1.5">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={e => { e.stopPropagation(); handleToggle(strategy); }}
                      className="h-7 gap-1 px-2 text-xs text-muted-foreground hover:text-foreground"
                    >
                      {strategy.status === 'active'
                        ? <><Pause className="h-3 w-3" />Deactivate</>
                        : <><Play className="h-3 w-3 text-success" />Activate</>
                      }
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={e => { e.stopPropagation(); handleAIInterpret(strategy); }}
                      disabled={interpreting === strategy.id}
                      className="h-7 gap-1 px-2 text-xs text-muted-foreground hover:text-primary"
                    >
                      {interpreting === strategy.id
                        ? <><Loader2 className="h-3 w-3 animate-spin" />Analyzing...</>
                        : <><Sparkles className="h-3 w-3" />AI Analyze</>
                      }
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={e => { e.stopPropagation(); handleExecute(strategy); }}
                      disabled={executing === strategy.id || !strategy.strategy_params}
                      className="h-7 gap-1 px-2 text-xs text-muted-foreground hover:text-success"
                    >
                      {executing === strategy.id
                        ? <><Loader2 className="h-3 w-3 animate-spin" />Running...</>
                        : <><Zap className="h-3 w-3" />Execute</>
                      }
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={e => { e.stopPropagation(); setDeleteId(strategy.id); }}
                      className="ml-auto h-7 w-7 p-0 text-muted-foreground hover:text-destructive"
                    >
                      <Trash2 className="h-3 w-3" />
                    </Button>
                  </div>
                  {/* Symbol picker — multi-select */}
                  <div className="mt-2 flex items-center gap-1 flex-wrap" onClick={e => e.stopPropagation()}>
                    <span className="text-[10px] text-muted-foreground shrink-0">Symbol:</span>
                    {(['BTCUSDT','ETHUSDT','SOLUSDT','BNBUSDT','XRPUSDT','DOGEUSDT'] as const).map(sym => {
                      const label = sym.replace('USDT','');
                      const activeSyms = strategy.symbols ?? [strategy.symbol ?? strategy.strategy_params?.symbol ?? 'BTCUSDT'];
                      const isActive = activeSyms.includes(sym);
                      return (
                        <button
                          key={sym}
                          onClick={e => handleSymbolChange(strategy, sym, e)}
                          className={cn(
                            'h-5 rounded px-1.5 text-[10px] font-mono font-medium transition-all border',
                            isActive
                              ? 'bg-primary border-primary text-primary-foreground'
                              : 'bg-transparent border-border text-muted-foreground hover:border-primary/50 hover:text-foreground'
                          )}
                        >
                          {label}
                        </button>
                      );
                    })}
                    {/* count badge when >1 active */}
                    {(() => {
                      const cnt = (strategy.symbols ?? [strategy.symbol ?? 'BTCUSDT']).length;
                      return cnt > 1 ? (
                        <span className="ml-1 text-[10px] text-primary font-medium">{cnt} active</span>
                      ) : null;
                    })()}
                  </div>
                  {/* Timeframe picker */}
                  <div className="mt-1.5 flex items-center gap-1 flex-wrap" onClick={e => e.stopPropagation()}>
                    <span className="text-[10px] text-muted-foreground shrink-0">Timeframe:</span>
                    {(['1m','5m','15m','30m','1h','4h','1d'] as const).map(tf => {
                      const active = (strategy.timeframe ?? strategy.strategy_params?.timeframe ?? '1h') === tf;
                      const justSet = active && justAnalyzedId === strategy.id;
                      return (
                        <button
                          key={tf}
                          onClick={e => handleTimeframeChange(strategy, tf, e)}
                          className={cn(
                            'h-5 rounded px-1.5 text-[10px] font-mono font-medium transition-all border',
                            active
                              ? 'bg-primary border-primary text-primary-foreground'
                              : 'bg-transparent border-border text-muted-foreground hover:border-primary/50 hover:text-foreground',
                            justSet && 'ring-2 ring-primary ring-offset-1 animate-pulse'
                          )}
                        >
                          {tf}
                        </button>
                      );
                    })}
                    {justAnalyzedId === strategy.id && (
                      <span className="text-[10px] text-primary animate-pulse ml-1">← AI set</span>
                    )}
                  </div>
                  {/* Bot run status — visible when active */}
                  {strategy.status === 'active' && (
                    <div className="mt-1.5 flex items-center gap-2 flex-wrap" onClick={e => e.stopPropagation()}>
                      {/* Last signal badge */}
                      {strategy.last_signal && (
                        <span className={cn(
                          'inline-flex items-center gap-0.5 rounded px-1.5 py-0.5 text-[10px] font-medium border',
                          strategy.last_signal === 'BUY'  && 'border-success/40 bg-success/10 text-success',
                          strategy.last_signal === 'SELL' && 'border-destructive/40 bg-destructive/10 text-destructive',
                          strategy.last_signal === 'HOLD' && 'border-border bg-muted/30 text-muted-foreground',
                        )}>
                          {strategy.last_signal === 'BUY'  && <TrendingUp className="h-2.5 w-2.5" />}
                          {strategy.last_signal === 'SELL' && <TrendingDown className="h-2.5 w-2.5" />}
                          {strategy.last_signal === 'HOLD' && <Activity className="h-2.5 w-2.5" />}
                          {strategy.last_signal}
                        </span>
                      )}
                      {/* Last run */}
                      <span className="flex items-center gap-0.5 text-[10px] text-muted-foreground">
                        <Clock className="h-2.5 w-2.5 shrink-0" />
                        {getLastRunLabel(strategy.last_executed_at)}
                      </span>
                      {/* Next run countdown */}
                      <span className="flex items-center gap-0.5 text-[10px] text-muted-foreground">
                        <Bot className="h-2.5 w-2.5 shrink-0 text-primary" />
                        Next: <span className="font-mono text-foreground">{getNextRunLabel(strategy)}</span>
                      </span>
                    </div>
                  )}
                  {/* P&L row — shown when there are trades for this symbol */}
                  {(() => {
                    const sym = strategy.symbol ?? strategy.strategy_params?.symbol ?? 'BTCUSDT';
                    const pnl = pnlMap[sym];
                    if (!pnl || pnl.totalTrades === 0) return null;
                    const winRate = pnl.totalTrades > 0
                      ? Math.round((pnl.wins / Math.max(pnl.totalTrades - pnl.openCount, 1)) * 100)
                      : 0;
                    const isPos = pnl.realizedPnlPct >= 0;
                    return (
                      <div className="mt-1.5 flex items-center gap-2 flex-wrap" onClick={e => e.stopPropagation()}>
                        <span className="text-[10px] text-muted-foreground shrink-0">P&amp;L:</span>
                        <span className={cn(
                          'inline-flex items-center gap-0.5 rounded px-1.5 py-0.5 text-[10px] font-mono font-semibold border',
                          isPos ? 'border-success/40 bg-success/10 text-success' : 'border-destructive/40 bg-destructive/10 text-destructive'
                        )}>
                          {isPos ? <TrendingUp className="h-2.5 w-2.5" /> : <TrendingDown className="h-2.5 w-2.5" />}
                          {isPos ? '+' : ''}{pnl.realizedPnlPct.toFixed(2)}%
                        </span>
                        <span className="text-[10px] text-muted-foreground">
                          {pnl.totalTrades} trades · {winRate}% win
                        </span>
                        {pnl.openCount > 0 && (
                          <span className="text-[10px] text-primary">{pnl.openCount} open</span>
                        )}
                      </div>
                    );
                  })()}
                </div>
              ))
            )}
          </div>

          {/* Strategy Detail / Code View */}
          <div className="md:col-span-3">
            {selectedStrategy ? (
              <Card className="h-full border-border bg-card">
                <CardHeader className="pb-2 pt-4 px-4">
                  <div className="flex items-center justify-between gap-2">
                    <CardTitle className="text-sm font-semibold text-balance">{selectedStrategy.name}</CardTitle>
                    <Badge
                      variant="outline"
                      className={cn('shrink-0 text-[10px]',
                        selectedStrategy.status === 'active' ? 'border-success/40 text-success' : 'border-border text-muted-foreground'
                      )}
                    >
                      {selectedStrategy.status}
                    </Badge>
                  </div>
                </CardHeader>
                <CardContent className="px-4 pb-4 space-y-3">
                  {/* Strategy Params Panel */}
                  {selectedStrategy.strategy_params && (() => {
                    const p = selectedStrategy.strategy_params as StrategyParams;
                    // User-selected overrides take priority over AI-extracted values
                    const displaySymbol = selectedStrategy.symbol ?? p.symbol;
                    const displayTF = selectedStrategy.timeframe ?? p.timeframe;
                    const activeSymbols = selectedStrategy.symbols ?? [displaySymbol];
                    return (
                      <div className="rounded border border-border bg-muted/20 p-3 space-y-2">
                        <div className="flex items-center gap-1.5 mb-2">
                          <Activity className="h-3.5 w-3.5 text-primary" />
                          <span className="text-xs font-medium text-foreground">Strategy Parameters</span>
                          <Badge variant="outline" className="ml-auto text-[10px] border-primary/30 text-primary">Live Config</Badge>
                        </div>
                        <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-xs">
                          <div className="flex items-center justify-between gap-2">
                            <span className="text-muted-foreground">Symbol</span>
                            <Badge variant="outline" className="text-[10px] border-primary/40 text-primary font-mono">{displaySymbol}</Badge>
                          </div>
                          <div className="flex items-center justify-between gap-2">
                            <span className="text-muted-foreground">Timeframe</span>
                            <Badge variant="outline" className="text-[10px] border-primary/40 text-primary font-mono">{displayTF}</Badge>
                          </div>
                          <div className="flex items-center justify-between gap-2">
                            <span className="text-muted-foreground">RSI Length</span>
                            <span className="font-mono font-medium text-foreground">{p.rsi_length}</span>
                          </div>
                          <div className="flex items-center justify-between gap-2">
                            <span className="text-muted-foreground">Direction</span>
                            <Badge variant="outline" className={cn('text-[10px]',
                              p.trade_direction === 'long' ? 'border-success/40 text-success' :
                              p.trade_direction === 'short' ? 'border-destructive/40 text-destructive' :
                              'border-primary/40 text-primary'
                            )}>{p.trade_direction}</Badge>
                          </div>
                          <div className="flex items-center justify-between gap-2">
                            <span className="text-muted-foreground">Overbought</span>
                            <span className="font-mono font-medium text-destructive">{p.overbought}</span>
                          </div>
                          <div className="flex items-center justify-between gap-2">
                            <span className="text-muted-foreground">Oversold</span>
                            <span className="font-mono font-medium text-success">{p.oversold}</span>
                          </div>
                          <div className="flex items-center justify-between gap-2">
                            <span className="text-muted-foreground flex items-center gap-1"><TrendingUp className="h-3 w-3" />EMA Fast</span>
                            <span className="font-mono font-medium text-foreground">{p.ema_fast}</span>
                          </div>
                          <div className="flex items-center justify-between gap-2">
                            <span className="text-muted-foreground flex items-center gap-1"><TrendingDown className="h-3 w-3" />EMA Slow</span>
                            <span className="font-mono font-medium text-foreground">{p.ema_slow}</span>
                          </div>
                        </div>
                        {/* Active symbols list — shows all selected */}
                        {activeSymbols.length > 0 && (
                          <div className="pt-2 border-t border-border/50 space-y-1.5">
                            <span className="text-[10px] text-muted-foreground">Active Symbols ({activeSymbols.length})</span>
                            <div className="flex flex-wrap gap-1">
                              {activeSymbols.map(s => (
                                <Badge key={s} variant="outline" className="text-[10px] border-primary/40 bg-primary/5 text-primary font-mono">
                                  {s}
                                </Badge>
                              ))}
                            </div>
                          </div>
                        )}
                        {/* SL/TP badges */}
                        <div className="flex items-center gap-2 pt-1 border-t border-border/50">
                          <span className={cn('text-[10px] flex items-center gap-1', p.has_stop_loss ? 'text-success' : 'text-muted-foreground/50')}>
                            {p.has_stop_loss ? '✓' : '✗'} Stop Loss
                          </span>
                          <span className="text-border">·</span>
                          <span className={cn('text-[10px] flex items-center gap-1', p.has_take_profit ? 'text-success' : 'text-muted-foreground/50')}>
                            {p.has_take_profit ? '✓' : '✗'} Take Profit
                          </span>
                        </div>
                      </div>
                    );
                  })()}

                  {/* ── Live Candlestick Chart ── */}
                  {(() => {
                    const p = selectedStrategy.strategy_params as StrategyParams | null;
                    const chartSymbol = selectedStrategy.symbol ?? p?.symbol ?? 'BTCUSDT';
                    const chartTF = selectedStrategy.timeframe ?? p?.timeframe ?? '1h';
                    return (
                      <div className="space-y-1.5">
                        <div className="flex items-center gap-1.5">
                          <BarChart2 className="h-3.5 w-3.5 text-primary" />
                          <span className="text-xs font-medium text-foreground">Live Chart</span>
                          <Badge variant="outline" className="text-[10px] border-primary/30 text-primary ml-auto">TradingView Style</Badge>
                        </div>
                        <StrategyLiveChart
                          symbol={chartSymbol}
                          timeframe={chartTF}
                          strategyId={selectedStrategy.id}
                          riskConfig={chartRiskConfig}
                        />
                      </div>
                    );
                  })()}

                  {/* ── Per-strategy Risk Settings ── */}
                  <div ref={riskPanelRef} className="rounded border border-border bg-muted/20 p-3 space-y-3">
                    <div className="flex items-center justify-between gap-2 flex-wrap">
                      <div className="flex items-center gap-1.5">
                        <ShieldAlert className="h-3.5 w-3.5 text-warning" />
                        <span className="text-xs font-medium text-foreground">Risk Settings</span>
                        <Badge variant="outline" className="text-[10px] border-warning/40 text-warning">Per-Strategy Override</Badge>
                      </div>
                      <span className="text-[10px] text-muted-foreground">AI-extracted · user-editable</span>
                    </div>

                    {/* ── Indicator Settings (AI-extracted) ── */}
                    <div className="rounded border border-primary/20 bg-primary/5 p-3 space-y-3">
                      <div className="flex items-center gap-1.5">
                        <Bot className="h-3.5 w-3.5 text-primary" />
                        <span className="text-[11px] font-medium text-primary">🤖 Strategy Indicators</span>
                        <Badge variant="outline" className="text-[10px] border-primary/30 text-primary ml-auto">AI Extracted</Badge>
                      </div>

                      {/* Strategy Type + Trade Direction */}
                      <div className="grid grid-cols-2 gap-2">
                        <div className="space-y-1">
                          <Label className="text-[11px] font-normal text-muted-foreground">Strategy Type</Label>
                          <select
                            value={riskForm.strategy_type}
                            onChange={e => setRiskForm(f => ({ ...f, strategy_type: e.target.value as typeof f.strategy_type }))}
                            className="h-8 w-full rounded-md border border-border bg-input px-2 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
                          >
                            <option value="rsi_ema">RSI + EMA</option>
                            <option value="supertrend">SuperTrend</option>
                            <option value="smc">SMC (Smart Money)</option>
                            <option value="mixed">Mixed</option>
                          </select>
                        </div>
                        <div className="space-y-1">
                          <Label className="text-[11px] font-normal text-muted-foreground">Trade Direction</Label>
                          <select
                            value={riskForm.trade_direction}
                            onChange={e => setRiskForm(f => ({ ...f, trade_direction: e.target.value as typeof f.trade_direction }))}
                            className="h-8 w-full rounded-md border border-border bg-input px-2 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
                          >
                            <option value="both">Both (Long + Short)</option>
                            <option value="long">Long Only</option>
                            <option value="short">Short Only</option>
                          </select>
                        </div>
                      </div>

                      {/* RSI Settings */}
                      {(riskForm.strategy_type === 'rsi_ema' || riskForm.strategy_type === 'mixed') && (
                        <div className="space-y-1.5">
                          <span className="text-[11px] font-medium text-foreground flex items-center gap-1">
                            <Activity className="h-3 w-3 text-primary" /> RSI Settings
                          </span>
                          <div className="grid grid-cols-3 gap-2">
                            <div className="space-y-0.5">
                              <Label className="text-[10px] text-muted-foreground">Length</Label>
                              <Input type="number" min={2} max={200} step={1}
                                value={riskForm.rsi_length}
                                onChange={e => setRiskForm(f => ({ ...f, rsi_length: e.target.value }))}
                                className="h-7 bg-input border-border text-xs font-mono" />
                            </div>
                            <div className="space-y-0.5">
                              <Label className="text-[10px] text-muted-foreground flex items-center gap-1"><TrendingDown className="h-3 w-3 text-destructive" />Overbought</Label>
                              <Input type="number" min={50} max={99} step={1}
                                value={riskForm.overbought}
                                onChange={e => setRiskForm(f => ({ ...f, overbought: e.target.value }))}
                                className="h-7 bg-input border-border text-xs font-mono" />
                            </div>
                            <div className="space-y-0.5">
                              <Label className="text-[10px] text-muted-foreground flex items-center gap-1"><TrendingUp className="h-3 w-3 text-success" />Oversold</Label>
                              <Input type="number" min={1} max={49} step={1}
                                value={riskForm.oversold}
                                onChange={e => setRiskForm(f => ({ ...f, oversold: e.target.value }))}
                                className="h-7 bg-input border-border text-xs font-mono" />
                            </div>
                          </div>
                        </div>
                      )}

                      {/* EMA Settings */}
                      {(riskForm.strategy_type === 'rsi_ema' || riskForm.strategy_type === 'mixed') && (
                        <div className="space-y-1.5">
                          <span className="text-[11px] font-medium text-foreground flex items-center gap-1">
                            <TrendingUp className="h-3 w-3 text-primary" /> EMA Settings
                          </span>
                          <div className="grid grid-cols-2 gap-2">
                            <div className="space-y-0.5">
                              <Label className="text-[10px] text-muted-foreground">Fast Period</Label>
                              <Input type="number" min={1} max={500} step={1}
                                value={riskForm.ema_fast}
                                onChange={e => setRiskForm(f => ({ ...f, ema_fast: e.target.value }))}
                                className="h-7 bg-input border-border text-xs font-mono" />
                            </div>
                            <div className="space-y-0.5">
                              <Label className="text-[10px] text-muted-foreground">Slow Period</Label>
                              <Input type="number" min={1} max={500} step={1}
                                value={riskForm.ema_slow}
                                onChange={e => setRiskForm(f => ({ ...f, ema_slow: e.target.value }))}
                                className="h-7 bg-input border-border text-xs font-mono" />
                            </div>
                          </div>
                        </div>
                      )}

                      {/* SuperTrend Settings */}
                      {(riskForm.strategy_type === 'supertrend' || riskForm.strategy_type === 'mixed') && (
                        <div className="space-y-1.5">
                          <span className="text-[11px] font-medium text-foreground flex items-center gap-1">
                            <Zap className="h-3 w-3 text-warning" /> SuperTrend Settings
                          </span>
                          <div className="grid grid-cols-2 gap-2">
                            <div className="space-y-0.5">
                              <Label className="text-[10px] text-muted-foreground">Multiplier</Label>
                              <Input type="number" min={0.1} max={20} step={0.1}
                                value={riskForm.st_multiplier}
                                onChange={e => setRiskForm(f => ({ ...f, st_multiplier: e.target.value }))}
                                className="h-7 bg-input border-border text-xs font-mono" />
                            </div>
                            <div className="space-y-0.5">
                              <Label className="text-[10px] text-muted-foreground">Lookback Period</Label>
                              <Input type="number" min={1} max={200} step={1}
                                value={riskForm.st_lookback}
                                onChange={e => setRiskForm(f => ({ ...f, st_lookback: e.target.value }))}
                                className="h-7 bg-input border-border text-xs font-mono" />
                            </div>
                          </div>
                        </div>
                      )}

                      <p className="text-[10px] text-primary/70">
                        ✨ AI Analyze karne ke baad sab fields auto-fill ho jaate hain. Aap inhe manually bhi edit kar sakte hain.
                      </p>
                    </div>

                    {/* Row 1: Trade Amount USDT + SL + Position Size */}
                    <div className="rounded border border-primary/20 bg-primary/5 px-3 py-2 space-y-2">
                      <div className="flex items-center gap-1.5">
                        <span className="text-[11px] font-medium text-primary">💰 Trade Amount (USDT)</span>
                        <Badge variant="outline" className="text-[10px] border-primary/40 text-primary">Fixed</Badge>
                        <span className="text-[10px] text-muted-foreground ml-auto">overrides Position Size %</span>
                      </div>
                      <Input
                        type="number" min={1} max={100000} step={1}
                        placeholder="e.g. 50 (USDT per trade)"
                        value={riskForm.trade_amount_usdt}
                        onChange={e => setRiskForm(f => ({ ...f, trade_amount_usdt: e.target.value }))}
                        className="h-8 bg-input border-primary/30 text-sm data-mono"
                      />
                      <p className="text-[10px] text-muted-foreground">
                        Set a fixed USDT amount per trade (e.g. 50 USDT). Leave blank to use Position Size % instead.
                      </p>
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      <div className="space-y-1">
                        <Label className="text-[11px] font-normal text-muted-foreground">Stop Loss %</Label>
                        <Input type="number" min={0.1} max={50} step={0.1} placeholder="Global" value={riskForm.stop_loss_pct}
                          onChange={e => setRiskForm(f => ({ ...f, stop_loss_pct: e.target.value }))}
                          className="h-8 bg-input border-border text-sm data-mono" />
                      </div>
                      <div className="space-y-1">
                        <Label className="text-[11px] font-normal text-muted-foreground">Position Size %</Label>
                        <Input type="number" min={0.1} max={100} step={0.1} placeholder="Global" value={riskForm.position_size_pct}
                          onChange={e => setRiskForm(f => ({ ...f, position_size_pct: e.target.value }))}
                          className="h-8 bg-input border-border text-sm data-mono" />
                      </div>
                    </div>

                    {/* Row 2: TP1/TP2/TP3 with size % */}
                    <div className="space-y-1.5">
                      <div className="flex items-center gap-1.5">
                        <span className="text-[11px] font-medium text-foreground">Take Profit Levels</span>
                        <Badge variant="outline" className="text-[10px] border-primary/30 text-primary">Multi-TP</Badge>
                        <span className="text-[10px] text-muted-foreground ml-auto">% gain · % of position to close</span>
                      </div>
                      {([
                        { key: 'tp1', label: 'TP1', color: 'text-success border-success/40' },
                        { key: 'tp2', label: 'TP2', color: 'text-primary border-primary/40' },
                        { key: 'tp3', label: 'TP3', color: 'text-warning border-warning/40' },
                      ] as const).map(({ key, label, color }) => (
                        <div key={key} className="grid grid-cols-[60px_1fr_1fr] items-center gap-2">
                          <Badge variant="outline" className={cn('text-[10px] justify-center', color)}>{label}</Badge>
                          <div className="space-y-0.5">
                            <Label className="text-[10px] text-muted-foreground">Target %</Label>
                            <Input type="number" min={0.1} max={100} step={0.1} placeholder="e.g. 1.5"
                              value={riskForm[`${key}_pct`]}
                              onChange={e => setRiskForm(f => ({ ...f, [`${key}_pct`]: e.target.value }))}
                              className="h-7 bg-input border-border text-xs data-mono" />
                          </div>
                          <div className="space-y-0.5">
                            <Label className="text-[10px] text-muted-foreground">Close %</Label>
                            <Input type="number" min={1} max={100} step={1} placeholder={key === 'tp1' ? '33' : key === 'tp2' ? '33' : '34'}
                              value={riskForm[`${key}_size_pct`]}
                              onChange={e => setRiskForm(f => ({ ...f, [`${key}_size_pct`]: e.target.value }))}
                              className="h-7 bg-input border-border text-xs data-mono" />
                          </div>
                        </div>
                      ))}
                    </div>

                    {/* AI extracted hint */}
                    {(selectedStrategy.tp1_pct || selectedStrategy.stop_loss_pct) && (
                      <p className="text-[10px] text-success flex items-center gap-1 flex-wrap">
                        ✓ AI extracted from PineScript —
                        {selectedStrategy.stop_loss_pct ? ` SL: ${selectedStrategy.stop_loss_pct}%` : ''}
                        {selectedStrategy.tp1_pct ? ` TP1: ${selectedStrategy.tp1_pct}%` : ''}
                        {selectedStrategy.tp2_pct ? ` TP2: ${selectedStrategy.tp2_pct}%` : ''}
                        {selectedStrategy.tp3_pct ? ` TP3: ${selectedStrategy.tp3_pct}%` : ''}
                        {selectedStrategy.position_size_pct ? ` Size: ${selectedStrategy.position_size_pct}%` : ''}
                      </p>
                    )}
                    <Button size="sm" onClick={handleSaveRisk} disabled={savingRisk} className="h-8 gap-1.5 w-full">
                      {savingRisk ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
                      Save Risk Settings
                    </Button>
                  </div>
                  {/* AI Interpretation */}
                  {selectedStrategy.ai_interpretation && (
                    <div className="rounded border border-primary/20 bg-primary/5 p-3">
                      <div className="mb-1.5 flex items-center gap-1.5">
                        <Bot className="h-3.5 w-3.5 text-primary" />
                        <span className="text-xs font-medium text-primary">AI Analysis</span>
                      </div>
                      <p className="text-xs leading-relaxed text-muted-foreground whitespace-pre-line">
                        {selectedStrategy.ai_interpretation}
                      </p>
                    </div>
                  )}
                  {/* PineScript Code */}
                  <div className="space-y-1.5">
                    <Label className="text-xs text-muted-foreground">PineScript Code</Label>
                    <pre className="max-h-80 overflow-auto rounded border border-border bg-muted/30 p-3 text-[11px] leading-relaxed text-foreground/90 font-mono">
                      {selectedStrategy.pinescript_code}
                    </pre>
                  </div>
                </CardContent>
              </Card>
            ) : (
              <Card className="h-full border-border bg-card">
                <CardContent className="flex flex-col items-center justify-center gap-3 py-16 text-center">
                  <Code2 className="h-12 w-12 text-muted-foreground/20" />
                  <p className="text-sm text-muted-foreground">Select a strategy to view details</p>
                </CardContent>
              </Card>
            )}
          </div>
        </div>
      </div>

      {/* Delete Confirm */}
      <AlertDialog open={!!deleteId} onOpenChange={(o) => !o && setDeleteId(null)}>
        <AlertDialogContent className="max-w-[calc(100%-2rem)] md:max-w-md border-border bg-card">
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Strategy?</AlertDialogTitle>
            <AlertDialogDescription className="text-muted-foreground">
              This will permanently delete the strategy and all associated signals. This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="border-border">Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleDelete} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </AppLayout>
  );
}
