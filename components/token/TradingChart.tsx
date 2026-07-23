"use client";

import { useEffect, useLayoutEffect, useMemo, useRef } from "react";
import {
  AreaSeries,
  CandlestickSeries,
  CrosshairMode,
  HistogramSeries,
  LineStyle,
  createChart,
  createSeriesMarkers,
  type IChartApi,
  type ISeriesApi,
  type ISeriesMarkersPluginApi,
  type Time,
  type UTCTimestamp,
} from "lightweight-charts";
import type { Candle, Trade } from "@/lib/types";
import type { ChartMode } from "@/lib/useLiveMarket";
import { compactUsd, fmtPriceSub } from "@/lib/format";
import { tradeMarkers, type ChartUnit } from "./Chart";

// The token chart, on TradingView's lightweight-charts — the same engine the
// launchpads use. It replaces a hand-rolled SVG that could only render a fixed
// window: this one brings zoom, pan, a real crosshair with an OHLC legend, and
// a price scale that stays legible on a $0.000002 token.
//
// The seam is unchanged: same Candle[] in, same Price/Mcap + Candles/Line
// toggles, same trade markers (bucketing logic still lives in Chart.tsx and is
// unit-tested there). Candles without timestamps — simulated data — can't be
// placed on a time axis at all, so those fall back to the SVG chart upstream.

const UP = "#26a65b";
const DOWN = "#d1483f";
const GRID = "#F2F0F4";
const LABEL = "#9B95A4";
const ACCENT = "#5B3DF5";

