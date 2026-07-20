// Solana glyph — the three slanted bars in the brand purple→green gradient.
// Icon-only counterpart to HoodMark, used wherever a chain needs a small mark
// (header ChainSwitch, badges). The full wordmark lives in landing/Hero.tsx.
export function SolMark({ size = 16, className = "" }: { size?: number; className?: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 36 36"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      aria-hidden="true"
    >
      <defs>
        <linearGradient id="solmark-grad" x1="0" y1="1" x2="1" y2="0">
          <stop offset="0" stopColor="#9945FF" />
          <stop offset="1" stopColor="#14F195" />
        </linearGradient>
      </defs>
      <g fill="url(#solmark-grad)">
        <path d="M10 8 H34 L28 13 H4 Z" />
        <path d="M10 15.5 H34 L28 20.5 H4 Z" />
        <path d="M10 23 H34 L28 28 H4 Z" />
      </g>
    </svg>
  );
}
