# loop-email-inbound

A Cloudflare Email Worker that delivers messages sent to the agent mailbox
(`*@agents.looplabs.fun`) into the app's inbound endpoint, so the runtime can
read and answer them and the Agent Console shows the conversation.

```
sender → Cloudflare Email Routing → this Worker → POST /api/email/inbound → agent_emails
```

It is the adapter the app route was built for: a custom `x-email-secret` header
plus a `{to, from, subject, text}` JSON body (NOT Resend's Svix-signed webhook).

## One-time setup

1. **Install + deploy the Worker**

   ```bash
   cd workers/email-inbound
   npm install
   npx wrangler login            # if not already authenticated
   npx wrangler secret put EMAIL_INBOUND_SECRET
   #   paste the SAME value set in Vercel as EMAIL_INBOUND_SECRET
   npx wrangler deploy
   ```

   The `INBOUND_URL` var defaults to `https://looplabs.fun/api/email/inbound`
   (edit `wrangler.toml` to change it). Set `FORWARD_TO` there if you also want a
   copy delivered to a human mailbox.

2. **Point Cloudflare Email Routing at the Worker**

   In the Cloudflare dashboard for `looplabs.fun` (or the `agents.` subdomain
   zone):

   - **Email → Email Routing → Enable** (adds the inbound MX + SPF records).
   - **Routing rules → Catch-all → Action: Send to a Worker → `loop-email-inbound`.**
     (Or add an explicit rule for the `agents.looplabs.fun` addresses.)

   Once the MX records propagate, any mail to `<slug>@agents.looplabs.fun` runs
   the Worker, which POSTs it to the app.

## Verify

Send a test email to `loop@agents.looplabs.fun`, then check:

```bash
npx wrangler tail            # Worker logs (should show a 200 from the POST)
```

and confirm a new `direction = "in"` row appears in the `agent_emails` table.

## Notes

- The Worker accepts-and-drops on an app hiccup (never bounces the sender).
- `nodejs_compat` is required for `postal-mime` MIME parsing.
- The app side (`/api/email/inbound`, `lib/email-inbound.ts`) is already deployed
  and gated on `EMAIL_INBOUND_SECRET` — this Worker is the only missing piece.
