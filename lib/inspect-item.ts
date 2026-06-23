import type { AgentTask, InboxMessage, SocialPost } from "./agent";
import type { WalletAction } from "./agent-data";
import type { FeedItem } from "./console";
import type { ChatMsg } from "./chat";
import type { Holder } from "./types";

// Pure types + helpers for the inspector seam (the "click anything → detail
// drawer" feature). Kept JSX-free in a plain .ts so the mapping is unit-testable;
// the React provider/hooks live in lib/inspector.tsx and re-export these.

export type InspectItem =
  | { kind: "task"; task: AgentTask }
  | { kind: "action"; action: WalletAction }
  | { kind: "commit"; commit: { hash: string; msg: string } }
  | { kind: "proposal"; item: FeedItem }
  | { kind: "directive"; item: FeedItem }
  | { kind: "chat"; msg: ChatMsg }
  | { kind: "claim"; claim: { sig: string; sol: number; at: number; source: string } }
  | { kind: "email"; email: InboxMessage }
  | { kind: "social"; post: SocialPost }
  | { kind: "holder"; holder: Holder }
  | { kind: "summary"; summary: { text: string; at?: string; shipped?: string[] } }
  | { kind: "stat"; stat: { label: string; value: string; help?: string } };

export interface InspectKindMeta {
  /** Drawer eyebrow label, e.g. "AGENT TASK". */
  label: string;
  /** A small glyph for the header. */
  glyph: string;
}

/**
 * Pure: the header label + glyph for an inspected item. One source of truth for
 * the drawer and any future surface; unit-tested.
 */
export function inspectKindMeta(item: InspectItem): InspectKindMeta {
  switch (item.kind) {
    case "task":
      return { label: "AGENT TASK", glyph: "◇" };
    case "action":
      return { label: "ON-CHAIN ACTION", glyph: "◎" };
    case "commit":
      return { label: "COMMIT", glyph: "⌥" };
    case "proposal":
      return { label: "HOLDER PROPOSAL", glyph: "▤" };
    case "directive":
      return { label: "DIRECTIVE", glyph: "›" };
    case "chat":
      return { label: "AGENT Q&A", glyph: "✦" };
    case "claim":
      return { label: "TREASURY INFLOW", glyph: "◎" };
    case "email":
      return { label: "AGENT EMAIL", glyph: item.email.direction === "out" ? "↗" : "↘" };
    case "social":
      return { label: "SOCIAL POST", glyph: "✺" };
    case "holder":
      return { label: "HOLDER", glyph: "◈" };
    case "summary":
      return { label: "AGENT UPDATE", glyph: "✎" };
    case "stat":
      return { label: item.stat.label.toUpperCase(), glyph: "▦" };
  }
}
