"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import type { Candle } from "@/lib/types";
import type { ChartMode } from "@/lib/useLiveMarket";
import { fmtPrice, fmtPriceSub } from "@/lib/format";

// Hand-rolled SVG candlestick/line chart — upgraded from the original static
// render: price gridlines + axis, a volume pane, a time axis, session high/low
// markers, and a hover crosshair with a full OHLC+volume tooltip. Timestamps
// and volume are optional on Candle (absent on simulated data) — every extra
// pane/label degrades away cleanly when the data isn't there.

const W = 780;
const PRICE_H = 252; // price pane height
const VOL_H = 42; // volume pane height (only when volume data exists)
const AXIS_H = 18; // time-axis strip (only when timestamps exist)
const R = 64; // right gutter for the price axis
const T = 14; // top padding
const GAP = 10; // between price + volume panes

const GRID = "#F2F0F4";
const LABEL = "#9B95A4";
const UP = "oklch(0.6 0.16 150)";
const DOWN = "oklch(0.58 0.19 25)";

export function Chart({ candles, mode }: { candles: Candle[]; mode: ChartMode }) {
  const svgRef = useRef<SVGSVGElement | null>(null);
  const [hover, setHover] = useState<number | null>(null);

  const hasTime = candles.some((c) => c.t != null);
  const hasVol = candles.some((c) => (c.v ?? 0) > 0);
  const H = T + PRICE_H + (hasVol ? GAP + VOL_H : 0) + (hasTime ? AXIS_H : 0) + 4;

  let min = Math.min(...candles.map((c) => c.l));
  let max = Math.max(...candles.map((c) => c.h));
  if (max === min) {
    // A perfectly flat series (quiet token, gap-filled candles) must not fall
    // back to a $1 span — on a $0.000002 token that draws a $1.00 axis with
    // the price crushed onto the baseline. Pad ±5% of the price instead so the
    // flat line sits centered on a sane scale.
    const pad = max * 0.05 || 0.5;
    min -= pad;
    max += pad;
  }
  const span = max - min;
  const cw = (W - R) / candles.length;
  const x = useCallback((i: number) => i * cw + cw / 2, [cw]);
  const y = useCallback(
    (v: number) => T + (1 - (v - min) / span) * PRICE_H,
    [min, span]
  );
  const volTop = T + PRICE_H + GAP;
  const vmax = Math.max(...candles.map((c) => c.v ?? 0), 1);

  // Nearest candle under the pointer (viewBox coordinates scale with width).
  const onMove = useCallback(
    (e: React.MouseEvent<SVGSVGElement>) => {
      const el = svgRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      const vx = ((e.clientX - rect.left) / rect.width) * W;
      if (vx < 0 || vx > W - R + 8) return setHover(null);
      setHover(Math.max(0, Math.min(candles.length - 1, Math.floor(vx / cw))));
    },
    [candles.length, cw]
  );

  // Session high/low markers: label the extreme candles once each.
  const hiIdx = useMemo(() => candles.findIndex((c) => c.h === max), [candles, max]);
  const loIdx = useMemo(() => candles.findIndex((c) => c.l === min), [candles, min]);

  if (!candles.length) return null;

  const gridlines = [];
  for (let g = 0; g <= 4; g++) {
    const v = min + (span * g) / 4;
    gridlines.push(
      <g key={`g${g}`}>
        <line x1={0} x2={W - R + 8} y1={y(v)} y2={y(v)} stroke={GRID} strokeWidth={1} />
        <text x={W - R + 14} y={y(v) + 4} fill={LABEL} fontSize={11} fontFamily="var(--font-mono), monospace">
          {fmtPriceSub(v)}
        </text>
      </g>
    );
  }

  const series =
    mode === "candles" ? (
      candles.map((c, i) => {
        const up = c.c >= c.o;
        const col = up ? UP : DOWN;
        const dim = hover != null && hover !== i;
        return (
          <g key={`c${i}`} opacity={dim ? 0.45 : 1}>
            <line x1={x(i)} x2={x(i)} y1={y(c.h)} y2={y(c.l)} stroke={col} strokeWidth={1.2} />
            <rect
              x={x(i) - cw * 0.32}
              y={Math.min(y(c.o), y(c.c))}
              width={cw * 0.64}
              height={Math.max(1.5, Math.abs(y(c.o) - y(c.c)))}
              fill={col}
              rx={1}
            />
          </g>
        );
      })
    ) : (
      <LineSeries candles={candles} x={x} y={y} baseline={T + PRICE_H} />
    );

  const lastY = y(candles[candles.length - 1].c);
  const hovered = hover != null ? candles[hover] : null;

  return (
    <div className="relative">
      <svg
        ref={svgRef}
        width="100%"
        viewBox={`0 0 ${W} ${H}`}
        className="block"
        onMouseMove={onMove}
        onMouseLeave={() => setHover(null)}
      >
        {gridlines}
        {series}

        {/* Volume pane — direction-colored bars, only when real volume exists. */}
        {hasVol && (
          <g>
            <line x1={0} x2={W - R + 8} y1={volTop + VOL_H} y2={volTop + VOL_H} stroke={GRID} strokeWidth={1} />
            {candles.map((c, i) => {
              const v = c.v ?? 0;
              if (v <= 0) return null;
              const bh = Math.max(1.5, (v / vmax) * VOL_H);
              return (
                <rect
                  key={`v${i}`}
                  x={x(i) - cw * 0.32}
                  y={volTop + VOL_H - bh}
                  width={cw * 0.64}
                  height={bh}
                  fill={c.c >= c.o ? UP : DOWN}
                  opacity={hover != null && hover !== i ? 0.25 : 0.55}
                  rx={1}
                />
              );
            })}
            <text x={2} y={volTop + 9} fill={LABEL} fontSize={9.5} fontFamily="var(--font-mono), monospace">
              VOL
            </text>
          </g>
        )}

        {/* Time axis — a handful of evenly spaced labels. */}
        {hasTime && (
          <g>
            {timeTicks(candles).map(({ i, label }) => (
              <text
                key={`t${i}`}
                x={x(i)}
                y={H - 4}
                fill={LABEL}
                fontSize={10}
                textAnchor="middle"
                fontFamily="var(--font-mono), monospace"
              >
                {label}
              </text>
            ))}
          </g>
        )}

        {/* Session high / low markers. */}
        <text x={Math.min(x(hiIdx), W - R - 30)} y={y(max) - 4} fill={LABEL} fontSize={9.5} textAnchor="middle" fontFamily="var(--font-mono), monospace">
          H {fmtPriceSub(max)}
        </text>
        <text x={Math.min(x(loIdx), W - R - 30)} y={Math.min(y(min) + 11, T + PRICE_H - 2)} fill={LABEL} fontSize={9.5} textAnchor="middle" fontFamily="var(--font-mono), monospace">
          L {fmtPriceSub(min)}
        </text>

        {/* Last price line + pill. */}
        <line x1={0} x2={W - R + 8} y1={lastY} y2={lastY} stroke="var(--accent)" strokeWidth={1} strokeDasharray="4 4" />
        <rect x={W - R + 8} y={lastY - 9} width={R - 8} height={18} rx={4} fill="var(--accent)" />
        <text x={W - R + 14} y={lastY + 4} fill="#fff" fontSize={10.5} fontFamily="var(--font-mono), monospace">
          {fmtPriceSub(candles[candles.length - 1].c)}
        </text>

        {/* Hover crosshair. */}
        {hover != null && (
          <g pointerEvents="none">
            <line x1={x(hover)} x2={x(hover)} y1={T} y2={hasVol ? volTop + VOL_H : T + PRICE_H} stroke={LABEL} strokeWidth={1} strokeDasharray="3 3" />
            <line x1={0} x2={W - R + 8} y1={y(candles[hover].c)} y2={y(candles[hover].c)} stroke={LABEL} strokeWidth={0.8} strokeDasharray="3 3" />
          </g>
        )}
      </svg>

      {/* OHLC tooltip — flips sides so it never leaves the chart. */}
      {hovered && (
        <div
          className="absolute top-2 pointer-events-none bg-surface border border-line-2 rounded-[10px] px-3 py-2 shadow-sm font-mono text-[11px] leading-[1.7] z-10"
          style={hover! < candles.length / 2 ? { right: 76 } : { left: 8 }}
        >
          {hovered.t != null && (
            <div className="text-faint">{tooltipTime(hovered.t, candles)}</div>
          )}
          <div className="flex gap-3">
            <span className="text-faint">O</span>
            <span className="text-ink">{fmtPrice(hovered.o)}</span>
            <span className="text-faint">H</span>
            <span className="text-ink">{fmtPrice(hovered.h)}</span>
          </div>
          <div className="flex gap-3">
            <span className="text-faint">L</span>
            <span className="text-ink">{fmtPrice(hovered.l)}</span>
            <span className="text-faint">C</span>
            <span style={{ color: hovered.c >= hovered.o ? "var(--pos)" : "var(--neg)" }}>
              {fmtPrice(hovered.c)}
            </span>
          </div>
          <div className="flex gap-3">
            <span className="text-faint">Δ</span>
            <span style={{ color: hovered.c >= hovered.o ? "var(--pos)" : "var(--neg)" }}>
              {pctChange(hovered)}
            </span>
            {(hovered.v ?? 0) > 0 && (
              <>
                <span className="text-faint">Vol</span>
                <span className="text-ink">${compact(hovered.v!)}</span>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function LineSeries({
  candles,
  x,
  y,
  baseline,
}: {
  candles: Candle[];
  x: (i: number) => number;
  y: (v: number) => number;
  baseline: number;
}) {
  const pts = candles.map((c, i) => `${x(i)},${y(c.c)}`).join(" ");
  return (
    <>
      <polygon points={`0,${baseline} ${pts} ${W - R},${baseline}`} fill="var(--accent)" opacity={0.07} />
      <polyline points={pts} fill="none" stroke="var(--accent)" strokeWidth={2.2} />
    </>
  );
}

// ── axis/tooltip helpers ─────────────────────────────────────────────────────

/** Whether the series spans ≤ 2 days (→ clock labels) or more (→ date labels). */
function isIntraday(candles: Candle[]): boolean {
  const ts = candles.filter((c) => c.t != null).map((c) => c.t!);
  return ts.length < 2 || ts[ts.length - 1] - ts[0] <= 2 * 86400;
}

/** ~5 evenly spaced time labels across candles that carry timestamps. */
function timeTicks(candles: Candle[]): { i: number; label: string }[] {
  const intraday = isIntraday(candles);
  const step = Math.max(1, Math.floor(candles.length / 5));
  const out: { i: number; label: string }[] = [];
  for (let i = Math.floor(step / 2); i < candles.length; i += step) {
    const t = candles[i]?.t;
    if (t == null) continue;
    const d = new Date(t * 1000);
    out.push({
      i,
      label: intraday
        ? d.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", hour12: false })
        : d.toLocaleDateString("en-US", { month: "short", day: "numeric" }),
    });
  }
  return out;
}

function tooltipTime(t: number, candles: Candle[]): string {
  const d = new Date(t * 1000);
  const date = d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  return isIntraday(candles)
    ? `${date} · ${d.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", hour12: false })}`
    : date;
}

function pctChange(c: Candle): string {
  const pct = c.o ? ((c.c - c.o) / c.o) * 100 : 0;
  return `${pct >= 0 ? "+" : ""}${pct.toFixed(2)}%`;
}

function compact(v: number): string {
  if (v >= 1_000_000) return `${(v / 1_000_000).toFixed(1)}M`;
  if (v >= 1_000) return `${(v / 1_000).toFixed(1)}K`;
  return v.toFixed(v >= 10 ? 0 : 2);
}