export function TradingChart({
  candles,
  mode,
  unit = "price",
  supply = null,
  trades = [],
  height = 320,
}: {
  candles: Candle[];
  mode: ChartMode;
  unit?: ChartUnit;
  supply?: number | null;
  trades?: Trade[];
  height?: number;
}) {
  const boxRef = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const priceRef = useRef<ISeriesApi<"Candlestick"> | ISeriesApi<"Area"> | null>(null);
  const volRef = useRef<ISeriesApi<"Histogram"> | null>(null);
  const markersRef = useRef<ISeriesMarkersPluginApi<Time> | null>(null);
  // The user's zoom/pan must survive a 20s data refresh; it must NOT survive a
  // timeframe change (where the old range is meaningless). Tracked by grain.
  const grainRef = useRef<number | null>(null);
  // Tick granularity, derived from the series' own range: a hardcoded minMove
  // is either far too coarse (every tick collapses to "$0.00") or far too fine.
  const minMoveRef = useRef(0.00000001);

  // Market cap is price × supply — the same series rescaled, so everything
  // below is unit-agnostic and only the formatter changes.
  const scale = unit === "mcap" && supply && supply > 0 ? supply : 1;
  const fmt = useMemo(() => {
    const base = scale === 1 ? fmtPriceSub : compactUsd;
    // The price scale extends past the series into the volume margin, where the
    // ticks are zero or negative. Those aren't prices — drop the label rather
    // than printing a row of "$0.00" under the chart.
    return (v: number) => (v > 0 ? base(v) : "");
  }, [scale]);

  const data = useMemo(
    () =>
      candles
        .filter((c) => c.t != null)
        .map((c) => ({
          time: c.t as UTCTimestamp,
          open: c.o * scale,
          high: c.h * scale,
          low: c.l * scale,
          close: c.c * scale,
        })),
    [candles, scale]
  );

  // minMove must equal the precision the formatter actually prints, because the
  // library pads every label out to it: with a finer minMove, "$0.0₅180" was
  // rendered "$0.0₅180000000". fmtPriceSub shows 3 digits past the zero run, so
  // that's (zeros + 3) decimals; market cap is a plain dollar figure.
  const minMove = useMemo(() => {
    if (scale !== 1) return 1;
    const ref = data.length ? data[data.length - 1].close : 0;
    if (!(ref > 0)) return 0.00000001;
    if (ref >= 0.01) return 0.0001;
    const zeros = -Math.floor(Math.log10(ref)) - 1;
    return Math.max(10 ** -(zeros + 3), 1e-12);
  }, [data, scale]);
  minMoveRef.current = minMove;

  const volumes = useMemo(
    () =>
      candles
        .filter((c) => c.t != null && (c.v ?? 0) > 0)
        .map((c) => ({
          time: c.t as UTCTimestamp,
          value: c.v as number,
          color: c.c >= c.o ? `${UP}55` : `${DOWN}55`,
        })),
    [candles]
  );

  // Create the chart once. useLayoutEffect so the container is measured before
  // paint — createChart on a zero-width node renders an empty canvas.
  useLayoutEffect(() => {
    const box = boxRef.current;
    if (!box) return;
    const chart = createChart(box, {
      height,
      // The app is English everywhere; without this the time axis picks up the
      // browser's locale and prints month names like "juil.".
      localization: { locale: "en-US" },
      layout: {
        background: { color: "transparent" },
        textColor: LABEL,
        fontFamily: "var(--font-mono), monospace",
        fontSize: 11,
        attributionLogo: false,
      },
      grid: {
        vertLines: { color: GRID },
        horzLines: { color: GRID },
      },
      rightPriceScale: {
        borderColor: GRID,
        // Room under the price pane for the volume histogram, which shares the
        // pane rather than costing a second one.
        scaleMargins: { top: 0.1, bottom: 0.26 },
      },
      timeScale: {
        borderColor: GRID,
        timeVisible: true,
        secondsVisible: false,
      },
      crosshair: {
        mode: CrosshairMode.Normal,
        vertLine: { color: LABEL, width: 1, style: LineStyle.Dashed, labelBackgroundColor: ACCENT },
        horzLine: { color: LABEL, width: 1, style: LineStyle.Dashed, labelBackgroundColor: ACCENT },
      },
      handleScale: { axisPressedMouseMove: { time: true, price: false } },
      autoSize: true,
    });
    chartRef.current = chart;
    return () => {
      chart.remove();
      chartRef.current = null;
      priceRef.current = null;
      volRef.current = null;
      markersRef.current = null;
    };
  }, [height]);

  // (Re)build the price series when the mode or the unit's formatter changes —
  // series type and price formatter are both create-time options.
  useEffect(() => {
    const chart = chartRef.current;
    if (!chart) return;
    if (priceRef.current) {
      chart.removeSeries(priceRef.current);
      priceRef.current = null;
      markersRef.current = null;
    }
    // Tick granularity only. The *labels* come from localization.priceFormatter
    // below — a formatter passed here gets re-padded to minMove's precision,
    // which turned "$0.0₅185" into "$0.0₅18500".
    const priceFormat = {
      type: "custom" as const,
      formatter: fmt,
      minMove: minMoveRef.current,
    };
    const series =
      mode === "candles"
        ? chart.addSeries(CandlestickSeries, {
            upColor: UP,
            downColor: DOWN,
            borderUpColor: UP,
            borderDownColor: DOWN,
            wickUpColor: UP,
            wickDownColor: DOWN,
            priceFormat,
          })
        : chart.addSeries(AreaSeries, {
            lineColor: ACCENT,
            lineWidth: 2,
            topColor: `${ACCENT}2b`,
            bottomColor: `${ACCENT}00`,
            priceFormat,
          });
    priceRef.current = series;
    markersRef.current = createSeriesMarkers(series, []);
  }, [mode, fmt]);

  // Axis + crosshair labels. `priceFormatter` covers the crosshair tag; the
  // price scale's ticks go through `tickmarksPriceFormatter`, whose default
  // right-pads every label with zeros to align decimal points. That padding
  // counts characters after the ".", so the subscript run confused it into
  // rendering "$0.0₅180000000". Formatting the ticks as a set — each one
  // independently — keeps them as written.
  useEffect(() => {
    chartRef.current?.applyOptions({
      localization: {
        priceFormatter: fmt,
        tickmarksPriceFormatter: (values: readonly number[]) => values.map((v) => fmt(v)),
      },
    });
  }, [fmt]);

  // Volume histogram, pinned to the bottom of the price pane on its own scale.
  useEffect(() => {
    const chart = chartRef.current;
    if (!chart || volRef.current) return;
    volRef.current = chart.addSeries(HistogramSeries, {
      priceFormat: { type: "volume" },
      priceScaleId: "vol",
      priceLineVisible: false,
      lastValueVisible: false,
    });
    chart.priceScale("vol").applyOptions({ scaleMargins: { top: 0.8, bottom: 0 } });
  }, []);

  // Feed the data. Candles and the area series take different shapes, and the
  // visible range is only reset when the bucket grain changes (a new timeframe)
  // so a refresh never yanks the chart out from under a user who zoomed in.
  useEffect(() => {
    const series = priceRef.current;
    const chart = chartRef.current;
    if (!series || !chart || !data.length) return;
    if (mode === "candles") {
      (series as ISeriesApi<"Candlestick">).setData(data);
    } else {
      (series as ISeriesApi<"Area">).setData(
        data.map((d) => ({ time: d.time, value: d.close }))
      );
    }
    volRef.current?.setData(volumes);
    series.applyOptions({ priceFormat: { type: "custom", formatter: fmt, minMove } });

    const grain = data.length > 1 ? (data[1].time as number) - (data[0].time as number) : null;
    if (grain !== grainRef.current) {
      grainRef.current = grain;
      chart.timeScale().fitContent();
    }
  }, [data, volumes, mode, fmt, minMove]);

  // Recent fills, on the candle each landed in (same bucketing as the SVG chart).
  useEffect(() => {
    const plugin = markersRef.current;
    if (!plugin) return;
    const marks = tradeMarkers(candles, trades);
    plugin.setMarkers(
      marks.map((m) => ({
        time: candles[m.i].t as UTCTimestamp,
        position: m.side === "BUY" ? ("belowBar" as const) : ("aboveBar" as const),
        shape: m.side === "BUY" ? ("arrowUp" as const) : ("arrowDown" as const),
        color: m.side === "BUY" ? UP : DOWN,
        id: `${m.i}-${m.side}`,
      }))
    );
  }, [candles, trades]);

  return <div ref={boxRef} style={{ height }} className="w-full" />;
}
