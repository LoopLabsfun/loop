# Discord — setup guide (bot-controlled, SDK-mode)

Goal: a Loop Discord the agent **controls** — it creates channels, posts the
build-log (like Telegram/X), and reads messages each cron tick to feed memory.

Architecture: **bot token + REST polling** (no persistent gateway). Vercel is
serverless/cron, so we never hold a websocket open. Every power is a REST call:
- create/edit channels → `POST /guilds/{guild}/channels`
- post → `POST /channels/{id}/messages`
- read for memory → `GET /channels/{id}/messages?after=<lastId>` each tick

Brand assets (upload these): `dev/discord/icon.png` (512×512 server icon),
`dev/discord/banner.png` (960×540 server banner / invite splash).

---

## 1. Create the server (you, in the Discord app)
1. Discord → **＋** (Add a server) → **Create My Own** → For a club/community.
2. Name: **Loop**. Upload `dev/discord/icon.png` as the server icon.
3. Server Settings → **Enable Community** (gives Announcement channels, the
   banner slot, rules screening). Upload `dev/discord/banner.png` under
   Server Settings → Overview → **Banner background**.
4. Don't bother hand-building channels — the bot will lay them out (step 5).

## 2. Create the bot application (Developer Portal)
1. https://discord.com/developers/applications → **New Application** → "Loop".
2. **Bot** tab → the bot is created automatically. Set its avatar to `icon.png`.
3. **Privileged Gateway Intents** → enable:
   - ✅ **Message Content Intent** (so it can read message text for memory)
   - ✅ **Server Members Intent** (optional, audience modelling)
4. **Reset Token** → copy it once → this is `DISCORD_BOT_TOKEN`. Treat it like
   a password (server-only, never `NEXT_PUBLIC_`).

## 3. Invite the bot to the server
1. Dev Portal → **OAuth2 → URL Generator**.
2. Scopes: ✅ `bot`.
3. Bot Permissions: ✅ Manage Channels · ✅ Manage Roles · ✅ View Channels ·
   ✅ Send Messages · ✅ Send Messages in Threads · ✅ Embed Links ·
   ✅ Read Message History · ✅ Add Reactions.
4. Open the generated URL → pick the **Loop** server → Authorize.

## 4. Grab the IDs I need
Enable **User Settings → Advanced → Developer Mode**, then right-click → Copy ID:
- the **server** (guild) → `DISCORD_GUILD_ID`
- once the bot has made `#build-log`, its channel id → `DISCORD_BUILDLOG_CHANNEL_ID`
  (or I'll resolve it by name automatically and store it).

## 5. Env vars (give me these, I set them in .env.local + Vercel)
| Var | Scope | What |
|---|---|---|
| `DISCORD_BOT_TOKEN` | server-only | bot token from step 2.4 |
| `DISCORD_GUILD_ID` | server-only | the Loop server id |
| `DISCORD_BUILDLOG_CHANNEL_ID` | server-only | optional; auto-resolved if unset |
| `DISCORD_WEBHOOK_URL` | server-only | optional legacy broadcast (already wired) |

The current code already broadcasts via `DISCORD_WEBHOOK_URL` if set (no-op when
unset). The bot layer (token-based) adds channel management + reading on top.

---

## Channel layout the bot will create
```
INFO
  #welcome          (read-only)
  #announcements    (announcement channel; launches, milestones)
  #build-log        (read-only; the agent's dev-log — Telegram counterpart)
COMMUNITY
  #general
  #ideas
  #governance       (proposals / votes mirror)
```
Read-only = @everyone denied Send Messages; the bot keeps Send.
