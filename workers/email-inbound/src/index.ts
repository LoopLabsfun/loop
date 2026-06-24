import PostalMime from "postal-mime";

// ─────────────────────────────────────────────────────────────────────────────
// EMAIL INBOUND WORKER — the receiving half of the agent mailbox.
//
// Cloudflare Email Routing forwards every message sent to `*@agents.looplabs.fun`
// to this Worker's `email()` handler. We parse the MIME, reduce it to the simple
// shape the app expects, and POST it to `/api/email/inbound` with the shared
// secret header. The app resolves `<slug>@agents.looplabs.fun` to a project and
// stores the message in `agent_emails` (direction "in") so the runtime can read +
// answer it and the Agent Console shows the conversation.
//
// This Worker is the adapter the app route was designed for (custom
// `x-email-secret` header + `{to,from,subject,text}` body) — NOT Resend's
// Svix-signed webhook shape. Deploy with wrangler; see README.md.
// ─────────────────────────────────────────────────────────────────────────────

export interface Env {
  /** Full app endpoint, e.g. https://looplabs.fun/api/email/inbound */
  INBOUND_URL: string;
  /** Shared secret — must equal the app's EMAIL_INBOUND_SECRET (set as a Worker secret). */
  EMAIL_INBOUND_SECRET: string;
  /** Optional: also forward the raw email to a real mailbox the founder reads. */
  FORWARD_TO?: string;
}

interface ForwardableEmailMessage {
  readonly from: string;
  readonly to: string;
  readonly raw: ReadableStream;
  readonly headers: Headers;
  forward(rcptTo: string): Promise<void>;
  setReject(reason: string): void;
}

export default {
  async email(
    message: ForwardableEmailMessage,
    env: Env,
    ctx: { waitUntil(p: Promise<unknown>): void }
  ): Promise<void> {
    // Parse the raw MIME to extract a clean subject + plaintext body. Best-effort:
    // a parse failure still posts the envelope (to/from/subject header) so the
    // message is never silently dropped.
    let subject = message.headers.get("subject") ?? "";
    let text = "";
    try {
      const raw = await new Response(message.raw).arrayBuffer();
      const parsed = await PostalMime.parse(raw);
      subject = parsed.subject || subject;
      text = parsed.text || parsed.html || "";
    } catch {
      /* keep the header subject + empty body */
    }

    const payload = {
      to: message.to,
      from: message.from,
      subject,
      // Clamp here too so a huge email can't bloat the POST (the app re-clamps).
      text: text.slice(0, 4000),
    };

    const post = fetch(env.INBOUND_URL, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-email-secret": env.EMAIL_INBOUND_SECRET,
      },
      body: JSON.stringify(payload),
    });

    // Optionally also forward the original to a human mailbox, so the founder sees
    // agent mail too. Runs alongside the POST; never blocks delivery.
    if (env.FORWARD_TO) {
      ctx.waitUntil(message.forward(env.FORWARD_TO).catch(() => {}));
    }

    // Don't reject the sender on an app hiccup — accept + drop rather than bounce.
    try {
      const res = await post;
      if (!res.ok) console.log(`inbound POST failed: ${res.status}`);
    } catch (e) {
      console.log(`inbound POST error: ${e instanceof Error ? e.message : "unknown"}`);
    }
  },
};
