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

/**
 * Single source of truth for the accessible label text. Deriving it from the
 * visible label means the two can NEVER drift: editing a label automatically
 * keeps its `ariaLabel` in sync, and there is exactly one place to change the
 * "opens in a new tab" phrasing.
 */
export function deriveExternalLinkAriaLabel(label: string): string {
  return `Loop on ${label} (opens in a new tab)`;
}

/**
 * Literal definitions (key/label/href only). `as const satisfies` keeps each
 * entry's `key` as a string LITERAL (rather than widening to `string`) while
 * still enforcing the shape — that literal preservation is what makes
 * `ExternalLinkKey` below precise.
 */
const LINK_DEFS = [
  {
    key: "github",
    label: "GitHub",
    href: "https://github.com/LoopLabsfun/loop",
  },
  {
    key: "x",
    label: "X",
    href: "https://x.com/Looplabsfun",
  },
  {
    key: "telegram",
    label: "Telegram",
    href: "https://t.me/looplabs_fun",
  },
  {
    key: "discord",
    label: "Discord",
    href: "https://discord.gg/XZSr49zqd",
  },
] as const satisfies readonly Omit<ExternalLink, "ariaLabel">[];

/**
 * The public registry. Mapping over the `as const` tuple keeps the per-entry
 * `key` union literal ("github" | "x" | "telegram") while attaching a derived
 * `ariaLabel`, so a11y text stays in lockstep with the visible label.
 */
export const EXTERNAL_LINKS = LINK_DEFS.map((l) => ({
  ...l,
  ariaLabel: deriveExternalLinkAriaLabel(l.label),
})) satisfies readonly ExternalLink[];

/**
 * Union of every registered link key ("github" | "x" | "telegram"), derived
 * from the registry itself so it can never drift. Consumers that know a key
 * statically should annotate against this instead of bare `string`.
 */
export type ExternalLinkKey = (typeof EXTERNAL_LINKS)[number]["key"];

/**
 * Typed single-item lookup beside the array, so components stop inlining
 * `EXTERNAL_LINKS.find(...)`. Centralizing the lookup prevents drift and is
 * trivially unit-testable. Returns `undefined` for an unknown key.
 */
export function getExternalLink(key: string): ExternalLink | undefined {
  return EXTERNAL_LINKS.find((l) => l.key === key);
}
