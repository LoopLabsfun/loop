import { describe, it, expect } from "vitest";
import { inspectKindMeta, type InspectItem } from "./inspect-item";
import type { AgentTask, InboxMessage, SocialPost } from "./agent";
import type { WalletAction } from "./agent-data";
import type { FeedItem } from "./console";
import type { ChatMsg } from "./chat";
import type { Holder } from "./types";

describe("inspectKindMeta", () => {
  it("labels each kind", () => {
    const cases: [InspectItem, string][] = [
      [{ kind: "task", task: {} as unknown as AgentTask }, "AGENT TASK"],
      [{ kind: "action", action: {} as unknown as WalletAction }, "ON-CHAIN ACTION"],
      [{ kind: "commit", commit: { hash: "a", msg: "m" } }, "COMMIT"],
      [{ kind: "proposal", item: {} as unknown as FeedItem }, "HOLDER PROPOSAL"],
      [{ kind: "directive", item: {} as unknown as FeedItem }, "DIRECTIVE"],
      [{ kind: "chat", msg: {} as unknown as ChatMsg }, "AGENT Q&A"],
      [{ kind: "claim", claim: { sig: "s", sol: 0.1, at: 0, source: "PUMP_FUN" } }, "TREASURY INFLOW"],
      [{ kind: "social", post: {} as unknown as SocialPost }, "SOCIAL POST"],
      [{ kind: "holder", holder: {} as unknown as Holder }, "HOLDER"],
      [{ kind: "summary", summary: { text: "shipped X" } }, "AGENT UPDATE"],
      [{ kind: "stat", stat: { label: "Market cap", value: "$1.2M" } }, "MARKET CAP"],
    ];
    for (const [item, label] of cases) {
      expect(inspectKindMeta(item).label).toBe(label);
    }
  });

  it("flips the email glyph by direction", () => {
    const out = { direction: "out" } as unknown as InboxMessage;
    const inn = { direction: "in" } as unknown as InboxMessage;
    expect(inspectKindMeta({ kind: "email", email: out }).glyph).toBe("↗");
    expect(inspectKindMeta({ kind: "email", email: inn }).glyph).toBe("↘");
  });

  it("gives every kind a non-empty glyph", () => {
    const items: InspectItem[] = [
      { kind: "task", task: {} as unknown as AgentTask },
      { kind: "commit", commit: { hash: "a", msg: "m" } },
      { kind: "holder", holder: {} as unknown as Holder },
    ];
    for (const i of items) expect(inspectKindMeta(i).glyph.length).toBeGreaterThan(0);
  });
});
