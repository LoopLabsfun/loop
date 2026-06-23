# Telegram public launch — clean & professional setup

Goal: open Loop's Telegram to the public with a **clean, scam-proof, pro** setup —
Rose moderation, a buybot, antispam, blocked transfers/GIFs/forbidden words,
topic-based structure. Keep all setup activity invisible until launch.

## Architecture (important)

`looplabs_fun` is a **broadcast CHANNEL** (admin-only posts) — already public, this
is the **Announcements** feed. The community features you want (member chat, Rose,
buybot, antispam, topics) require a **discussion supergroup**, because members can't
post in a channel.

```
┌─────────────────────────┐         ┌────────────────────────────────────────┐
│  CHANNEL  @looplabs_fun  │  link → │  DISCUSSION SUPERGROUP  "Loop Community"│
│  Announcements (admin)   │ ◀─────  │  chat + Rose + buybot + topics + bots   │
└─────────────────────────┘  comments└────────────────────────────────────────┘
```

Comments under each channel post are powered by the linked discussion group. That
linked supergroup is where everything below happens.

## What's automated vs manual

`@LoopLabsBot` is already admin of the channel (full rights). The Bot API can
automate most of the supergroup config, but **cannot create a group, enable
Topics, set slow mode, add other bots, or configure Rose** — those are human-only.

| Step | How |
|---|---|
| Create discussion supergroup + link to channel | **Manual** (app) |
| Enable Topics | **Manual** (app) |
| Add @LoopLabsBot as admin | **Manual** (app) |
| Default member permissions (kill GIFs/stickers/docs/audio/polls/invites) | **Script** ✅ |
| Create the 6 topics | **Script** ✅ (needs Topics ON first) |
| Description + English rules (posted, NOT pinned) | **Script** ✅ |
| Clean up setup noise (invisible) | **Script** ✅ `--clean` |
| Add + configure Rose (locks, blacklist, captcha, antiflood) | **Manual** (Rose) |
| Add Safeguard (entry anti-bot) | **Manual** |
| Add + configure buybot | **Manual** |
| Slow mode | **Manual** (app) |

## Run the script

```bash
set -a; source .env.local; set +a
# point at the NEW discussion supergroup id (-100…), NOT the channel:
export TELEGRAM_GROUP_CHAT_ID=-100XXXXXXXXXX

# preview (sends nothing):
npx tsx scripts/setup-telegram-group.ts
# apply:
npx tsx scripts/setup-telegram-group.ts --apply
# wipe setup/test noise to stay invisible (delete msg ids 1..200):
npx tsx scripts/setup-telegram-group.ts --clean 1-200 --apply
```

The script applies this native anti-spam baseline (default member permissions):

| Allowed | Blocked |
|---|---|
| text, photos, videos, link previews | GIFs, stickers, games, inline bots |
| | documents/files, audio, voice & video notes |
| | polls, member invites, self-pinning |

> **Forwarding and forbidden words are NOT native Telegram permissions** — there's
> no Bot API field for them. They're enforced by **Rose** below (`/lock forward`,
> `/blacklist …`). The script handles everything that IS native.

---

## Manual steps (founder, ~15 min, do while the group is still private)

### A. Create + link the discussion group
1. Telegram → New Group → "Loop Community" → add @LoopLabsBot.
2. Edit → **Topics → ON**.
3. Edit → Permissions: turn OFF "Add Members" for members (belt-and-suspenders).
4. Edit → **Slow Mode → 15s** (best native anti-flood for launch day).
5. In the **channel** `looplabs_fun` → Edit → **Discussion → link** this group.
6. Promote @LoopLabsBot to **admin** with Delete/Restrict/Invite/Manage-topics.
7. Get the group's `-100…` id (e.g. add @RawDataBot momentarily, or read it from
   the bot's update) → run the script (above).

### B. Rose — `@MissRose_bot` (the moderation core)
Add Rose, promote to admin (all rights except Anonymous), then:

