# 🤖 Harper

A Baileys-powered **WhatsApp bot** for the **DawnSphereCommunity** — watermarked stickers, group moderation, anti-link / anti-spam / auto-mute, and MLBB account registration.

Built from scratch on the official [`@whiskeysockets/baileys`](https://www.npmjs.com/package/@whiskeysockets/baileys) (WhatsApp Multi-Device protocol). Runs as a **linked device** on a normal WhatsApp number — your phone keeps working.

> ⚠️ **Disclaimer** — unofficial automation of WhatsApp is against WhatsApp ToS and can result in the linked number being banned. This project is for personal/educational use. You assume all risk.

---

## Features

### Stickers (all watermarked *DawnSphereCommunity*)
| Command | What it does |
|---|---|
| `!sticker` | Reply to an image / video / GIF → 512×512 watermarked WebP sticker |
| `!attp <text>` | Colored text sticker |
| `!toimg` | Reply to a sticker → image |
| `!stickerinfo` | Sticker pack info |
| `!emoji <emoji>` | Emoji → sticker |

Sticker pack name: **DawnSphereCommunity** · author: **Harper**

### Group moderation (group admins)
`!kick` `!add <numbers>` `!promote` `!demote` `!mute` `!unmute` `!warn` `!warns` `!resetwarns` `!welcome on|off|set <msg>`

### Protection
| Command | What it does |
|---|---|
| `!antilink on\|off` | Blocks links (per `ANTILINK_ACTION`) |
| `!allowlink <domain>` / `!blocklink <domain>` | Per-group domain control |
| `!antispam on\|off` | Flood guard (N msgs / T seconds → action) |
| `!antibad on\|off` · `!word add\|remove <word>` | Bad-word filter (deletes + warns) |
| `!automute on <HH:MM> <HH:MM>` · `!automute off` | Scheduled group mute/unmute, survives restarts |

### MLBB (Mobile Legends registration)
| Command | What it does |
|---|---|
| `!mlbbreg` | Register your MLBB account (DM only) — Role ID / Zone ID / in-game verification code |
| `!mlbbpf` | Your MLBB profile card with live rank/stats + avatar |

### Utilities & admin
`!menu` `!help <cmd>` `!ping` `!alive` `!afk [reason]` · owner-only: `!pair <number>` `!mysession`

---

## Project layout

```
src/
  index.js          entry: health server + keepalive + bot
  client.js         Baileys socket, reconnects, QR rendering
  session.js        session persistence (local disk / SESSION_ID env)
  handler.js        command router + permissions + protection hooks
  helpers.js        media download, jid/admin utils
  state.js          JSON store for group settings / warns / AFK
  server.js         GET /health + self-ping keepalive
  commands/         menu, alive, sticker, moderation, afk, mlbb, owner
  groups/           antilink, spamprotect, automute, policies
  media/sticker.js  watermark + WebP/exif pipeline (sharp + ffmpeg + webpmux)
  mlbb/             MLBB registration engine + profile card
```

---

## 1. Run locally (get paired)

Requirements: Node **20+** and Git.

```bash
npm install

# optional local config
cp .env.example .env      # set OWNER=yournumber
npm start
```

A **QR code** prints in the terminal. On your phone:
**WhatsApp → Settings (⋮) → Linked Devices → Link a Device → scan.**

Once connected you'll see `[harper] connected as …`.

### Alternative: pairing code (no QR)
DM your bot `!pair <phonenumber>` and enter the 8-char code under *Link a Device → Link with phone number instead*.

### Get the session string (for Koyeb)
DM the bot `!mysession`. It replies with a long base64 string — that's your **SESSION_ID**. Keep it private.

---

## 2. Push to GitHub

```bash
git init
git add .
git commit -m "Init Harper"
gh repo create Harper --public --source . --push   # or create manually on github.com
```

`.env` and `session/` are gitignored (never commit credentials).

---

## 3. Deploy to Koyeb

1. Create the service from your GitHub repo (`New Service → GitHub Repository → Harper`).
2. Choose build type **Docker** (uses the included `Dockerfile` with ffmpeg).
3. Set environment variables:
   - `SESSION_ID` — your `!mysession` string (this is how the bot survives restarts)
   - `OWNER` — e.g. `919876543210`
   - `HARPER_APP_URL` — `https://<your-app>.koyeb.app`
   - `PREFIX`, `STICKER_PACK`, `WATERMARK` … (optional)
4. Health check path: `/health`, port: `3000` (Koyeb injects `PORT`).
5. Deploy. No terminal there, so pair by DM (`!pair`) if paired locally isn't possible, then re-pair and update `SESSION_ID`.

### Keeping it alive on the free tier
Koyeb free instances **scale to zero after 1 hour of no traffic** — that would sever your bot. Harper:
- serves `GET /health`
- self-pings `HARPER_APP_URL/health` every `KEEP_ALIVE_MIN` (default 40 min)

Optional belt-and-braces: add a free uptime monitor (UptimeRobot / cron-job.org) hitting `https://<your-app>.koyeb.app/health` every 5–10 min. If the instance does cold-start, Baileys reconnects automatically and auto-mute schedules re-apply on boot.

> 💡 For truly always-on with a persistent disk, move to a paid Koyeb instance (disable scale-to-zero + attach a volume) — same code, just set `SESSION_DIR=/vol/session` and `HARPER_APP_URL`.

---

## Configuration (`.env`)

| Var | Default | Notes |
|---|---|---|
| `PREFIX` | `!` | command prefix |
| `OWNER` | – | your number(s), comma-separated |
| `SESSION_ID` | – | base64 session (Koyeb) |
| `SESSION_DIR` | `session` | local session folder |
| `STICKER_PACK` | `DawnSphereCommunity` | sticker pack name |
| `STICKER_AUTHOR` | `Harper` | author |
| `WATERMARK` | `DawnSphereCommunity` | watermark text on stickers |
| `HARPER_APP_URL` | – | public URL for keepalive |
| `KEEP_ALIVE_MIN` | `40` | self-ping interval |
| `DEFAULT_ANTILINK` | `off` | antilink default per group |
| `ANTILINK_ACTION` | `warn` | `warn` \| `kick` \| `mute` |
| `FLOOD_LIMIT` / `FLOOD_WINDOW` | `6` / `15` | spam threshold |
| `SPAM_ACTION` / `SPAM_MUTE_MIN` | `mute` / `30` | spam response |
| `MAX_WARNS` / `WARN_MUTE_MIN` | `3` / `30` | warn policy |

---

## Roadmap ideas

- Media downloaders (YouTube, Instagram, TikTok)
- Broadcast/mass-message tool
- Music finder & audio effects
- Anti-view-once
- Persistent session backend (Postgres) for zero re-pairs

---

*Powered by DSC-SA · Built for DawnSphereCommunity.*