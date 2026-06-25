import React, { useEffect, useState, useCallback, useRef } from 'react';
import { AppLayout } from '@/components/layouts/AppLayout';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { TrendingUp, TrendingDown, RefreshCw, ScanLine, Zap, Radio, Pause, Play } from 'lucide-react';
import { cn } from '@/lib/utils';
import { supabase } from '@/db/supabase';
import type { MarketScan } from '@/types/types';
import { toast } from 'sonner';

const AUTO_REFRESH_SECS = 30;

/** Format price with smart decimals: large prices fewer decimals, small prices more */
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

function ConfidenceBar({ value, direction }: { value: number; direction: 'buy' | 'sell' }) {
  return (
    <div className="flex items-center gap-1.5">
      <div className="h-1.5 w-16 overflow-hidden rounded-full bg-muted">
        <div
          className={cn('h-full rounded-full transition-all', direction === 'buy' ? 'bg-success' : 'bg-destructive')}
          style={{ width: `${value}%` }}
        />
      </div>
      <span className="w-8 text-right text-[10px] text-muted-foreground data-mono">{value}%</span>
    </div>
  );
}

function ScanRow({ scan, onSignal }: { scan: MarketScan; onSignal: (scan: MarketScan) => void }) {
  const isGainer = scan.scan_type === 'gainer';
  const isBuy = scan.signal_direction === 'buy';
  return (
    <tr className="border-b border-border/40 transition-colors hover:bg-muted/20">
      <td className="whitespace-nowrap px-3 py-2.5">
        <div className="flex items-center gap-2">
          <div className={cn('h-6 w-6 shrink-0 flex items-center justify-center rounded text-[10px]',
            isGainer ? 'bg-success/10 text-success' : 'bg-destructive/10 text-destructive'
          )}>
            {isGainer ? <TrendingUp className="h-3 w-3" /> : <TrendingDown className="h-3 w-3" />}
          </div>
          <span className="text-sm font-medium text-foreground data-mono">{scan.symbol}</span>
        </div>
      </td>
      <td className="whitespace-nowrap px-3 py-2.5 text-right text-sm text-foreground data-mono">
        ${formatPrice(Number(scan.price))}
      </td>
      <td className="whitespace-nowrap px-3 py-2.5 text-right">
        <span className={cn('text-sm font-semibold data-mono',
          scan.change_pct_24h >= 0 ? 'text-success' : 'text-destructive'
        )}>
          {scan.change_pct_24h >= 0 ? '+' : ''}{scan.change_pct_24h.toFixed(2)}%
        </span>
      </td>
      <td className="whitespace-nowrap px-3 py-2.5 text-right text-xs text-muted-foreground data-mono">
        {formatVolume(scan.volume_24h)}
      </td>
      <td className="whitespace-nowrap px-3 py-2.5 text-right">
        <Badge variant="outline" className="text-[10px]">{scan.timeframe}</Badge>
      </td>
      <td className="whitespace-nowrap px-3 py-2.5">
        {scan.confidence !== null && scan.signal_direction && (
          <ConfidenceBar value={scan.confidence} direction={scan.signal_direction} />
        )}
      </td>
      <td className="whitespace-nowrap px-3 py-2.5">
        {scan.signal_direction && (
          <Badge
            variant="outline"
            className={cn('text-[10px] cursor-pointer', isBuy ? 'signal-buy' : 'signal-sell')}
            onClick={() => onSignal(scan)}
          >
            {isBuy ? '🟢 STRONG BUY' : '🔴 STRONG SELL'}
          </Badge>
        )}
      </td>
    </tr>
  );
}