```
/lock forward       # blocks forwarded messages (your ask)
/lock url           # OR use allowlist below for a softer rule
/lock anonchannel   # blocks posting as a channel (common scam)
/lock gif
/lock sticker
/lock document
/lock game
/lock inlinebots
/lock phone
/lock email
/allowlist add looplabs.fun pump.fun x.com t.me dexscreener.com   # if using soft URL rule

# forbidden words → auto-remove + sanction
/blacklist airdrop
/blacklist "claim your"
/blacklist "send 0.1 sol"
/blacklist "dm me"
/blacklist "support team"
/blacklist metamask
/blacklist "seed phrase"
/blacklist whatsapp
/blacklist t.me/+          # private invite links = scam vector
/setblacklistmode tban 1d

# antiflood
/setflood 6
/setfloodmode tmute 10m

# entry captcha (blocks bots)
/captcha on
/captcha button
/welcome on
/cleanwelcome on
/reports on
```
Set rules with `/setrules` (paste the English block below).

### C. Safeguard — `@SafeguardRobot` (optional extra)
Verified entry portal that stops scrapers/drainer bots before they can read the
group. Use the **official verified** bot only (many fakes exist). Rose's captcha
alone is already solid — Safeguard is the level-up.

### D. Buybot
Pick a buybot that supports the LOOP venue (Pump.fun AMM / Raydium), e.g.
`@Pump_Fun_Buy_Bot` or DexScreener's. Configure:
- CA: `1HzvfoqESQMaRz7hBYpAYNutp4kdXSZnB3HCfFNLoop`
- Restrict it to the **🟢 Buys** topic only.
- Min buy shown ≥ $20 (kills micro-buy spam), custom emoji + chart link + media.
- The agent's on-chain buybacks will show up here automatically — a strong
  "the agent is working" signal.

---

## Copy blocks (English, paste as-is)

### `/setrules`
```
Welcome to Loop — house rules.

Loop is an autonomous software factory. $LOOP funds an AI agent that builds the product in public. Keep this room clean so it stays useful.

1. No scams. The team will NEVER DM you first. We never ask for your seed phrase, wallet, or funds. Anyone who does is an impostor — report and block.
2. No spam. No unsolicited links, no shilling other tokens, no airdrop/giveaway bait, no mass tagging.
3. No forwards / GIF / sticker spam. Keep it readable.
4. Be civil. No FUD raids, no harassment, no NSFW. English in the main topics.
5. Right topic. Charts & TA in Analysis, questions in Support, off-topic in General.

Official links only: looplabs.fun · t.me/looplabs_fun · x.com/Looplabsfun
Breaking these = mute then ban. Ideas trade, AI builds.
```

### Welcome (`/setwelcome`)
```
Welcome {first} 👋
You're in Loop — where $LOOP funds an AI agent that builds in public.
Tap to verify, then read the pinned rules. ⚠️ The team will NEVER DM you first.
```

### Pinned launch announcement (post in the channel when you open the group)
```
💬 Loop community chat is open.

Talk to the team and holders, watch the agent ship, follow buys live.
• 📊 Analysis — charts & TA
• 🤖 Agent Activity — what the agent is building
• 🟢 Buys — live buybot feed

One rule above all: the team will NEVER DM you first. Stay safe.
Join → t.me/looplabs_fun
```

---

## Launch checklist

**Pre-open (group still admin-only / private):**
- [ ] Group created, Topics ON, linked to channel, @LoopLabsBot admin
- [ ] `setup-telegram-group.ts --apply` ran (permissions + topics + rules)
- [ ] Rose: locks (forward/url/gif/sticker/document/anonchannel/inlinebots) + blacklist + captcha + antiflood
- [ ] Safeguard (if used) + buybot in Buys topic, test buy visible
- [ ] Slow mode 15s, "Add members" OFF
- [ ] 2–3 trusted human admins added
- [ ] **Test with a 2nd account:** forward → blocked? GIF → blocked? blacklist word → removed? captcha → required? link → handled?
- [ ] `--clean` sweep run to remove all test/setup noise (invisible)

**Open:**
- [ ] Lift admin-only / share the link
- [ ] Post the launch announcement in the channel
- [ ] Watch the first 2h actively (scammers probe immediately)

**After:**
- [ ] Tune slow mode down if healthy; refine blacklist from what slips through
