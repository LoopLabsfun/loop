import type { Candle } from "@/lib/types";
import type { ChartMode } from "@/lib/useTokenMarket";
import { fmtPrice } from "@/lib/format";

// Re-implements the design's hand-rolled SVG candlestick/line chart.
const W = 780;
const H = 300;
const R = 64; // right gutter for the price axis
const T = 14;
const B = 16;

export function Chart({
  candles,
  mode,
}: {
  candles: Candle[];
  mode: ChartMode;
}) {
  if (!candles.length) return null;

  const min = Math.min(...candles.map((c) => c.l));
  const max = Math.max(...candles.map((c) => c.h));
  const span = max - min || 1;
  const cw = (W - R) / candles.length;
  const x = (i: number) => i * cw + cw / 2;
  const y = (v: number) => T + (1 - (v - min) / span) * (H - T - B);

  const gridlines = [];
  for (let g = 0; g <= 3; g++) {
    const v = min + (span * g) / 3;
    gridlines.push(
      <g key={`g${g}`}>
        <line x1={0} x2={W - R + 8} y1={y(v)} y2={y(v)} stroke="#F2F0F4" strokeWidth={1} />
        <text
          x={W - R + 14}
          y={y(v) + 4}
          fill="#9B95A4"
          fontSize={11}
          fontFamily="var(--font-mono), monospace"
        >
          {fmtPrice(v)}
        </text>
      </g>
    );
  }

  const series =
    mode === "candles" ? (
      candles.map((c, i) => {
        const up = c.c >= c.o;
        const col = up ? "oklch(0.6 0.16 150)" : "oklch(0.58 0.19 25)";
        return (
          <g key={`c${i}`}>
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
      <LineSeries candles={candles} x={x} y={y} />
    );

  const lastY = y(candles[candles.length - 1].c);

  return (
    <svg width="100%" viewBox={`0 0 ${W} ${H}`} className="block">
      {gridlines}
      {series}
      <line
        x1={0}
        x2={W - R + 8}
        y1={lastY}
        y2={lastY}
        stroke="var(--accent)"
        strokeWidth={1}
        strokeDasharray="4 4"
      />
      <rect x={W - R + 8} y={lastY - 9} width={R - 8} height={18} rx={4} fill="var(--accent)" />
      <text
        x={W - R + 14}
        y={lastY + 4}
        fill="#fff"
        fontSize={10.5}
        fontFamily="var(--font-mono), monospace"
      >
        {fmtPrice(candles[candles.length - 1].c)}
      </text>
    </svg>
  );
}

function LineSeries({
  candles,
  x,
  y,
}: {
  candles: Candle[];
  x: (i: number) => number;
  y: (v: number) => number;
}) {
  const pts = candles.map((c, i) => `${x(i)},${y(c.c)}`).join(" ");
  return (
    <>
      <polygon
        points={`0,${H - B} ${pts} ${W - R},${H - B}`}
        fill="var(--accent)"
        opacity={0.07}
      />
      <polyline points={pts} fill="none" stroke="var(--accent)" strokeWidth={2.2} />
    </>
  );
}