export default function MarketScanPage() {
  const [timeframe, setTimeframe] = useState('1h');
  const [gainers, setGainers] = useState<MarketScan[]>([]);
  const [losers, setLosers] = useState<MarketScan[]>([]);
  const [loading, setLoading] = useState(true);
  const [scanning, setScanning] = useState(false);
  const [activeTab, setActiveTab] = useState<'gainers' | 'losers'>('gainers');
  const [isLive, setIsLive] = useState(false);
  const [lastScanned, setLastScanned] = useState<string | null>(null);
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [countdown, setCountdown] = useState(AUTO_REFRESH_SECS);
  const countdownRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const timeframeRef = useRef(timeframe);
  useEffect(() => { timeframeRef.current = timeframe; }, [timeframe]);

  /** Reset countdown to 30 and restart the 1-second ticker */
  const resetCountdown = useCallback(() => {
    setCountdown(AUTO_REFRESH_SECS);
    if (countdownRef.current) clearInterval(countdownRef.current);
    countdownRef.current = setInterval(() => {
      setCountdown(prev => {
        if (prev <= 1) return AUTO_REFRESH_SECS; // will be reset by auto-scan effect
        return prev - 1;
      });
    }, 1000);
  }, []);

  useEffect(() => () => { if (countdownRef.current) clearInterval(countdownRef.current); }, []);

  const runScan = useCallback(async (tf: string, silent = false) => {
    setScanning(true);
    if (!silent) toast.info('Scanning Binance live market data...', { icon: '🤖' });

    const { data, error } = await supabase.functions.invoke('market-scanner', {
      body: { timeframe: tf },
      method: 'POST',
    });

    if (error || data?.error) {
      const msg = data?.error || error?.message || 'Scan failed';
      if (!silent) toast.error(`Scan failed: ${msg}`);
    } else {
      if (data?.gainers) setGainers(data.gainers);
      if (data?.losers) setLosers(data.losers);
      setIsLive(data?.source === 'binance_live');
      setLastScanned(new Date().toLocaleTimeString());
      if (!silent) toast.success(`Found ${data?.totalSignals ?? 0} trade signals from Binance`, { icon: '🎯' });
    }
    setScanning(false);
    setLoading(false);
  }, []);

  // Initial scan + rescan when timeframe changes
  useEffect(() => {
    setLoading(true);
    runScan(timeframe, true).then(() => { if (autoRefresh) resetCountdown(); });
  }, [runScan, timeframe]); // eslint-disable-line react-hooks/exhaustive-deps

  // 30-second auto-refresh loop
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

  const handleSignal = (scan: MarketScan) => {
    toast.success(
      `Signal: ${scan.signal_direction?.toUpperCase()} ${scan.symbol} @ $${formatPrice(scan.price)} (Confidence: ${scan.confidence}%)`,
      { icon: scan.signal_direction === 'buy' ? '🟢' : '🔴', duration: 5000 }
    );
  };

  const displayData = activeTab === 'gainers' ? gainers : losers;

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
                  <Radio className="h-2.5 w-2.5" />
                  LIVE
                </Badge>
              )}
            </div>
            <p className="text-sm text-muted-foreground">
              AI-powered real-time gainers &amp; losers analysis
              {lastScanned && <span className="ml-2 text-muted-foreground/60">· Updated {lastScanned}</span>}
            </p>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {/* Auto-refresh toggle + countdown */}
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
              {autoRefresh ? (
                <span className="data-mono">{countdown}s</span>
              ) : (
                <span>Auto</span>
              )}
            </button>
            <Select value={timeframe} onValueChange={setTimeframe}>
              <SelectTrigger className="h-9 w-24 border-border bg-input text-sm">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {['1m', '5m', '15m', '1h', '4h', '1d'].map((tf) => (
                  <SelectItem key={tf} value={tf}>{tf}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button size="sm" onClick={handleScan} disabled={scanning} className="h-9 gap-2">
              {scanning ? (
                <><RefreshCw className="h-3.5 w-3.5 animate-spin" />Scanning...</>
              ) : (
                <><ScanLine className="h-3.5 w-3.5" />Scan Market</>
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
              <span className="text-xs text-primary">Fetching live {timeframe} market data from Binance...</span>
            </div>
          </div>
        )}

        {/* Summary Cards */}
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          {[
            { label: 'Top Gainers', value: gainers.length, color: 'text-success', bg: 'bg-success/10' },
            { label: 'Strong Sell', value: gainers.filter(g => (g.confidence ?? 0) >= 70).length, color: 'text-destructive', bg: 'bg-destructive/10' },
            { label: 'Top Losers', value: losers.length, color: 'text-destructive', bg: 'bg-destructive/10' },
            { label: 'Strong Buy', value: losers.filter(l => (l.confidence ?? 0) >= 70).length, color: 'text-success', bg: 'bg-success/10' },
          ].map((s) => (
            <Card key={s.label} className="border-border bg-card h-full">
              <CardContent className="p-4">
                <p className="text-xs text-muted-foreground">{s.label}</p>
                <p className={cn('mt-1 text-2xl font-bold data-mono', s.color)}>
                  {loading ? <Skeleton className="h-8 w-10 bg-muted inline-block" /> : s.value}
                </p>
              </CardContent>
            </Card>
          ))}
        </div>

        {/* Tab Switch */}
        <div className="flex gap-1 rounded border border-border bg-muted/30 p-0.5 w-fit">
          {(['gainers', 'losers'] as const).map((tab) => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={cn(
                'flex items-center gap-1.5 rounded px-4 py-1.5 text-sm font-medium capitalize transition-colors duration-150',
                activeTab === tab
                  ? tab === 'gainers' ? 'bg-success text-white' : 'bg-destructive text-white'
                  : 'text-muted-foreground hover:text-foreground'
              )}
            >
              {tab === 'gainers' ? <TrendingUp className="h-3.5 w-3.5" /> : <TrendingDown className="h-3.5 w-3.5" />}
              {tab === 'gainers' ? 'Top Gainers' : 'Top Losers'}
            </button>
          ))}
        </div>

        {/* Table */}
        <Card className="border-border bg-card">
          <CardHeader className="pb-2 pt-4 px-4">
            <CardTitle className="text-sm font-semibold text-balance">
              {activeTab === 'gainers' ? '🔴 Top Gainers → Strong Sell Opportunities' : '🟢 Top Losers → Strong Buy Opportunities'}
            </CardTitle>
          </CardHeader>
          <CardContent className="px-0 pb-2">
            <div className="w-full overflow-x-auto">
              <table className="w-full min-w-max">
                <thead>
                  <tr className="border-b border-border bg-muted/20">
                    {['Symbol', 'Price', '24h Change', 'Volume', 'Timeframe', 'Confidence', 'Signal'].map((h) => (
                      <th key={h} className="whitespace-nowrap px-3 py-2 text-left text-[11px] font-medium text-muted-foreground">
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {loading ? (
                    [...Array(8)].map((_, i) => (
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
                        No data — click <strong>Scan Market</strong> to fetch live Binance data
                      </td>
                    </tr>
                  ) : (
                    displayData.map((scan) => (
                      <ScanRow key={scan.id} scan={scan} onSignal={handleSignal} />
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      </div>
    </AppLayout>
  );
}
