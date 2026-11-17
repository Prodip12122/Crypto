import { useEffect, useRef } from 'react';
import { createChart, ColorType, LineStyle, type IChartApi, type UTCTimestamp } from 'lightweight-charts';
import type { Candle } from '../types/trading';

interface PriceOverlay {
  entry?: number;
  stopLoss?: number;
  tp1?: number;
  tp2?: number;
  tp3?: number;
}

interface CandlestickChartProps {
  candles: Candle[];
  symbol: string;
  overlays?: PriceOverlay;
  height?: number;
}

function computeEmaSeries(candles: Candle[], period: number) {
  const out: Array<{ time: UTCTimestamp; value: number }> = [];
  if (candles.length < period) return out;
  const k = 2 / (period + 1);
  let sum = 0;
  for (let i = 0; i < period; i++) sum += candles[i].close;
  let ema = sum / period;
  out.push({
    time: Math.floor(candles[period - 1].openTime / 1000) as UTCTimestamp,
    value: ema,
  });
  for (let i = period; i < candles.length; i++) {
    ema = candles[i].close * k + ema * (1 - k);
    out.push({
      time: Math.floor(candles[i].openTime / 1000) as UTCTimestamp,
      value: ema,
    });
  }
  return out;
}

export function CandlestickChart({
  candles,
  overlays,
  height = 380,
}: CandlestickChartProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<IChartApi | null>(null);

  useEffect(() => {
    const el = containerRef.current;
    if (!el || candles.length === 0) return;

    const chart = createChart(el, {
      layout: {
        background: { type: ColorType.Solid, color: '#0b101b' },
        textColor: '#94a3b8',
        fontFamily: 'JetBrains Mono, monospace',
        fontSize: 11,
      },
      grid: {
        vertLines: { color: 'rgba(148, 163, 184, 0.06)' },
        horzLines: { color: 'rgba(148, 163, 184, 0.06)' },
      },
      width: el.clientWidth,
      height,
      timeScale: {
        timeVisible: true,
        secondsVisible: false,
        borderColor: 'rgba(148, 163, 184, 0.14)',
      },
      rightPriceScale: {
        borderColor: 'rgba(148, 163, 184, 0.14)',
      },
      crosshair: {
        vertLine: { color: 'rgba(34, 211, 238, 0.35)', width: 1 },
        horzLine: { color: 'rgba(34, 211, 238, 0.35)', width: 1 },
      },
    });
    chartRef.current = chart;

    const firstClose = candles[0]?.close ?? 1;
    const precision = firstClose < 0.05 ? 6 : firstClose < 1 ? 4 : firstClose < 50 ? 3 : 2;
    const minMove = Math.pow(10, -precision);

    const candleSeries = chart.addCandlestickSeries({
      upColor: '#10b981',
      downColor: '#f43f5e',
      borderVisible: false,
      wickUpColor: '#10b981',
      wickDownColor: '#f43f5e',
      priceFormat: {
        type: 'price',
        precision,
        minMove,
      },
    });

    const formatted = candles.map((c) => ({
      time: Math.floor(c.openTime / 1000) as UTCTimestamp,
      open: c.open,
      high: c.high,
      low: c.low,
      close: c.close,
    }));
    candleSeries.setData(formatted);

    // EMA 20 and EMA 50 overlays
    const ema20Series = chart.addLineSeries({
      color: '#22d3ee',
      lineWidth: 1,
      priceLineVisible: false,
      lastValueVisible: false,
    });
    ema20Series.setData(computeEmaSeries(candles, 20));

    const ema50Series = chart.addLineSeries({
      color: '#f59e0b',
      lineWidth: 1,
      priceLineVisible: false,
      lastValueVisible: false,
    });
    ema50Series.setData(computeEmaSeries(candles, 50));

    // Signal overlays (Entry, SL, TP1-TP3)
    if (overlays?.entry) {
      candleSeries.createPriceLine({
        price: overlays.entry,
        color: '#38bdf8',
        lineWidth: 2,
        lineStyle: LineStyle.Solid,
        axisLabelVisible: true,
        title: 'ENTRY',
      });
    }
    if (overlays?.stopLoss) {
      candleSeries.createPriceLine({
        price: overlays.stopLoss,
        color: '#f43f5e',
        lineWidth: 2,
        lineStyle: LineStyle.Dashed,
        axisLabelVisible: true,
        title: 'STOP LOSS',
      });
    }
    if (overlays?.tp1) {
      candleSeries.createPriceLine({
        price: overlays.tp1,
        color: '#10b981',
        lineWidth: 1,
        lineStyle: LineStyle.Dotted,
        axisLabelVisible: true,
        title: 'TP1 (1R)',
      });
    }
    if (overlays?.tp2) {
      candleSeries.createPriceLine({
        price: overlays.tp2,
        color: '#10b981',
        lineWidth: 2,
        lineStyle: LineStyle.Dashed,
        axisLabelVisible: true,
        title: 'TP2 (2R)',
      });
    }
    if (overlays?.tp3) {
      candleSeries.createPriceLine({
        price: overlays.tp3,
        color: '#34d399',
        lineWidth: 1,
        lineStyle: LineStyle.Dotted,
        axisLabelVisible: true,
        title: 'TP3 (3R)',
      });
    }

    chart.timeScale().fitContent();

    const ro = new ResizeObserver((entries) => {
      if (entries[0] && chartRef.current) {
        chartRef.current.applyOptions({ width: entries[0].contentRect.width });
      }
    });
    ro.observe(el);

    return () => {
      ro.disconnect();
      chart.remove();
      chartRef.current = null;
    };
  }, [candles, overlays?.entry, overlays?.stopLoss, overlays?.tp1, overlays?.tp2, overlays?.tp3, height]);

  if (candles.length === 0) {
    return (
      <div
        style={{ height }}
        className="flex items-center justify-center rounded-lg border border-slate-800 bg-[#0b101b] text-xs text-slate-400"
      >
        No candlestick data available.
      </div>
    );
  }

  return (
    <div className="relative rounded-lg border border-slate-800/80 bg-[#0b101b] overflow-hidden">
      <div className="flex items-center justify-between px-3 py-2 border-b border-slate-800/80 text-xs text-slate-400">
        <div className="flex items-center gap-4">
          <span className="text-cyan-400 font-mono">EMA 20</span>
          <span className="text-amber-400 font-mono">EMA 50</span>
        </div>
        <span className="font-mono tabular-nums">{candles.length} closed/live bars</span>
      </div>
      <div ref={containerRef} className="w-full" />
    </div>
  );
}
