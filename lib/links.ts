/**
 * Canonical registry of Loop's external links (social + repo).
 *
 * Hoisting these into one typed module eliminates drift between components
 * (footer, nav, etc.) and makes a future link audit a single-file change.
 * Components should render from EXTERNAL_LINKS via map() rather than
 * hardcoding URLs inline.
 */
export type ExternalLink = {
  /** Stable key for React lists. */
  key: string;
  /** Visible label (without the external-link glyph). */
  label: string;
  /** Fully-qualified https URL. */
  href: string;
  /** Accessible label for screen readers. */
  ariaLabel: string;
};

export const EXTERNAL_LINKS: readonly ExternalLink[] = [
  {
    key: "github",
    label: "GitHub",
    href: "https://github.com/LoopLabsfun/loop",
    ariaLabel: "Loop on GitHub (opens in a new tab)",
  },
  {
    key: "x",
    label: "X",
    href: "https://x.com/Looplabsfun",
    ariaLabel: "Loop on X (opens in a new tab)",
  },
  {
    key: "telegram",
    label: "Telegram",
    href: "https://t.me/looplabs_fun",
    ariaLabel: "Loop on Telegram (opens in a new tab)",
  },
] as const;

/**
 * Look up a single external link by its stable key.
 *
 * Lets a component (e.g. the nav) render one specific link without inlining
 * its own `find()` over EXTERNAL_LINKS — keeping the registry the single
 * source of truth. Returns `undefined` for an unknown key.
 */
export function getExternalLink(key: string): ExternalLink | undefined {
  return EXTERNAL_LINKS.find((link) => link.key === key);
}
