// Brand glyphs for Loop's login methods (Privy: Solana wallet + Google / X /
// GitHub / Telegram). Monochrome (currentColor) so they sit in the muted UI;
// each is a 16×16 viewBox so they line up in a row. Kept here as one small set
// so the login affordances (Nav, LaunchModal) stay consistent.

type IconProps = { size?: number; className?: string };

const base = (size: number, className?: string) => ({
  width: size,
  height: size,
  viewBox: "0 0 16 16",
  fill: "currentColor" as const,
  "aria-hidden": true,
  className,
});

/** Generic wallet glyph for the connect button. */
export function WalletIcon({ size = 15, className }: IconProps) {
  return (
    <svg {...base(size, className)} fill="none" stroke="currentColor" strokeWidth="1.4">
      <rect x="1.8" y="3.6" width="12.4" height="9" rx="2" />
      <path d="M1.8 6.2h12.4" />
      <circle cx="11.2" cy="9" r="0.9" fill="currentColor" stroke="none" />
    </svg>
  );
}

/** Solana mark — three slanted bars. */
export function SolanaIcon({ size = 15, className }: IconProps) {
  return (
    <svg {...base(size, className)}>
      <path d="M3.2 10.9c.1-.1.3-.2.5-.2h9.4c.3 0 .4.3.2.5l-1.6 1.6c-.1.1-.3.2-.5.2H1.8c-.3 0-.4-.3-.2-.5l1.6-1.6z" />
      <path d="M3.2 3.2c.1-.1.3-.2.5-.2h9.4c.3 0 .4.3.2.5l-1.6 1.6c-.1.1-.3.2-.5.2H1.8c-.3 0-.4-.3-.2-.5L3.2 3.2z" />
      <path d="M11.7 7c-.1-.1-.3-.2-.5-.2H1.8c-.3 0-.4.3-.2.5l1.6 1.6c.1.1.3.2.5.2h9.4c.3 0 .4-.3.2-.5L11.7 7z" />
    </svg>
  );
}

export function GoogleIcon({ size = 15, className }: IconProps) {
  return (
    <svg {...base(size, className)}>
      <path d="M8 3.3c1.1 0 2 .4 2.8 1.1l2-2A7 7 0 0 0 1.6 4.9l2.4 1.9C4.5 5 6.1 3.3 8 3.3z" />
      <path d="M14.7 8.2c0-.5 0-.9-.1-1.4H8v2.8h3.8c-.2.9-.7 1.6-1.5 2.1l2.3 1.8c1.4-1.3 2.1-3.1 2.1-5.3z" />
      <path d="M4 9.2a4.2 4.2 0 0 1 0-2.4L1.6 4.9a7 7 0 0 0 0 6.3L4 9.2z" />
      <path d="M8 14.7c1.9 0 3.5-.6 4.6-1.7l-2.3-1.8c-.6.4-1.4.7-2.3.7-1.9 0-3.5-1.3-4-3l-2.4 1.9A7 7 0 0 0 8 14.7z" />
    </svg>
  );
}

/** X (Twitter). */
export function XIcon({ size = 14, className }: IconProps) {
  return (
    <svg {...base(size, className)}>
      <path d="M9.4 6.9 14 1.6h-1.5L8.7 6 5.6 1.6H1.4l4.8 6.9-4.8 5.6h1.5l4.2-4.9 3.3 4.9h4.2L9.4 6.9zm-1.5 1.7-.5-.7L3.3 2.7h1.7l3.1 4.4.5.7 4.1 5.8h-1.7L7.9 8.6z" />
    </svg>
  );
}

export function GitHubIcon({ size = 15, className }: IconProps) {
  return (
    <svg {...base(size, className)}>
      <path d="M8 1.2a6.8 6.8 0 0 0-2.1 13.2c.3.1.5-.1.5-.3v-1.2c-1.9.4-2.3-.9-2.3-.9-.3-.8-.8-1-.8-1-.6-.4 0-.4 0-.4.7 0 1 .7 1 .7.6 1 1.6.7 2 .6 0-.5.2-.8.4-1-1.5-.2-3.1-.8-3.1-3.4 0-.7.3-1.3.7-1.8-.1-.2-.3-.9.1-1.9 0 0 .6-.2 1.9.7a6.4 6.4 0 0 1 3.4 0c1.3-.9 1.9-.7 1.9-.7.4 1 .1 1.7.1 1.9.4.5.7 1.1.7 1.8 0 2.6-1.6 3.2-3.1 3.4.2.2.5.6.5 1.3v2c0 .2.1.4.5.3A6.8 6.8 0 0 0 8 1.2z" />
    </svg>
  );
}

export function TelegramIcon({ size = 15, className }: IconProps) {
  return (
    <svg {...base(size, className)}>
      <path d="M14.5 2.3 1.9 7.2c-.7.3-.7.7-.1.9l3.1 1 1.2 3.8c.2.4.3.5.6.5.3 0 .4-.1.6-.3l1.5-1.5 3.1 2.3c.6.3 1 .1 1.1-.5l2-9.5c.2-.8-.3-1.1-.9-.9zM6.1 9.1 11.4 5l-4.2 4.6-.2 2.1-.9-2.6z" />
    </svg>
  );
}
