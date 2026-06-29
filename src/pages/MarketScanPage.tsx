import React, { useEffect, useState, useCallback, useRef } from 'react';
import { AppLayout } from '@/components/layouts/AppLayout';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { Switch } from '@/components/ui/switch';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel,
  AlertDialogContent, AlertDialogDescription, AlertDialogFooter,
  AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { TrendingUp, TrendingDown, RefreshCw, ScanLine, Zap, Radio, Pause, Play, CheckCircle2, Bot } from 'lucide-react';
import { cn } from '@/lib/utils';
import { supabase } from '@/db/supabase';
import type { MarketScan } from '@/types/types';
import { toast } from 'sonner';

const AUTO_REFRESH_SECS = 30;

function formatPrice(price: number): string {
  if (price >= 1000) return price.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  if (price >= 1) return price.toFixed(4);
  if (price >= 0.0001) return price.toFixed(6);
  return price.toExponential(4);
}

function formatVolume(v: number) {
  if (v >= 1e9) return `$${(v / 1e9).toFixed(2)}B`;
  if (v >= 1e6) return `$${(v / 1e6).toFixed(1)}M`;
  return `$${(v / 1e3).toFixed(0)}K`;
}

function TredzoScoreBar({ score, mandatoryOk }: { score: number; mandatoryOk: boolean }) {
  const color = score >= 80 && mandatoryOk
    ? 'bg-success'
    : score >= 60
    ? 'bg-warning'
    : 'bg-muted-foreground/30';

  return (
    <div className="flex items-center gap-1.5">
      <div className="h-1.5 w-16 overflow-hidden rounded-full bg-muted">
        <div className={cn('h-full rounded-full transition-all duration-500', color)} style={{ width: `${Math.min(score, 100)}%` }} />
      </div>
      <span className={cn('w-8 text-right text-[10px] font-mono font-semibold',
        score >= 80 && mandatoryOk ? 'text-success' : score >= 60 ? 'text-warning' : 'text-muted-foreground'
      )}>{score}</span>
    </div>
  );
}

type ExtendedScan = MarketScan & {
  tredzo_score?: number;
  tredzo_reason?: string;
  mandatory_ok?: boolean;
};

function ScanRow({ scan, onSignal }: { scan: ExtendedScan; onSignal: (scan: ExtendedScan) => void }) {
  const isGainer  = scan.scan_type === 'gainer';
  const isBuy     = scan.signal_direction === 'buy';
  const isSell    = scan.signal_direction === 'sell';
  const score     = scan.tredzo_score ?? 0;
  const mandatory = scan.mandatory_ok ?? false;
  const hasSignal = (isBuy || isSell) && mandatory;

  return (
    <tr className={cn(
      'border-b border-border/40 transition-colors hover:bg-muted/20',
      hasSignal && isBuy  && 'bg-success/5',
      hasSignal && isSell && 'bg-destructive/5',
    )}>
      {/* Symbol */}
      <td className="whitespace-nowrap px-3 py-2.5">
        <div className="flex items-center gap-2">
          <div className={cn('h-6 w-6 shrink-0 flex items-center justify-center rounded text-[10px]',
            isGainer ? 'bg-success/10 text-success' : 'bg-destructive/10 text-destructive'
          )}>
            {isGainer ? <TrendingUp className="h-3 w-3" /> : <TrendingDown className="h-3 w-3" />}
          </div>
          <span className="text-sm font-medium text-foreground font-mono">{scan.symbol.replace('USDT', '')}</span>
          <span className="text-[10px] text-muted-foreground">USDT</span>
        </div>
      </td>

      {/* Price */}
      <td className="whitespace-nowrap px-3 py-2.5 text-right text-sm text-foreground font-mono">
        ${formatPrice(Number(scan.price))}
      </td>

      {/* 24h Change */}
      <td className="whitespace-nowrap px-3 py-2.5 text-right">
        <span className={cn('text-sm font-semibold font-mono',
          scan.change_pct_24h >= 0 ? 'text-success' : 'text-destructive'
        )}>
          {scan.change_pct_24h >= 0 ? '+' : ''}{scan.change_pct_24h.toFixed(2)}%
        </span>
      </td>

      {/* Volume */}
      <td className="whitespace-nowrap px-3 py-2.5 text-right text-xs text-muted-foreground font-mono">
        {formatVolume(scan.volume_24h)}
      </td>

      {/* Tredzo Score */}
      <td className="whitespace-nowrap px-3 py-2.5">
        <TredzoScoreBar score={score} mandatoryOk={mandatory} />
      </td>

      {/* Mandatory Filters */}
      <td className="whitespace-nowrap px-3 py-2.5">
        {mandatory ? (
          <div className="flex items-center gap-1 text-[10px] text-success">
            <CheckCircle2 className="h-3 w-3" />
            <span>Zone + Sweep + Reject</span>
          </div>
        ) : (
          <span className="text-[10px] text-muted-foreground/60 italic truncate max-w-[120px] inline-block">
            {scan.tredzo_reason ?? 'No setup'}
          </span>
        )}
      </td>

      {/* Signal */}
      <td className="whitespace-nowrap px-3 py-2.5">
        {hasSignal ? (
          <Badge
            variant="outline"
            className={cn('text-[10px] cursor-pointer gap-1', isBuy ? 'signal-buy' : 'signal-sell')}
            onClick={() => onSignal(scan)}
          >
            <Zap className="h-2.5 w-2.5" />
            {isBuy ? '🟢 TREDZO BUY' : '🔴 TREDZO SELL'}
          </Badge>
        ) : (
          <span className="text-[10px] text-muted-foreground/40">—</span>
        )}
      </td>
    </tr>
  );
}

