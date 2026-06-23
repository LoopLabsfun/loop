// The Loop mark: two overlapping rings reading as an infinity loop.

export function LoopMark({
  width = 34,
  height = 20,
  stroke = "#16131A",
  className,
}: {
  width?: number;
  height?: number;
  stroke?: string;
  className?: string;
}) {
  return (
    <svg
      width={width}
      height={height}
      viewBox="0 0 68 40"
      aria-label="Loop logo"
      className={className}
    >
      <circle cx="20" cy="20" r="13" fill="none" stroke={stroke} strokeWidth="9" />
      <circle cx="48" cy="20" r="13" fill="none" stroke={stroke} strokeWidth="9" />
    </svg>
  );
}

// A single continuous figure-8 (∞) path tracing both lobes. The two arcs are
// wound in opposite directions (sweep flags 1 then 0) so they meet smoothly at
// the centre crossing (34,20) — radius 14 so each lobe reaches that point.
const LOOP_PATH =
  "M34 20 A14 14 0 1 1 6 20 A14 14 0 1 1 34 20 A14 14 0 1 0 62 20 A14 14 0 1 0 34 20";

// Animated variant used in the hero — one trait travelling around the whole 8.
export function LoopMarkAnimated({ className }: { className?: string }) {
  return (
    <svg
      width="0.92em"
      height="0.54em"
      viewBox="0 0 68 40"
      style={{ overflow: "visible" }}
      className={className}
      aria-hidden
    >
      {/* Guide track */}
      <path d={LOOP_PATH} fill="none" stroke="#EDEBF2" strokeWidth="9" />
      {/* Single moving trait. pathLength=100 → dash units are % of the path. */}
      <path
        d={LOOP_PATH}
        pathLength={100}
        fill="none"
        stroke="var(--accent)"
        strokeWidth="9"
        strokeLinecap="round"
        strokeDasharray="26 74"
        className="animate-traceLoop"
      />
    </svg>
  );
}
