import React, { useEffect, useState, useCallback } from 'react';
import { AppLayout } from '@/components/layouts/AppLayout';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger,
} from '@/components/ui/dialog';
import {
  Area, BarChart, Bar, ComposedChart,
  ResponsiveContainer, XAxis, YAxis, Tooltip, CartesianGrid, Legend,
} from 'recharts';
import {
  FlaskConical, Play, Save, Trash2, TrendingUp, TrendingDown,
  BarChart3, ArrowUpRight, ArrowDownRight, Loader2, ChevronDown, ChevronUp,
  DatabaseZap,
} from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '@/db/supabase';
import { getStrategies } from '@/services/api';
import type { Strategy, BacktestResult, EquityPoint, BacktestTrade, OHLCVBar } from '@/types/types';
import { CandlestickChart } from '@/components/charts/CandlestickChart';
import { cn } from '@/lib/utils';

const COMMON_SYMBOLS = [
  'BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'BNBUSDT', 'AVAXUSDT',
  'ADAUSDT', 'DOTUSDT', 'MATICUSDT', 'LINKUSDT', 'NEARUSDT',
  'ARBUSDT', 'OPUSDT', 'INJUSDT', 'SUIUSDT',
];

const TIMEFRAMES = ['1m', '5m', '15m', '1h', '4h', '1d'];

// ─── Sub-components ──────────────────────────────────────────────────────────

function MetricCard({
  label, value, sub, positive, icon: Icon,
}: { label: string; value: string; sub?: string; positive?: boolean; icon?: React.ElementType }) {
  return (
    <div className="rounded border border-border bg-muted/20 p-3">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-[11px] text-muted-foreground">{label}</p>
          <p className={cn(
            'mt-0.5 text-lg font-bold data-mono',
            positive === true ? 'text-success' : positive === false ? 'text-destructive' : 'text-foreground'
          )}>
            {value}
          </p>
          {sub && <p className="text-[10px] text-muted-foreground">{sub}</p>}
        </div>
        {Icon && (
          <div className={cn('flex h-7 w-7 shrink-0 items-center justify-center rounded',
            positive === true ? 'bg-success/10 text-success' :
              positive === false ? 'bg-destructive/10 text-destructive' :
                'bg-primary/10 text-primary'
          )}>
            <Icon className="h-3.5 w-3.5" />
          </div>
        )}
      </div>
    </div>
  );
}

