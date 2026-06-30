import React, { useEffect, useState, useCallback } from 'react';
import { AppLayout } from '@/components/layouts/AppLayout';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { History, Search, TrendingUp, TrendingDown, Download, RefreshCw } from 'lucide-react';
import { supabase } from '@/db/supabase';
import { getTrades } from '@/services/api';
import type { Trade } from '@/types/types';
import { cn } from '@/lib/utils';

const PAGE_SIZE = 20;

function formatDate(iso: string) {
  return new Date(iso).toLocaleString('en-US', {
    month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
  });
}

export default function TradeHistoryPage() {
  const [trades, setTrades] = useState<Trade[]>([]);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(0);
  const [hasMore, setHasMore] = useState(true);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [directionFilter, setDirectionFilter] = useState('all');
  const [syncing, setSyncing] = useState(false);

  const load = useCallback(async (p = 0) => {
    const data = await getTrades(PAGE_SIZE, p * PAGE_SIZE);
    if (p === 0) {
      setTrades(data);
    } else {
      setTrades(prev => [...prev, ...data]);
    }
    setHasMore(data.length === PAGE_SIZE);
  }, []);

  useEffect(() => {
    load(0).finally(() => setLoading(false));
  }, [load]);

  const handleLoadMore = async () => {
    const nextPage = page + 1;
    setPage(nextPage);
    await load(nextPage);
  };

  const filtered = trades.filter(t => {
    if (search && !t.symbol.toLowerCase().includes(search.toLowerCase())) return false;
    if (statusFilter !== 'all' && t.status !== statusFilter) return false;
    if (directionFilter !== 'all' && t.direction !== directionFilter) return false;
    return true;
  });

  const summary = {
    total: trades.length,
    wins: trades.filter(t => t.status === 'closed' && (t.pnl ?? 0) > 0).length,
    losses: trades.filter(t => t.status === 'closed' && (t.pnl ?? 0) <= 0).length,
    totalPnl: trades.filter(t => t.status === 'closed').reduce((s, t) => s + (t.pnl ?? 0), 0),
    open: trades.filter(t => t.status === 'open').length,
  };

  const handleExport = () => {
    const headers = ['Symbol', 'Direction', 'Entry', 'Exit', 'Qty', 'P&L', 'P&L%', 'Status', 'Opened', 'Closed'];
    const rows = filtered.map(t => [
      t.symbol, t.direction, t.entry_price, t.exit_price ?? '',
      t.quantity, t.pnl ?? '', t.pnl_pct ?? '',
      t.status, formatDate(t.opened_at), t.closed_at ? formatDate(t.closed_at) : '',
    ]);
    const csv = [headers, ...rows].map(r => r.join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `trades_${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleSync = async () => {
    setSyncing(true);
    try {
      const { data, error } = await supabase.functions.invoke('sync-trades', { method: 'POST' });
      if (error || (data && !data.success)) {
        throw new Error(error?.message || data?.error || 'Failed to sync');
      }
      if (data?.synced > 0) {
        toast.success(`Synced ${data.synced} closed trades from Binance!`);
        await load(0); // reload page 0
      } else {
        toast.info('All trades are up to date.');
      }
    } catch (err: any) {
      toast.error(`Sync error: ${err.message}`);
    } finally {
      setSyncing(false);
    }
  };

  return (
    <AppLayout>
      <div className="p-4 md:p-6 space-y-4">
        {/* Header */}
        <div className="flex items-center justify-between gap-4">
          <div>
            <h1 className="text-lg font-bold text-foreground text-balance">Trade History</h1>
            <p className="text-sm text-muted-foreground">Complete record of all executed trades</p>
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={handleSync}
              disabled={syncing}
              className="shrink-0 h-9 gap-2 border-primary/20 text-primary hover:bg-primary/10"
            >
              <RefreshCw className={cn("h-3.5 w-3.5", syncing && "animate-spin")} />
              <span className="sr-only md:not-sr-only">Sync Binance</span>
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={handleExport}
              className="shrink-0 h-9 gap-2 border-border"
              disabled={filtered.length === 0}
            >
              <Download className="h-3.5 w-3.5" />
              <span className="sr-only md:not-sr-only">Export CSV</span>
            </Button>
          </div>
        </div>

        {/* Summary Row */}
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          {[
            { label: 'Total Trades', value: summary.total, color: 'text-foreground' },
            { label: 'Wins', value: summary.wins, color: 'text-success' },
            { label: 'Losses', value: summary.losses, color: 'text-destructive' },
            {
              label: 'Total P&L',
              value: `$${summary.totalPnl.toFixed(2)}`,
              color: summary.totalPnl >= 0 ? 'text-success' : 'text-destructive',
            },
          ].map((s) => (
            <Card key={s.label} className="border-border bg-card">
              <CardContent className="p-4">
                <p className="text-xs text-muted-foreground">{s.label}</p>
                <p className={cn('mt-1 text-2xl font-bold data-mono', s.color)}>{s.value}</p>
              </CardContent>
            </Card>
          ))}
        </div>

        {/* Filters */}
        <div className="flex flex-col gap-2 md:flex-row md:items-center">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder="Search symbol..."
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="h-9 bg-input border-border pl-9"
            />
          </div>
          <div className="flex gap-2 shrink-0">
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="h-9 w-32 border-border bg-input">
                <SelectValue placeholder="Status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Status</SelectItem>
                <SelectItem value="open">Open</SelectItem>
                <SelectItem value="closed">Closed</SelectItem>
                <SelectItem value="cancelled">Cancelled</SelectItem>
              </SelectContent>
            </Select>
            <Select value={directionFilter} onValueChange={setDirectionFilter}>
              <SelectTrigger className="h-9 w-32 border-border bg-input">
                <SelectValue placeholder="Direction" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All</SelectItem>
                <SelectItem value="buy">Buy</SelectItem>
                <SelectItem value="sell">Sell</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        {/* Table */}
        <Card className="border-border bg-card">
          <CardHeader className="pb-2 pt-4 px-4">
            <div className="flex items-center justify-between gap-2">
              <CardTitle className="text-sm font-semibold text-balance">
                <span className="flex items-center gap-2">
                  <History className="h-4 w-4 text-primary" />
                  Trades
                </span>
              </CardTitle>
              <Badge variant="outline" className="text-[10px]">{filtered.length} records</Badge>
            </div>
          </CardHeader>
          <CardContent className="px-0 pb-2">
            <div className="w-full overflow-x-auto">
              <table className="w-full min-w-max">
                <thead>
                  <tr className="border-b border-border bg-muted/20">
                    {['Symbol', 'Dir', 'Entry', 'Exit', 'Qty', 'P&L', 'P&L %', 'Status', 'Opened', 'Closed'].map(h => (
                      <th key={h} className="whitespace-nowrap px-3 py-2 text-left text-[11px] font-medium text-muted-foreground">
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {loading ? (
                    [...Array(5)].map((_, i) => (
                      <tr key={i} className="border-b border-border/40">
                        {[...Array(10)].map((_, j) => (
                          <td key={j} className="px-3 py-2.5">
                            <Skeleton className="h-4 w-full bg-muted" />
                          </td>
                        ))}
                      </tr>
                    ))
                  ) : filtered.length === 0 ? (
                    <tr>
                      <td colSpan={10} className="px-4 py-12 text-center">
                        <div className="flex flex-col items-center gap-2">
                          <History className="h-10 w-10 text-muted-foreground/30" />
                          <p className="text-sm text-muted-foreground">No trades found</p>
                          <p className="text-xs text-muted-foreground/60">
                            {trades.length > 0 ? 'Try adjusting filters' : 'Enable the bot and add a strategy to start trading'}
                          </p>
                        </div>
                      </td>
                    </tr>
                  ) : (
                    filtered.map((trade) => {
                      const pnl = trade.pnl ?? 0;
                      const pnlPct = trade.pnl_pct ?? 0;
                      return (
                        <tr
                          key={trade.id}
                          className="border-b border-border/40 transition-colors hover:bg-muted/10"
                        >
                          <td className="whitespace-nowrap px-3 py-2.5">
                            <span className="text-sm font-medium text-foreground data-mono">{trade.symbol}</span>
                          </td>
                          <td className="whitespace-nowrap px-3 py-2.5">
                            <Badge
                              variant="outline"
                              className={cn('text-[10px]', trade.direction === 'buy' ? 'signal-buy' : 'signal-sell')}
                            >
                              {trade.direction === 'buy'
                                ? <TrendingUp className="mr-1 h-2.5 w-2.5 inline" />
                                : <TrendingDown className="mr-1 h-2.5 w-2.5 inline" />
                              }
                              {trade.direction.toUpperCase()}
                            </Badge>
                          </td>
                          <td className="whitespace-nowrap px-3 py-2.5 text-sm text-foreground data-mono">
                            ${Number(trade.entry_price).toFixed(4)}
                          </td>
                          <td className="whitespace-nowrap px-3 py-2.5 text-sm text-muted-foreground data-mono">
                            {trade.exit_price ? `$${Number(trade.exit_price).toFixed(4)}` : '—'}
                          </td>
                          <td className="whitespace-nowrap px-3 py-2.5 text-sm text-muted-foreground data-mono">
                            {Number(trade.quantity).toFixed(4)}
                          </td>
                          <td className="whitespace-nowrap px-3 py-2.5">
                            {trade.status === 'closed' ? (
                              <span className={cn('text-sm font-semibold data-mono',
                                pnl >= 0 ? 'text-success' : 'text-destructive'
                              )}>
                                {pnl >= 0 ? '+' : ''}{pnl.toFixed(2)}
                              </span>
                            ) : <span className="text-xs text-muted-foreground">—</span>}
                          </td>
                          <td className="whitespace-nowrap px-3 py-2.5">
                            {trade.status === 'closed' ? (
                              <span className={cn('text-sm data-mono',
                                pnlPct >= 0 ? 'text-success' : 'text-destructive'
                              )}>
                                {pnlPct >= 0 ? '+' : ''}{pnlPct.toFixed(2)}%
                              </span>
                            ) : <span className="text-xs text-muted-foreground">—</span>}
                          </td>
                          <td className="whitespace-nowrap px-3 py-2.5">
                            <Badge
                              variant="outline"
                              className={cn('text-[10px]',
                                trade.status === 'open' ? 'border-primary/40 text-primary' :
                                  trade.status === 'closed' ? 'border-border text-muted-foreground' :
                                    'border-warning/40 text-warning'
                              )}
                            >
                              {trade.status.toUpperCase()}
                            </Badge>
                          </td>
                          <td className="whitespace-nowrap px-3 py-2.5 text-xs text-muted-foreground">
                            {formatDate(trade.opened_at)}
                          </td>
                          <td className="whitespace-nowrap px-3 py-2.5 text-xs text-muted-foreground">
                            {trade.closed_at ? formatDate(trade.closed_at) : '—'}
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>

            {/* Load More */}
            {!loading && hasMore && filtered.length > 0 && (
              <div className="flex justify-center p-4">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleLoadMore}
                  className="border-border"
                >
                  Load More
                </Button>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </AppLayout>
  );
}
