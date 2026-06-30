import { useEffect, useRef } from 'react';
import {
  createChart,
  ColorType,
  CrosshairMode,
  CandlestickSeries,
  type SeriesMarker,
  type Time,
} from 'lightweight-charts';
import type { BacktestTrade } from '@/types/types';

export interface OHLCVBar {
  time: number; // Unix seconds (lightweight-charts format)
  open: number;
  high: number;
  low: number;
  close: number;
  volume?: number;
}

interface CandlestickChartProps {
  candles: OHLCVBar[];
  trades?: BacktestTrade[];
  symbol?: string;
}

export function CandlestickChart({ candles, trades = [], symbol }: CandlestickChartProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const chartRef = useRef<any | null>(null);

  useEffect(() => {
    if (!containerRef.current || candles.length === 0) return;

    const el = containerRef.current;

    // Create chart with dark fintech theme matching app design system
    const chart = createChart(el, {
      layout: {
        background: { type: ColorType.Solid, color: '#0d1117' },
        textColor: '#7a8499',
        fontSize: 11,
      },
      grid: {
        vertLines: { color: '#1e2330' },
        horzLines: { color: '#1e2330' },
      },
      crosshair: {
        mode: CrosshairMode.Normal,
        vertLine: { color: '#00d4ff', labelBackgroundColor: '#161b27' },
        horzLine: { color: '#00d4ff', labelBackgroundColor: '#161b27' },
      },
      rightPriceScale: { borderColor: '#272d3d' },
      timeScale: {
        borderColor: '#272d3d',
        timeVisible: true,
        secondsVisible: false,
      },
      width: el.clientWidth,
      height: 320,
      handleScroll: true,
      handleScale: true,
    });
    chartRef.current = chart;

    // Add candlestick series using v5 API
    const candleSeries = chart.addSeries(CandlestickSeries, {
      upColor: '#22c55e',
      downColor: '#ef4444',
      borderUpColor: '#22c55e',
      borderDownColor: '#ef4444',
      wickUpColor: '#4ade80',
      wickDownColor: '#f87171',
    });

    // Sort and deduplicate candles by time
    const sorted = [...candles]
      .sort((a, b) => a.time - b.time)
      .filter((c, i, arr) => i === 0 || c.time !== arr[i - 1].time);

    candleSeries.setData(sorted.map(c => ({
      time: c.time as Time,
      open: c.open,
      high: c.high,
      low: c.low,
      close: c.close,
    })));

    // Build trade markers using v5 createSeriesMarkers plugin
    if (trades.length > 0) {
      const timeArray = sorted.map(c => c.time);

      function snapToNearest(targetSec: number): number {
        let best = timeArray[0];
        let bestDiff = Math.abs(targetSec - best);
        for (const t of timeArray) {
          const diff = Math.abs(targetSec - t);
          if (diff < bestDiff) { best = t; bestDiff = diff; }
        }
        return best;
      }

      const markers: SeriesMarker<Time>[] = [];

      for (const trade of trades) {
        const entrySec = Math.floor(new Date(trade.entry_time).getTime() / 1000);
        const snappedEntry = snapToNearest(entrySec);
        markers.push({
          time: snappedEntry as Time,
          position: trade.direction === 'buy' ? 'belowBar' : 'aboveBar',
          color: trade.direction === 'buy' ? '#22c55e' : '#ef4444',
          shape: trade.direction === 'buy' ? 'arrowUp' : 'arrowDown',
          text: `${trade.direction === 'buy' ? 'B' : 'S'} @${trade.entry_price.toFixed(2)}`,
          size: 1,
        });

        const exitSec = Math.floor(new Date(trade.exit_time).getTime() / 1000);
        const snappedExit = snapToNearest(exitSec);
        const profitable = trade.pnl >= 0;
        markers.push({
          time: snappedExit as Time,
          position: trade.direction === 'buy' ? 'aboveBar' : 'belowBar',
          color: profitable ? '#4ade80' : '#f87171',
          shape: 'circle',
          text: `${profitable ? '+' : ''}${trade.pnl.toFixed(0)}`,
          size: 0.8,
        });
      }

      // v4 API: setMarkers directly on series (sorted by time required)
      markers.sort((a, b) => (a.time as number) - (b.time as number));
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (candleSeries as any).setMarkers(markers);
    }

    chart.timeScale().fitContent();

    // Responsive resize
    const ro = new ResizeObserver(entries => {
      for (const entry of entries) {
        chart.applyOptions({ width: entry.contentRect.width });
      }
    });
    ro.observe(el);

    return () => {
      ro.disconnect();
      chart.remove();
      chartRef.current = null;
    };
  }, [candles, trades]);

  if (candles.length === 0) {
    return (
      <div className="flex h-48 items-center justify-center rounded border border-border bg-muted/10">
        <p className="text-xs text-muted-foreground">No candle data available for chart</p>
      </div>
    );
  }

  return (
    <div className="relative w-full min-w-0 overflow-hidden rounded border border-border bg-[hsl(220,15%,8%)]">
      <div ref={containerRef} className="w-full" />
      {symbol && (
        <div className="absolute left-2 top-2 rounded bg-black/40 px-1.5 py-0.5 text-[10px] font-semibold tracking-wider text-muted-foreground">
          {symbol}
        </div>
      )}
    </div>
  );
}