function EquityCurveChart({ data }: { data: EquityPoint[] }) {
  if (data.length === 0) return null;
  const step = Math.max(1, Math.floor(data.length / 30));
  const sampled = data.filter((_, i) => i % step === 0 || i === data.length - 1);

  return (
    <div className="h-52 w-full min-w-0 overflow-hidden">
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={sampled} margin={{ top: 4, right: 8, left: -24, bottom: 0 }}>
          <defs>
            <linearGradient id="equityGrad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor="hsl(191 100% 50%)" stopOpacity={0.25} />
              <stop offset="95%" stopColor="hsl(191 100% 50%)" stopOpacity={0} />
            </linearGradient>
            <linearGradient id="ddGrad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor="hsl(10 90% 55%)" stopOpacity={0.3} />
              <stop offset="95%" stopColor="hsl(10 90% 55%)" stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="3 3" stroke="hsl(220 12% 20%)" />
          <XAxis dataKey="date" tick={{ fontSize: 9, fill: 'hsl(215 12% 50%)' }} axisLine={false} tickLine={false} interval="preserveStartEnd" />
          <YAxis yAxisId="left" tick={{ fontSize: 9, fill: 'hsl(215 12% 50%)' }} axisLine={false} tickLine={false} />
          <YAxis yAxisId="right" orientation="right" tick={{ fontSize: 9, fill: 'hsl(10 90% 55%)' }} axisLine={false} tickLine={false} />
          <Tooltip
            contentStyle={{ background: 'hsl(220 15% 11%)', border: '1px solid hsl(220 12% 20%)', borderRadius: 2, fontSize: 11 }}
            labelStyle={{ color: 'hsl(210 20% 92%)' }}
          />
          <Legend layout="horizontal" wrapperStyle={{ paddingTop: 8, fontSize: 11 }} />
          <Area yAxisId="left" type="monotone" dataKey="equity" name="Equity ($)" stroke="hsl(191 100% 50%)" strokeWidth={1.5} fill="url(#equityGrad)" dot={false} />
          <Area yAxisId="right" type="monotone" dataKey="drawdown" name="Drawdown (%)" stroke="hsl(10 90% 55%)" strokeWidth={1} fill="url(#ddGrad)" dot={false} />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}

function TradeDistributionChart({ trades }: { trades: BacktestTrade[] }) {
  if (trades.length === 0) return null;

  // Bucket P&L into bins
  const pnls = trades.map(t => t.pnl_pct);
  const min = Math.floor(Math.min(...pnls));
  const max = Math.ceil(Math.max(...pnls));
  const bucketSize = Math.max(1, Math.round((max - min) / 12));
  const buckets: Record<string, number> = {};
  for (let v = min; v <= max; v += bucketSize) {
    buckets[`${v > 0 ? '+' : ''}${v}%`] = 0;
  }
  pnls.forEach(p => {
    const key = Math.floor(p / bucketSize) * bucketSize;
    const label = `${key > 0 ? '+' : ''}${key}%`;
    buckets[label] = (buckets[label] ?? 0) + 1;
  });
  const barData = Object.entries(buckets).map(([range, count]) => ({
    range, count,
    fill: range.startsWith('+') ? 'hsl(145 80% 42%)' : 'hsl(10 90% 55%)',
  }));

  return (
    <div className="h-36 w-full min-w-0 overflow-hidden">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={barData} margin={{ top: 4, right: 8, left: -24, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="hsl(220 12% 20%)" />
          <XAxis dataKey="range" tick={{ fontSize: 9, fill: 'hsl(215 12% 50%)' }} axisLine={false} tickLine={false} />
          <YAxis tick={{ fontSize: 9, fill: 'hsl(215 12% 50%)' }} axisLine={false} tickLine={false} />
          <Tooltip
            contentStyle={{ background: 'hsl(220 15% 11%)', border: '1px solid hsl(220 12% 20%)', borderRadius: 2, fontSize: 11 }}
          />
          <Bar dataKey="count" name="# Trades" radius={[1, 1, 0, 0]}>
            {barData.map((entry, i) => (
              <rect key={i} fill={entry.fill} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

function SavedBacktestRow({
  result, onSelect, onDelete, isSelected,
}: { result: BacktestResult; onSelect: () => void; onDelete: () => void; isSelected: boolean }) {
  return (
    <div
      onClick={onSelect}
      className={cn(
        'cursor-pointer rounded border p-3 transition-colors duration-150',
        isSelected ? 'border-primary/50 bg-primary/5' : 'border-border bg-card hover:bg-muted/20'
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium text-foreground text-balance">{result.name}</p>
          <p className="text-xs text-muted-foreground data-mono">
            {result.symbol} · {result.timeframe} · {result.start_date} → {result.end_date}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          <span className={cn('text-sm font-bold data-mono',
            result.total_return_pct >= 0 ? 'text-success' : 'text-destructive'
          )}>
            {result.total_return_pct >= 0 ? '+' : ''}{result.total_return_pct.toFixed(1)}%
          </span>
          <Button
            variant="ghost"
            size="sm"
            onClick={e => { e.stopPropagation(); onDelete(); }}
            className="h-6 w-6 p-0 text-muted-foreground hover:text-destructive"
          >
            <Trash2 className="h-3 w-3" />
          </Button>
        </div>
      </div>
      <div className="mt-1.5 flex items-center gap-2 text-[10px] text-muted-foreground">
        <span>{result.total_trades} trades</span>
        <span>·</span>
        <span>WR: {result.win_rate.toFixed(0)}%</span>
        <span>·</span>
        <span>DD: {result.max_drawdown_pct.toFixed(1)}%</span>
      </div>
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function BacktestPage() {
  const [strategies, setStrategies] = useState<Strategy[]>([]);
  const [savedResults, setSavedResults] = useState<BacktestResult[]>([]);
  const [selectedResult, setSelectedResult] = useState<BacktestResult | null>(null);
  const [loadingStrategies, setLoadingStrategies] = useState(true);
  const [loadingSaved, setLoadingSaved] = useState(true);
  const [running, setRunning] = useState(false);
  const [saving, setSaving] = useState(false);
  const [liveResult, setLiveResult] = useState<BacktestResult | null>(null);
  const [liveCandles, setLiveCandles] = useState(0);
  const [saveDialogOpen, setSaveDialogOpen] = useState(false);
  const [saveName, setSaveName] = useState('');
  const [showTrades, setShowTrades] = useState(false);

  // Config form
  const [config, setConfig] = useState({
    strategyId: '',
    symbol: 'BTCUSDT',
    startDate: '2025-01-01',
    endDate: '2025-06-30',
    timeframe: '1h',
    stopLossPct: 2,
    takeProfitPct: 4,
    positionSizePct: 10,
  });

  const setField = (key: keyof typeof config, val: string | number) =>
    setConfig(prev => ({ ...prev, [key]: val }));

  const loadSaved = useCallback(async () => {
    const { data } = await supabase
      .from('backtest_results')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(50);
    setSavedResults(Array.isArray(data) ? data : []);
  }, []);

  useEffect(() => {
    Promise.all([
      getStrategies().then(s => setStrategies(s)),
      loadSaved(),
    ]).finally(() => {
      setLoadingStrategies(false);
      setLoadingSaved(false);
    });
  }, [loadSaved]);

  const handleRunBacktest = async () => {
    if (!config.startDate || !config.endDate) return toast.error('Select start and end date');
    if (new Date(config.endDate) <= new Date(config.startDate)) return toast.error('End date must be after start date');

    setRunning(true);
    setLiveResult(null);
    setLiveCandles(0);
    setSelectedResult(null);
    toast.info(`Fetching Binance data for ${config.symbol}...`, { icon: '📡' });

    const { data, error } = await supabase.functions.invoke('run-backtest', {
      body: {
        strategyId: config.strategyId || null,
        symbol: config.symbol,
        startDate: config.startDate,
        endDate: config.endDate,
        timeframe: config.timeframe,
        stopLossPct: config.stopLossPct,
        takeProfitPct: config.takeProfitPct,
        positionSizePct: config.positionSizePct,
      },
      method: 'POST',
    });

    if (error || !data?.metrics) {
      const msg = error ? await error.context?.text?.() : 'Backtest failed';
      toast.error(msg || 'Backtest failed');
    } else {
      setLiveCandles(data.totalCandles ?? 0);
      const strategy = strategies.find(s => s.id === config.strategyId);
      const result: BacktestResult = {
        id: crypto.randomUUID(),
        user_id: '',
        strategy_id: config.strategyId || null,
        name: `${config.symbol} ${config.timeframe} Backtest`,
        symbol: config.symbol,
        timeframe: config.timeframe,
        start_date: config.startDate,
        end_date: config.endDate,
        ...data.metrics,
        equity_curve: data.equity_curve,
        trade_list: data.trade_list,
        ohlcv_sample: data.ohlcv_sample ?? [],
        created_at: new Date().toISOString(),
      };
      setLiveResult(result);
      setSaveName(`${strategy?.name ?? 'Strategy'} · ${config.symbol} ${config.timeframe}`);
      toast.success(
        `Backtest complete! ${data.totalCandles?.toLocaleString() ?? '—'} live candles · ${data.metrics.total_trades} trades simulated.`,
        { icon: '🎯' }
      );
    }
    setRunning(false);
  };

  const handleSave = async () => {
    if (!liveResult) return;
    if (!saveName.trim()) return toast.error('Enter a name for this backtest');
    setSaving(true);

    const { error } = await supabase.from('backtest_results').insert({
      strategy_id: liveResult.strategy_id,
      name: saveName,
      symbol: liveResult.symbol,
      timeframe: liveResult.timeframe,
      start_date: liveResult.start_date,
      end_date: liveResult.end_date,
      total_trades: liveResult.total_trades,
      win_trades: liveResult.win_trades,
      loss_trades: liveResult.loss_trades,
      win_rate: liveResult.win_rate,
      total_return_pct: liveResult.total_return_pct,
      total_pnl: liveResult.total_pnl,
      max_drawdown_pct: liveResult.max_drawdown_pct,
      sharpe_ratio: liveResult.sharpe_ratio,
      avg_trade_duration_hours: liveResult.avg_trade_duration_hours,
      equity_curve: liveResult.equity_curve,
      trade_list: liveResult.trade_list,
    });

    if (error) {
      toast.error('Failed to save: ' + error.message);
    } else {
      toast.success('Backtest saved!');
      setSaveDialogOpen(false);
      await loadSaved();
    }
    setSaving(false);
  };

  const handleDeleteSaved = async (id: string) => {
    const { error } = await supabase.from('backtest_results').delete().eq('id', id);
    if (!error) {
      if (selectedResult?.id === id) setSelectedResult(null);
      await loadSaved();
      toast.success('Deleted');
    }
  };

  const displayResult = selectedResult ?? liveResult;
  const metrics = displayResult as BacktestResult | null;

  return (
    <AppLayout>
      <div className="p-4 md:p-6 space-y-4">
        {/* Header */}
        <div className="flex items-center justify-between gap-4">
          <div>
            <h1 className="text-lg font-bold text-foreground text-balance">Strategy Backtesting</h1>
            <p className="text-sm text-muted-foreground">Real Binance historical klines · RSI+EMA strategy simulation</p>
          </div>
        </div>

        <div className="grid gap-4 lg:grid-cols-4">
          {/* ── Left: Config + Saved ── */}
          <div className="space-y-4 lg:col-span-1">
            {/* Config Card */}
            <Card className="border-border bg-card">
              <CardHeader className="pb-2 pt-4 px-4">
                <CardTitle className="flex items-center gap-2 text-sm font-semibold text-balance">
                  <FlaskConical className="h-4 w-4 text-primary" />
                  Configuration
                </CardTitle>
              </CardHeader>
              <CardContent className="px-4 pb-4 space-y-3">
                {/* Strategy */}
                <div className="space-y-1">
                  <Label className="text-xs text-muted-foreground">Strategy</Label>
                  {loadingStrategies ? (
                    <Skeleton className="h-9 w-full bg-muted" />
                  ) : (
                    <Select value={config.strategyId} onValueChange={v => setField('strategyId', v)}>
                      <SelectTrigger className="h-9 w-full border-border bg-input text-sm">
                        <SelectValue placeholder="Select strategy (optional)" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="none">None (RSI default)</SelectItem>
                        {strategies.map(s => (
                          <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  )}
                </div>

                {/* Symbol */}
                <div className="space-y-1">
                  <Label className="text-xs text-muted-foreground">Symbol</Label>
                  <Select value={config.symbol} onValueChange={v => setField('symbol', v)}>
                    <SelectTrigger className="h-9 w-full border-border bg-input text-sm">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {COMMON_SYMBOLS.map(s => (
                        <SelectItem key={s} value={s}>{s}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                {/* Timeframe */}
                <div className="space-y-1">
                  <Label className="text-xs text-muted-foreground">Timeframe</Label>
                  <Select value={config.timeframe} onValueChange={v => setField('timeframe', v)}>
                    <SelectTrigger className="h-9 w-full border-border bg-input text-sm">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {TIMEFRAMES.map(tf => (
                        <SelectItem key={tf} value={tf}>{tf}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                {/* Date range */}
                <div className="space-y-1">
                  <Label className="text-xs text-muted-foreground">Start Date</Label>
                  <Input
                    type="date"
                    value={config.startDate}
                    onChange={e => setField('startDate', e.target.value)}
                    className="h-9 border-border bg-input text-sm"
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs text-muted-foreground">End Date</Label>
                  <Input
                    type="date"
                    value={config.endDate}
                    onChange={e => setField('endDate', e.target.value)}
                    className="h-9 border-border bg-input text-sm"
                  />
                </div>

                {/* Risk params */}
                <div className="grid grid-cols-3 gap-2">
                  {[
                    { label: 'SL %', key: 'stopLossPct' as const },
                    { label: 'TP %', key: 'takeProfitPct' as const },
                    { label: 'Size %', key: 'positionSizePct' as const },
                  ].map(({ label, key }) => (
                    <div key={key} className="space-y-1">
                      <Label className="text-[10px] text-muted-foreground">{label}</Label>
                      <Input
                        type="number"
                        min={0.1} step={0.1}
                        value={config[key]}
                        onChange={e => setField(key, parseFloat(e.target.value))}
                        className="h-8 border-border bg-input px-2 text-sm data-mono"
                      />
                    </div>
                  ))}
                </div>

                <Button
                  className="h-9 w-full gap-2"
                  onClick={handleRunBacktest}
                  disabled={running}
                >
                  {running
                    ? <><Loader2 className="h-3.5 w-3.5 animate-spin" />Running...</>
                    : <><Play className="h-3.5 w-3.5" />Run Backtest</>
                  }
                </Button>
              </CardContent>
            </Card>

            {/* Saved Backtests */}
            <Card className="border-border bg-card">
              <CardHeader className="pb-2 pt-4 px-4">
                <CardTitle className="flex items-center justify-between gap-2 text-sm font-semibold text-balance">
                  <span>Saved Backtests</span>
                  <Badge variant="outline" className="text-[10px]">{savedResults.length}</Badge>
                </CardTitle>
              </CardHeader>
              <CardContent className="px-4 pb-4">
                {loadingSaved ? (
                  <div className="space-y-2">
                    {[...Array(2)].map((_, i) => <Skeleton key={i} className="h-16 w-full bg-muted" />)}
                  </div>
                ) : savedResults.length === 0 ? (
                  <div className="py-6 text-center">
                    <BarChart3 className="mx-auto h-8 w-8 text-muted-foreground/30" />
                    <p className="mt-2 text-xs text-muted-foreground">No saved backtests</p>
                  </div>
                ) : (
                  <div className="max-h-72 space-y-2 overflow-y-auto">
                    {savedResults.map(r => (
                      <SavedBacktestRow
                        key={r.id}
                        result={r}
                        isSelected={selectedResult?.id === r.id}
                        onSelect={() => { setSelectedResult(r); setLiveResult(null); }}
                        onDelete={() => handleDeleteSaved(r.id)}
                      />
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </div>

          {/* ── Right: Results ── */}
          <div className="space-y-4 lg:col-span-3">
            {running && (
              <Card className="border-primary/30 bg-primary/5">
                <CardContent className="py-10 text-center">
                  <Loader2 className="mx-auto h-10 w-10 animate-spin text-primary" />
                  <p className="mt-3 text-sm font-medium text-primary">
                    Fetching live Binance data &amp; running simulation...
                  </p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {config.symbol} · {config.timeframe} · {config.startDate} → {config.endDate}
                  </p>
                  <p className="mt-0.5 text-[11px] text-muted-foreground">
                    Paginating Binance klines API — larger date ranges take longer
                  </p>
                  <div className="mx-auto mt-4 h-0.5 max-w-48 overflow-hidden rounded-full bg-primary/20">
                    <div className="h-full animate-[progress_1.5s_ease-in-out_infinite] rounded-full bg-primary" />
                  </div>
                </CardContent>
              </Card>
            )}

            {!running && !metrics && (
              <Card className="border-border bg-card">
                <CardContent className="flex flex-col items-center justify-center gap-3 py-20 text-center">
                  <FlaskConical className="h-14 w-14 text-muted-foreground/20" />
                  <p className="text-base font-medium text-foreground">Ready to Backtest</p>
                  <p className="max-w-xs text-sm text-muted-foreground text-pretty">
                    Configure your strategy, symbol, and date range, then click <strong>Run Backtest</strong> to simulate trades.
                  </p>
                </CardContent>
              </Card>
            )}

            {!running && metrics && (
              <>
                {/* Result Header */}
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="truncate text-base font-bold text-foreground text-balance">{metrics.name}</p>
                      {liveResult && liveCandles > 0 && (
                        <Badge className="shrink-0 gap-1 bg-primary/10 text-primary border-primary/30 text-[10px]">
                          <DatabaseZap className="h-2.5 w-2.5" />
                          {liveCandles.toLocaleString()} live candles
                        </Badge>
                      )}
                    </div>
                    <p className="text-xs text-muted-foreground data-mono">
                      {metrics.symbol} · {metrics.timeframe} · {metrics.start_date} → {metrics.end_date}
                      {selectedResult && <span className="ml-2 text-muted-foreground/60">(saved)</span>}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    {liveResult && (
                      <Dialog open={saveDialogOpen} onOpenChange={setSaveDialogOpen}>
                        <DialogTrigger asChild>
                          <Button variant="outline" size="sm" className="h-9 gap-2 border-border">
                            <Save className="h-3.5 w-3.5" />
                            Save
                          </Button>
                        </DialogTrigger>
                        <DialogContent className="max-w-[calc(100%-2rem)] md:max-w-md border-border bg-card">
                          <DialogHeader>
                            <DialogTitle className="text-balance">Save Backtest Result</DialogTitle>
                          </DialogHeader>
                          <div className="space-y-3">
                            <div className="space-y-1.5">
                              <Label className="text-sm font-normal">Name</Label>
                              <Input
                                value={saveName}
                                onChange={e => setSaveName(e.target.value)}
                                placeholder="e.g. RSI Strategy BTC 1h"
                                className="bg-input border-border"
                              />
                            </div>
                            <div className="flex justify-end gap-2">
                              <Button variant="outline" onClick={() => setSaveDialogOpen(false)} className="border-border">Cancel</Button>
                              <Button onClick={handleSave} disabled={saving} className="gap-2">
                                {saving && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                                Save
                              </Button>
                            </div>
                          </div>
                        </DialogContent>
                      </Dialog>
                    )}
                  </div>
                </div>

                {/* Metrics Grid */}
                <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
                  <MetricCard
                    label="Total Return"
                    value={`${metrics.total_return_pct >= 0 ? '+' : ''}${metrics.total_return_pct.toFixed(2)}%`}
                    sub={`$${metrics.total_pnl >= 0 ? '+' : ''}${metrics.total_pnl.toFixed(2)} P&L`}
                    positive={metrics.total_return_pct >= 0}
                    icon={metrics.total_return_pct >= 0 ? ArrowUpRight : ArrowDownRight}
                  />
                  <MetricCard
                    label="Win Rate"
                    value={`${metrics.win_rate.toFixed(1)}%`}
                    sub={`${metrics.win_trades}W / ${metrics.loss_trades}L`}
                    positive={metrics.win_rate >= 50}
                    icon={TrendingUp}
                  />
                  <MetricCard
                    label="Max Drawdown"
                    value={`-${metrics.max_drawdown_pct.toFixed(2)}%`}
                    positive={false}
                    icon={TrendingDown}
                  />
                  <MetricCard
                    label="Sharpe Ratio"
                    value={metrics.sharpe_ratio.toFixed(2)}
                    sub="Annualized"
                    positive={metrics.sharpe_ratio >= 1}
                    icon={BarChart3}
                  />
                  <MetricCard
                    label="Total Trades"
                    value={`${metrics.total_trades}`}
                    sub={`${metrics.win_trades} wins · ${metrics.loss_trades} losses`}
                  />
                  <MetricCard
                    label="Avg Duration"
                    value={`${metrics.avg_trade_duration_hours.toFixed(1)}h`}
                    sub="Per trade"
                  />
                  <MetricCard
                    label="Initial Equity"
                    value={`$${metrics.initial_equity?.toLocaleString() ?? '10,000'}`}
                  />
                  <MetricCard
                    label="Final Equity"
                    value={`$${metrics.final_equity?.toFixed(2) ?? '—'}`}
                    positive={(metrics.final_equity ?? 0) >= (metrics.initial_equity ?? 10000)}
                  />
                </div>

                {/* Candlestick Chart with Trade Markers */}
                {metrics.ohlcv_sample && metrics.ohlcv_sample.length > 0 && (
                  <Card className="border-border bg-card">
                    <CardHeader className="pb-2 pt-4 px-4">
                      <CardTitle className="flex items-center justify-between gap-2 text-sm font-semibold text-balance">
                        <span>Price History &amp; Trade Markers</span>
                        <div className="flex shrink-0 items-center gap-3 text-[10px] text-muted-foreground">
                          <span className="flex items-center gap-1">
                            <span className="inline-block h-2 w-2 rounded-sm bg-success" />
                            Buy entry / profitable exit
                          </span>
                          <span className="flex items-center gap-1">
                            <span className="inline-block h-2 w-2 rounded-sm bg-destructive" />
                            Sell entry / loss exit
                          </span>
                        </div>
                      </CardTitle>
                    </CardHeader>
                    <CardContent className="px-3 pb-4">
                      <CandlestickChart
                        candles={metrics.ohlcv_sample}
                        trades={metrics.trade_list}
                        symbol={metrics.symbol}
                      />
                    </CardContent>
                  </Card>
                )}

                {/* Equity Curve */}
                <Card className="border-border bg-card">
                  <CardHeader className="pb-2 pt-4 px-4">
                    <CardTitle className="text-sm font-semibold text-balance">Equity Curve & Drawdown</CardTitle>
                  </CardHeader>
                  <CardContent className="px-2 pb-4">
                    <EquityCurveChart data={metrics.equity_curve ?? []} />
                  </CardContent>
                </Card>

                {/* Trade Distribution */}
                {metrics.trade_list && metrics.trade_list.length > 0 && (
                  <Card className="border-border bg-card">
                    <CardHeader className="pb-2 pt-4 px-4">
                      <CardTitle className="text-sm font-semibold text-balance">P&L Distribution</CardTitle>
                    </CardHeader>
                    <CardContent className="px-2 pb-4">
                      <TradeDistributionChart trades={metrics.trade_list} />
                    </CardContent>
                  </Card>
                )}

                {/* Trade List */}
                {metrics.trade_list && metrics.trade_list.length > 0 && (
                  <Card className="border-border bg-card">
                    <CardHeader className="pb-0 pt-4 px-4">
                      <button
                        type="button"
                        onClick={() => setShowTrades(v => !v)}
                        className="flex w-full items-center justify-between gap-2"
                      >
                        <CardTitle className="text-sm font-semibold text-balance">
                          Simulated Trades ({metrics.trade_list.length})
                        </CardTitle>
                        {showTrades
                          ? <ChevronUp className="h-4 w-4 text-muted-foreground" />
                          : <ChevronDown className="h-4 w-4 text-muted-foreground" />
                        }
                      </button>
                    </CardHeader>
                    {showTrades && (
                      <CardContent className="px-0 pb-2 pt-3">
                        <div className="w-full overflow-x-auto">
                          <table className="w-full min-w-max">
                            <thead>
                              <tr className="border-b border-border bg-muted/20">
                                {['#', 'Dir', 'Entry Time', 'Entry Price', 'Exit Price', 'P&L', 'P&L %', 'Duration', 'Exit'].map(h => (
                                  <th key={h} className="whitespace-nowrap px-3 py-2 text-left text-[11px] font-medium text-muted-foreground">{h}</th>
                                ))}
                              </tr>
                            </thead>
                            <tbody>
                              {metrics.trade_list.slice(0, 100).map((trade, i) => (
                                <tr key={i} className="border-b border-border/40 hover:bg-muted/10">
                                  <td className="whitespace-nowrap px-3 py-2 text-xs text-muted-foreground">{i + 1}</td>
                                  <td className="whitespace-nowrap px-3 py-2">
                                    <Badge variant="outline" className={cn('text-[10px]', trade.direction === 'buy' ? 'signal-buy' : 'signal-sell')}>
                                      {trade.direction.toUpperCase()}
                                    </Badge>
                                  </td>
                                  <td className="whitespace-nowrap px-3 py-2 text-xs text-muted-foreground">
                                    {new Date(trade.entry_time).toLocaleDateString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                                  </td>
                                  <td className="whitespace-nowrap px-3 py-2 text-sm text-foreground data-mono">${trade.entry_price.toFixed(4)}</td>
                                  <td className="whitespace-nowrap px-3 py-2 text-sm text-foreground data-mono">${trade.exit_price.toFixed(4)}</td>
                                  <td className="whitespace-nowrap px-3 py-2">
                                    <span className={cn('text-sm font-semibold data-mono', trade.pnl >= 0 ? 'text-success' : 'text-destructive')}>
                                      {trade.pnl >= 0 ? '+' : ''}{trade.pnl.toFixed(2)}
                                    </span>
                                  </td>
                                  <td className="whitespace-nowrap px-3 py-2">
                                    <span className={cn('text-sm data-mono', trade.pnl_pct >= 0 ? 'text-success' : 'text-destructive')}>
                                      {trade.pnl_pct >= 0 ? '+' : ''}{trade.pnl_pct.toFixed(2)}%
                                    </span>
                                  </td>
                                  <td className="whitespace-nowrap px-3 py-2 text-xs text-muted-foreground data-mono">{trade.duration_hours.toFixed(1)}h</td>
                                  <td className="whitespace-nowrap px-3 py-2">
                                    <Badge variant="outline" className={cn('text-[10px]',
                                      trade.exit_reason === 'tp' ? 'border-success/40 text-success' :
                                        trade.exit_reason === 'sl' ? 'border-destructive/40 text-destructive' :
                                          'border-border text-muted-foreground'
                                    )}>
                                      {trade.exit_reason.toUpperCase()}
                                    </Badge>
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                          {metrics.trade_list.length > 100 && (
                            <p className="px-3 py-2 text-xs text-muted-foreground">Showing first 100 of {metrics.trade_list.length} trades</p>
                          )}
                        </div>
                      </CardContent>
                    )}
                  </Card>
                )}
              </>
            )}
          </div>
        </div>
      </div>
    </AppLayout>
  );
}
