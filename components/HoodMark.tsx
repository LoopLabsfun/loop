// The Robinhood Chain mark — a stylized feather in Robinhood green, used
// wherever the UI needs to say "this is Hood" (chain switch, coming-soon card,
// chain-mismatch panel). Inline SVG so it inherits sizing and needs no asset.
export function HoodMark({
  size = 16,
  className = "",
}: {
  size?: number;
  className?: string;
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      className={className}
      aria-hidden="true"
    >
      <path
        d="M19.9 2.1c-5.5.7-9.8 3-12.6 7.1-2.1 3.1-3.2 7-3.6 11.5 0 .4.3.8.8.7 1.8-.3 3.3-.8 4.6-1.4.5-3 1.6-6 3.4-8.6.1-.2.5-.1.4.2-1.4 2.5-2.4 5.2-2.8 7.7 3.5-2.1 6.3-5.1 8.3-8.9 1.3-2.4 2.1-5.1 2.5-7.6.1-.4-.3-.8-1-.7Z"
        fill="#00C805"
      />
    </svg>
  );
}
