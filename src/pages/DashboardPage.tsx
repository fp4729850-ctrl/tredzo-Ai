import React, { useEffect, useState, useCallback } from 'react';
import { AppLayout } from '@/components/layouts/AppLayout';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import {
  TrendingUp, TrendingDown, Activity, DollarSign, BarChart3,
  RefreshCw, ArrowUpRight, ArrowDownRight, Target, Zap
} from 'lucide-react';
import {
  AreaChart, Area, ResponsiveContainer, XAxis, YAxis, Tooltip, CartesianGrid
} from 'recharts';
import { getPerformanceSummary, getOpenTrades, getPendingSignals } from '@/services/api';
import type { Trade, Signal } from '@/types/types';
import { cn } from '@/lib/utils';

const mockChartData = Array.from({ length: 14 }, (_, i) => {
  const base = 10000;
  const variation = Math.sin(i * 0.6) * 800 + Math.random() * 400;
  return {
    day: `Jun ${i + 12}`,
    pnl: Math.round(base + variation + i * 120),
  };
});

function StatCard({
  title, value, sub, icon: Icon, trend, color = 'default', loading,
}: {
  title: string; value: string; sub?: string; icon: React.ElementType;
  trend?: 'up' | 'down'; color?: 'green' | 'red' | 'cyan' | 'default'; loading?: boolean;
}) {
  const iconColors = {
    green: 'text-success bg-success/10',
    red: 'text-destructive bg-destructive/10',
    cyan: 'text-primary bg-primary/10',
    default: 'text-muted-foreground bg-muted',
  };
  return (
    <Card className="h-full border-border bg-card">
      <CardContent className="p-4">
        {loading ? (
          <div className="space-y-2">
            <Skeleton className="h-4 w-24 bg-muted" />
            <Skeleton className="h-7 w-32 bg-muted" />
            <Skeleton className="h-3 w-20 bg-muted" />
          </div>
        ) : (
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <p className="text-xs text-muted-foreground">{title}</p>
              <p className="mt-1 truncate text-2xl font-bold data-mono text-foreground">{value}</p>
              {sub && (
                <p className={cn('mt-0.5 flex items-center gap-1 text-xs',
                  trend === 'up' ? 'text-success' : trend === 'down' ? 'text-destructive' : 'text-muted-foreground'
                )}>
                  {trend === 'up' && <ArrowUpRight className="h-3 w-3" />}
                  {trend === 'down' && <ArrowDownRight className="h-3 w-3" />}
                  {sub}
                </p>
              )}
            </div>
            <div className={cn('flex h-10 w-10 shrink-0 items-center justify-center rounded', iconColors[color])}>
              <Icon className="h-5 w-5" />
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function SignalRow({ signal }: { signal: Signal }) {
  return (
    <div className="flex items-center gap-3 border-b border-border/50 py-2.5 last:border-0">
      <div className={cn('flex h-7 w-7 shrink-0 items-center justify-center rounded text-xs font-bold',
        signal.direction === 'buy' ? 'signal-buy border' : 'signal-sell border'
      )}>
        {signal.direction === 'buy' ? <TrendingUp className="h-3.5 w-3.5" /> : <TrendingDown className="h-3.5 w-3.5" />}
      </div>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium text-foreground">{signal.symbol}</p>
        <p className="text-xs text-muted-foreground">{signal.timeframe} · {signal.reason?.slice(0, 40) ?? 'AI Signal'}</p>
      </div>
      <div className="shrink-0 text-right">
        <p className="text-xs font-medium data-mono text-foreground">${Number(signal.entry_price).toFixed(4)}</p>
        <div className="flex items-center justify-end gap-1">
          <div
            className="h-1 w-12 rounded-full bg-muted overflow-hidden"
            title={`Confidence: ${signal.confidence}%`}
          >
            <div
              className={cn('h-full rounded-full', signal.confidence >= 70 ? 'bg-success' : signal.confidence >= 50 ? 'bg-warning' : 'bg-destructive')}
              style={{ width: `${signal.confidence}%` }}
            />
          </div>
          <span className="text-[10px] text-muted-foreground">{signal.confidence}%</span>
        </div>
      </div>
    </div>
  );
}

function TradeRow({ trade }: { trade: Trade }) {
  const pnl = trade.pnl ?? 0;
  const pnlPct = trade.pnl_pct ?? 0;
  const currentPrice = trade.entry_price * (1 + (Math.random() * 0.04 - 0.01));
  const unrealizedPnl = (currentPrice - trade.entry_price) * trade.quantity * (trade.direction === 'buy' ? 1 : -1);

  return (
    <div className="flex items-center gap-3 border-b border-border/50 py-2.5 last:border-0">
      <Badge
        variant="outline"
        className={cn('shrink-0 text-[10px]', trade.direction === 'buy' ? 'signal-buy' : 'signal-sell')}
      >
        {trade.direction.toUpperCase()}
      </Badge>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium text-foreground">{trade.symbol}</p>
        <p className="text-xs text-muted-foreground">
          Entry: <span className="data-mono">${Number(trade.entry_price).toFixed(4)}</span>
          {' · '}{Number(trade.quantity).toFixed(4)} qty
        </p>
      </div>
      <div className="shrink-0 text-right">
        {trade.status === 'open' ? (
          <>
            <p className={cn('text-sm font-semibold data-mono', unrealizedPnl >= 0 ? 'text-success' : 'text-destructive')}>
              {unrealizedPnl >= 0 ? '+' : ''}{unrealizedPnl.toFixed(2)}
            </p>
            <Badge variant="outline" className="text-[10px] border-primary/40 text-primary">OPEN</Badge>
          </>
        ) : (
          <>
            <p className={cn('text-sm font-semibold data-mono', pnl >= 0 ? 'text-success' : 'text-destructive')}>
              {pnl >= 0 ? '+' : ''}{pnl.toFixed(2)}
            </p>
            <p className={cn('text-[10px] data-mono', pnlPct >= 0 ? 'text-success' : 'text-destructive')}>
              {pnlPct >= 0 ? '+' : ''}{pnlPct.toFixed(2)}%
            </p>
          </>
        )}
      </div>
    </div>
  );
}

export default function DashboardPage() {
  const [loading, setLoading] = useState(true);
  const [summary, setSummary] = useState({ totalTrades: 0, winRate: 0, totalPnl: 0, totalPnlPct: 0, openTrades: 0 });
  const [openTrades, setOpenTrades] = useState<Trade[]>([]);
  const [signals, setSignals] = useState<Signal[]>([]);
  const [webhookToken, setWebhookToken] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const loadData = useCallback(async () => {
    const [s, trades, sigs, userSettings] = await Promise.all([
      getPerformanceSummary(),
      getOpenTrades(),
      getPendingSignals(),
      import('@/services/api').then(m => m.getUserSettings()),
    ]);
    setSummary(s);
    setOpenTrades(trades);
    setSignals(sigs);
    if (userSettings) {
      setWebhookToken(userSettings.webhook_token);
    }
  }, []);

  useEffect(() => {
    loadData().finally(() => setLoading(false));
  }, [loadData]);

  const handleRefresh = async () => {
    setRefreshing(true);
    await loadData();
    setRefreshing(false);
  };

  return (
    <AppLayout>
      <div className="p-4 md:p-6 space-y-5">
        {/* Header */}
        <div className="flex items-center justify-between gap-4">
          <div>
            <h1 className="text-lg font-bold text-foreground text-balance">Dashboard</h1>
            <p className="text-sm text-muted-foreground">Live market overview & trading activity</p>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={handleRefresh}
            disabled={refreshing}
            className="shrink-0 gap-2 border-border"
          >
            <RefreshCw className={cn('h-3.5 w-3.5', refreshing && 'animate-spin')} />
            <span className="sr-only md:not-sr-only">Refresh</span>
          </Button>
        </div>

        {/* Stat Cards */}
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <StatCard title="Total P&L" value={`$${summary.totalPnl.toFixed(2)}`}
            sub={`${summary.totalPnlPct >= 0 ? '+' : ''}${summary.totalPnlPct.toFixed(2)}% avg`}
            icon={DollarSign} trend={summary.totalPnl >= 0 ? 'up' : 'down'}
            color={summary.totalPnl >= 0 ? 'green' : 'red'} loading={loading} />
          <StatCard title="Win Rate" value={`${summary.winRate.toFixed(1)}%`}
            sub={`${summary.totalTrades} total trades`}
            icon={Target} color="cyan" loading={loading} />
          <StatCard title="Open Trades" value={`${summary.openTrades}`}
            sub="Active positions" icon={Activity} color="default" loading={loading} />
          <StatCard title="Active Signals" value={`${signals.length}`}
            sub="Pending execution" icon={Zap} color="cyan" loading={loading} />
        </div>

        {/* Charts + Signals + Trades */}
        <div className="grid gap-4 md:grid-cols-3">
          {/* PnL Chart */}
          <Card className="h-full border-border bg-card md:col-span-2">
            <CardHeader className="pb-2 pt-4 px-4">
              <div className="flex items-center justify-between gap-2">
                <CardTitle className="text-sm font-semibold text-balance">Portfolio Value</CardTitle>
                <Badge variant="outline" className="text-[10px] border-success/40 text-success">+12.4%</Badge>
              </div>
            </CardHeader>
            <CardContent className="px-2 pb-4">
              <div className="h-48 w-full min-w-0 overflow-hidden">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={mockChartData} margin={{ top: 4, right: 8, left: -20, bottom: 0 }}>
                    <defs>
                      <linearGradient id="pnlGrad" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="hsl(191 100% 50%)" stopOpacity={0.2} />
                        <stop offset="95%" stopColor="hsl(191 100% 50%)" stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke="hsl(220 12% 20%)" />
                    <XAxis dataKey="day" tick={{ fontSize: 10, fill: 'hsl(215 12% 50%)' }} axisLine={false} tickLine={false} />
                    <YAxis tick={{ fontSize: 10, fill: 'hsl(215 12% 50%)' }} axisLine={false} tickLine={false} />
                    <Tooltip
                      contentStyle={{ background: 'hsl(220 15% 11%)', border: '1px solid hsl(220 12% 20%)', borderRadius: 2, fontSize: 12 }}
                      labelStyle={{ color: 'hsl(210 20% 92%)' }}
                    />
                    <Area
                      type="monotone" dataKey="pnl" stroke="hsl(191 100% 50%)"
                      strokeWidth={1.5} fill="url(#pnlGrad)"
                    />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            </CardContent>
          </Card>

          {/* Stats side */}
          <Card className="h-full border-border bg-card">
            <CardHeader className="pb-2 pt-4 px-4">
              <CardTitle className="text-sm font-semibold text-balance">Performance</CardTitle>
            </CardHeader>
            <CardContent className="px-4 pb-4 space-y-3">
              {[
                { label: 'Win Rate', value: `${summary.winRate.toFixed(1)}%`, color: 'text-success' },
                { label: 'Total Trades', value: `${summary.totalTrades}`, color: 'text-foreground' },
                { label: 'Open Positions', value: `${summary.openTrades}`, color: 'text-primary' },
                { label: 'Pending Signals', value: `${signals.length}`, color: 'text-warning' },
                { label: 'Total P&L', value: `$${summary.totalPnl.toFixed(2)}`, color: summary.totalPnl >= 0 ? 'text-success' : 'text-destructive' },
              ].map((item) => (
                <div key={item.label} className="flex items-center justify-between gap-2">
                  <span className="text-xs text-muted-foreground">{item.label}</span>
                  <span className={cn('text-sm font-semibold data-mono', item.color)}>{item.value}</span>
                </div>
              ))}
            </CardContent>
          </Card>
        </div>

        {/* Signals + Open Positions */}
        <div className="grid gap-4 md:grid-cols-2">
          {/* Active Signals */}
          <Card className="h-full border-border bg-card">
            <CardHeader className="pb-2 pt-4 px-4">
              <div className="flex items-center justify-between gap-2">
                <CardTitle className="text-sm font-semibold text-balance">Active Signals</CardTitle>
                <Badge variant="outline" className="text-[10px] border-primary/40 text-primary">
                  {signals.length} signals
                </Badge>
              </div>
            </CardHeader>
            <CardContent className="px-4 pb-3">
              {loading ? (
                <div className="space-y-3">{[...Array(3)].map((_, i) => <Skeleton key={i} className="h-10 w-full bg-muted" />)}</div>
              ) : signals.length === 0 ? (
                <div className="flex flex-col items-center gap-2 py-8 text-center">
                  <BarChart3 className="h-8 w-8 text-muted-foreground/40" />
                  <p className="text-sm text-muted-foreground">No active signals</p>
                  <p className="text-xs text-muted-foreground/60">Add a strategy to start generating signals</p>
                </div>
              ) : (
                <div className="max-h-64 overflow-y-auto">
                  {signals.slice(0, 8).map((s) => <SignalRow key={s.id} signal={s} />)}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Open Positions */}
          <Card className="h-full border-border bg-card">
            <CardHeader className="pb-2 pt-4 px-4">
              <div className="flex items-center justify-between gap-2">
                <CardTitle className="text-sm font-semibold text-balance">Open Positions</CardTitle>
                <Badge variant="outline" className="text-[10px]">
                  {openTrades.length} open
                </Badge>
              </div>
            </CardHeader>
            <CardContent className="px-4 pb-3">
              {loading ? (
                <div className="space-y-3">{[...Array(3)].map((_, i) => <Skeleton key={i} className="h-10 w-full bg-muted" />)}</div>
              ) : openTrades.length === 0 ? (
                <div className="flex flex-col items-center gap-2 py-8 text-center">
                  <Activity className="h-8 w-8 text-muted-foreground/40" />
                  <p className="text-sm text-muted-foreground">No open positions</p>
                  <p className="text-xs text-muted-foreground/60">Enable bot to start trading</p>
                </div>
              ) : (
                <div className="max-h-64 overflow-y-auto">
                  {openTrades.slice(0, 8).map((t) => <TradeRow key={t.id} trade={t} />)}
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </AppLayout>
  );
}