export default function MarketScanPage() {
  const [timeframe, setTimeframe] = useState(() => localStorage.getItem('marketScan_timeframe') || '1h');
  const [gainers, setGainers] = useState<ExtendedScan[]>([]);
  const [losers, setLosers]   = useState<ExtendedScan[]>([]);
  const [loading, setLoading] = useState(true);
  const [scanning, setScanning] = useState(false);
  const [activeTab, setActiveTab] = useState<'gainers' | 'losers'>('gainers');
  const [isLive, setIsLive]     = useState(false);
  const [lastScanned, setLastScanned] = useState<string | null>(null);
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [autoTrade, setAutoTrade]     = useState(() => localStorage.getItem('marketScan_autoTrade') === 'true');
  const [tradeAmountUsdt, setTradeAmountUsdt] = useState(() => Number(localStorage.getItem('marketScan_tradeAmount')) || 10);
  const [showAutoTradeConfirm, setShowAutoTradeConfirm] = useState(false);
  const [countdown, setCountdown] = useState(AUTO_REFRESH_SECS);

  // Sync preferences to localStorage
  useEffect(() => {
    localStorage.setItem('marketScan_timeframe', timeframe);
    localStorage.setItem('marketScan_autoTrade', String(autoTrade));
    localStorage.setItem('marketScan_tradeAmount', String(tradeAmountUsdt));
  }, [timeframe, autoTrade, tradeAmountUsdt]);
  const countdownRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const timeframeRef = useRef(timeframe);
  useEffect(() => { timeframeRef.current = timeframe; }, [timeframe]);

  const resetCountdown = useCallback(() => {
    setCountdown(AUTO_REFRESH_SECS);
    if (countdownRef.current) clearInterval(countdownRef.current);
    countdownRef.current = setInterval(() => {
      setCountdown(prev => prev <= 1 ? AUTO_REFRESH_SECS : prev - 1);
    }, 1000);
  }, []);

  useEffect(() => () => { if (countdownRef.current) clearInterval(countdownRef.current); }, []);

  const runScan = useCallback(async (tf: string, silent = false) => {
    setScanning(true);
    if (!silent) toast.info('🤖 Tredzo SMC Engine scanning Binance markets...', { icon: '⚡' });

    const { data, error } = await supabase.functions.invoke('market-scanner', {
      body: { timeframe: tf, auto_trade: autoTrade, trade_amount_usdt: tradeAmountUsdt },
      method: 'POST',
    });

    if (error || data?.error) {
      const msg = data?.error || error?.message || 'Scan failed';
      if (!silent) toast.error(`Scan failed: ${msg}`);
    } else {
      if (data?.gainers) setGainers(data.gainers as ExtendedScan[]);
      if (data?.losers)  setLosers(data.losers as ExtendedScan[]);
      setIsLive(data?.source?.includes('binance_live') ?? false);
      setLastScanned(new Date().toLocaleTimeString());
      const sigCount = data?.totalSignals ?? 0;
      const tradeCount = data?.tradesPlaced ?? 0;
      if (!silent) {
        if (tradeCount > 0) {
          toast.success(`🤖 ${tradeCount} Auto-Trade${tradeCount > 1 ? 's' : ''} placed!`, { duration: 6000 });
        } else if (sigCount > 0 && !autoTrade) {
          toast.success(`🎯 ${sigCount} Tredzo signal${sigCount > 1 ? 's' : ''} detected!`, { duration: 5000 });
        } else if (sigCount > 0 && autoTrade) {
          toast.warning(`⚠️ ${sigCount} Signal detected, but no trades placed.`, { duration: 5000 });
        } else {
          toast.info('No Tredzo signals yet — market not ready', { duration: 3000 });
        }

        // Always show individual trade result messages (success or failure)
        if (autoTrade && data.tradeResults) {
          (data.tradeResults as Array<{symbol: string; success: boolean; msg: string}>).forEach(r => {
            if (r.success) {
              toast.success(`✅ ${r.msg}`, { duration: 5000 });
            } else {
              toast.error(`❌ Auto-Trade Failed (${r.symbol}): ${r.msg}`, { duration: 7000 });
            }
          });
        }
      }
    }
    setScanning(false);
    setLoading(false);
  }, [autoTrade]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    setLoading(true);
    runScan(timeframe, true).then(() => { if (autoRefresh) resetCountdown(); });
  }, [runScan, timeframe]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!autoRefresh) {
      if (countdownRef.current) clearInterval(countdownRef.current);
      setCountdown(AUTO_REFRESH_SECS);
      return;
    }
    resetCountdown();
    const interval = setInterval(() => {
      runScan(timeframeRef.current, true).then(() => resetCountdown());
    }, AUTO_REFRESH_SECS * 1000);
    return () => clearInterval(interval);
  }, [autoRefresh, resetCountdown, runScan]);

  const handleScan = () => {
    runScan(timeframe, false).then(() => { if (autoRefresh) resetCountdown(); });
  };

  const handleSignal = (scan: ExtendedScan) => {
    toast.success(
      `Tredzo Signal: ${scan.signal_direction?.toUpperCase()} ${scan.symbol} @ $${formatPrice(scan.price)}\nScore: ${scan.tredzo_score}/100 · ${scan.tredzo_reason}`,
      { icon: scan.signal_direction === 'buy' ? '🟢' : '🔴', duration: 7000 }
    );
  };

  const displayData = activeTab === 'gainers' ? gainers : losers;

  // Count real Tredzo signals
  const tredzoSignals = [...gainers, ...losers].filter(s => s.signal_direction && s.mandatory_ok);
  const buySignals    = tredzoSignals.filter(s => s.signal_direction === 'buy');
  const sellSignals   = tredzoSignals.filter(s => s.signal_direction === 'sell');

  return (
    <AppLayout>
      <div className="p-4 md:p-6 space-y-4">

        {/* Header */}
        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-lg font-bold text-foreground text-balance">Market Scanner</h1>
              {isLive && (
                <Badge variant="outline" className="gap-1 border-success/40 text-success text-[10px]">
                  <Radio className="h-2.5 w-2.5" /> LIVE
                </Badge>
              )}
              <Badge variant="outline" className="gap-1 border-primary/40 text-primary text-[10px]">
                <Zap className="h-2.5 w-2.5" /> Tredzo SMC Engine
              </Badge>
            </div>
            <p className="text-sm text-muted-foreground">
              30s auto-scan · Top Gainers & Losers · SMC Reversal Signals
              {lastScanned && <span className="ml-2 text-muted-foreground/60">· Updated {lastScanned}</span>}
            </p>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            {/* Auto-refresh toggle */}
            <button
              onClick={() => setAutoRefresh(v => !v)}
              className={cn(
                'flex items-center gap-1.5 rounded border px-2.5 h-9 text-xs font-medium transition-colors shrink-0',
                autoRefresh
                  ? 'border-success/40 bg-success/10 text-success hover:bg-success/20'
                  : 'border-border bg-muted/30 text-muted-foreground hover:text-foreground'
              )}
            >
              {autoRefresh ? <Pause className="h-3 w-3" /> : <Play className="h-3 w-3" />}
              {autoRefresh ? <span className="font-mono">{countdown}s</span> : <span>Auto</span>}
            </button>

            {/* Auto-Trade toggle */}
            <div
              className={cn(
                'flex items-center gap-2 rounded border px-2.5 h-9 text-xs font-medium transition-colors cursor-pointer shrink-0',
                autoTrade
                  ? 'border-primary/50 bg-primary/10 text-primary'
                  : 'border-border bg-muted/30 text-muted-foreground hover:text-foreground hover:border-primary/30'
              )}
              onClick={() => autoTrade ? setAutoTrade(false) : setShowAutoTradeConfirm(true)}
            >
              <Bot className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">Auto-Trade</span>
              <Switch
                checked={autoTrade}
                onCheckedChange={() => autoTrade ? setAutoTrade(false) : setShowAutoTradeConfirm(true)}
                className="scale-75"
              />
            </div>

            <Select value={timeframe} onValueChange={setTimeframe}>
              <SelectTrigger className="h-9 w-24 border-border bg-input text-sm">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {['1m', '5m', '15m', '1h', '4h', '1d'].map(tf => (
                  <SelectItem key={tf} value={tf}>{tf}</SelectItem>
                ))}
              </SelectContent>
            </Select>

            <Button size="sm" onClick={handleScan} disabled={scanning} className="h-9 gap-2">
              {scanning ? (
                <><RefreshCw className="h-3.5 w-3.5 animate-spin" />Scanning...</>
              ) : (
                <><ScanLine className="h-3.5 w-3.5" />Scan Now</>
              )}
            </Button>
          </div>
        </div>

        {/* Scan Progress */}
        {scanning && (
          <div className="overflow-hidden rounded border border-primary/30 bg-primary/5">
            <div className="h-0.5 bg-primary" style={{ animation: 'progress 1.5s ease-in-out infinite' }} />
            <div className="flex items-center gap-2 px-4 py-2">
              <Zap className="h-3.5 w-3.5 text-primary scan-pulse" />
              <span className="text-xs text-primary">
                Tredzo SMC Engine — Fetching klines, scoring ADX · Zones · Sweeps · Rejection Candles...
              </span>
            </div>
          </div>
        )}

        {/* Summary Cards */}
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          {[
            { label: 'Top Gainers', value: gainers.length, color: 'text-success', bg: 'bg-success/10' },
            { label: 'Tredzo SELL', value: sellSignals.length, color: 'text-destructive', bg: 'bg-destructive/10' },
            { label: 'Top Losers',  value: losers.length, color: 'text-destructive', bg: 'bg-destructive/10' },
            { label: 'Tredzo BUY',  value: buySignals.length, color: 'text-success', bg: 'bg-success/10' },
          ].map(s => (
            <Card key={s.label} className="border-border bg-card h-full">
              <CardContent className="p-4">
                <p className="text-xs text-muted-foreground">{s.label}</p>
                <p className={cn('mt-1 text-2xl font-bold font-mono', s.color)}>
                  {loading ? <Skeleton className="h-8 w-10 bg-muted inline-block" /> : s.value}
                </p>
              </CardContent>
            </Card>
          ))}
        </div>

        {/* Active Signals Banner */}
        {tredzoSignals.length > 0 && !loading && (
          <div className="rounded border border-primary/40 bg-primary/5 px-4 py-3">
            <div className="flex items-center gap-2 mb-2">
              <Zap className="h-4 w-4 text-primary" />
              <span className="text-sm font-semibold text-primary">
                {tredzoSignals.length} Active Tredzo Signal{tredzoSignals.length > 1 ? 's' : ''} Detected!
              </span>
            </div>
            <div className="flex flex-wrap gap-2">
              {tredzoSignals.map(s => (
                <div
                  key={s.id}
                  className={cn(
                    'flex items-center gap-1.5 rounded px-2 py-1 text-xs cursor-pointer transition-colors',
                    s.signal_direction === 'buy'
                      ? 'bg-success/15 text-success border border-success/30 hover:bg-success/25'
                      : 'bg-destructive/15 text-destructive border border-destructive/30 hover:bg-destructive/25'
                  )}
                  onClick={() => handleSignal(s)}
                >
                  <span className="font-mono font-semibold">{s.symbol.replace('USDT', '')}</span>
                  <span className="font-mono">{s.signal_direction?.toUpperCase()}</span>
                  <span className="opacity-70">·</span>
                  <span>{s.tredzo_score}/100</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Tab Switch */}
        <div className="flex gap-1 rounded border border-border bg-muted/30 p-0.5 w-fit">
          {(['gainers', 'losers'] as const).map(tab => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={cn(
                'flex items-center gap-1.5 rounded px-4 py-1.5 text-sm font-medium capitalize transition-colors duration-150',
                activeTab === tab
                  ? tab === 'gainers' ? 'bg-destructive text-white' : 'bg-success text-white'
                  : 'text-muted-foreground hover:text-foreground'
              )}
            >
              {tab === 'gainers' ? <TrendingUp className="h-3.5 w-3.5" /> : <TrendingDown className="h-3.5 w-3.5" />}
              {tab === 'gainers' ? 'Top Gainers (SELL)' : 'Top Losers (BUY)'}
            </button>
          ))}
        </div>

        {/* Table */}
        <Card className="border-border bg-card">
          <CardHeader className="pb-2 pt-4 px-4">
            <CardTitle className="text-sm font-semibold text-balance flex items-center gap-2">
              {activeTab === 'gainers'
                ? '🔴 Top Gainers — Tredzo SELL Reversal Scan'
                : '🟢 Top Losers — Tredzo BUY Reversal Scan'}
              <span className="text-[10px] font-normal text-muted-foreground">
                (Score ≥ 80 + Zone + Sweep + Rejection required)
              </span>
            </CardTitle>
          </CardHeader>
          <CardContent className="px-0 pb-2">
            <div className="w-full overflow-x-auto">
              <table className="w-full min-w-max">
                <thead>
                  <tr className="border-b border-border bg-muted/20">
                    {['Symbol', 'Price', '24h Change', 'Volume', 'Tredzo Score', 'SMC Filter Status', 'Signal'].map(h => (
                      <th key={h} className="whitespace-nowrap px-3 py-2 text-left text-[11px] font-medium text-muted-foreground">
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {loading ? (
                    [...Array(10)].map((_, i) => (
                      <tr key={i} className="border-b border-border/40">
                        {[...Array(7)].map((_, j) => (
                          <td key={j} className="px-3 py-2.5">
                            <Skeleton className="h-4 w-full bg-muted" />
                          </td>
                        ))}
                      </tr>
                    ))
                  ) : displayData.length === 0 ? (
                    <tr>
                      <td colSpan={7} className="px-3 py-10 text-center text-sm text-muted-foreground">
                        No data — click <strong>Scan Now</strong> to run Tredzo SMC analysis
                      </td>
                    </tr>
                  ) : (
                    displayData.map(scan => (
                      <ScanRow key={scan.id} scan={scan} onSignal={handleSignal} />
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Auto-Trade Confirmation Dialog */}
      <AlertDialog open={showAutoTradeConfirm} onOpenChange={setShowAutoTradeConfirm}>
        <AlertDialogContent className="border-border bg-card max-w-md">
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2 text-warning">
              <Bot className="h-5 w-5" />
              Enable Auto-Trade?
            </AlertDialogTitle>
            <AlertDialogDescription className="space-y-2 text-left">
              <p className="text-sm text-foreground font-medium">
                Tredzo SMC Engine will automatically place real trades on your Binance account every 30 seconds when a valid signal is detected.
              </p>
              <ul className="text-xs text-muted-foreground space-y-1 mt-2 list-disc list-inside">
                <li>Requires Binance API keys in Settings</li>
                <li>Only trades when Score ≥ 80 + Zone + Sweep + Rejection</li>
                <li>Dynamic SL at Zone ± 0.5 ATR, TP1 at 1R, TP2 at 2R</li>
                <li>Won't duplicate — 1 open trade per coin at a time</li>
              </ul>
              
              <div className="pt-4 pb-2">
                <Label className="text-sm font-semibold text-foreground mb-2 block">Trade Amount (USDT)</Label>
                <div className="flex items-center gap-2">
                  <Input 
                    type="number" 
                    value={tradeAmountUsdt} 
                    onChange={(e) => setTradeAmountUsdt(Number(e.target.value))}
                    className="w-32 bg-input border-border font-mono text-lg"
                    min="1"
                    step="1"
                  />
                  <span className="text-sm text-muted-foreground">USDT per trade</span>
                </div>
              </div>

              <p className="text-xs text-warning mt-2 font-medium">
                ⚠️ Real money will be used. Bot will use {tradeAmountUsdt} USDT per signal.
              </p>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="border-border">Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-primary text-primary-foreground gap-2"
              onClick={() => { setAutoTrade(true); setShowAutoTradeConfirm(false); toast.success('🤖 Auto-Trade enabled! Bot will trade on next signal.', { duration: 5000 }); }}
            >
              <Bot className="h-4 w-4" />
              Enable Auto-Trade
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </AppLayout>
  );
}
