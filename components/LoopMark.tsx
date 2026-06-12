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

// Animated variant used in the hero — two arcs chasing around the rings.
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
      <circle cx="20" cy="20" r="13" fill="none" stroke="#EDEBF2" strokeWidth="9" />
      <circle cx="48" cy="20" r="13" fill="none" stroke="#EDEBF2" strokeWidth="9" />
      <circle
        cx="20"
        cy="20"
        r="13"
        fill="none"
        stroke="var(--accent)"
        strokeWidth="9"
        strokeLinecap="round"
        strokeDasharray="20.42 61.26"
        className="animate-spinLoop"
      />
      <circle
        cx="48"
        cy="20"
        r="13"
        fill="none"
        stroke="var(--accent)"
        strokeWidth="9"
        strokeLinecap="round"
        strokeDasharray="20.42 61.26"
        className="animate-spinLoopR"
      />
    </svg>
  );
}
