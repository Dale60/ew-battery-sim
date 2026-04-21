# Eden Worth Battery Simulator — Deployment Guide

Server-backed Li-SOCl₂ cell simulator for the Eden Worth team. Runs in Docker on your VPS, reverse-proxied through the Nginx Proxy Manager instance you already have running.

**Current version: 3.7** — see `CHANGELOG.md` for release history.

## What's in v3.7

- **Corrected product/backhaul/cell mappings** — previous built-ins had Optima Pulse as LoRaWAN (actually NB-IoT), missing Water Rat, missing Farmo Water Pressure, generic HPC instead of three real variants. All fixed against Confluence source-of-truth.
- **6 cell variants** (was 3) — ER34615, ER34615M (14Ah, corrected), HPC1520/1530/1550 with real 5Ω load voltage specs from Long Sing drawings, ER18505M ×2P Fanso pack.
- **11 built-in projects** covering real EW products × backhauls.
- **Smart compare mode** — compares within cell family, not all 6.
- **Supplier traceability** — every cell card shows datasheet reference.

## What's in v3.6

- **LTE realistic power profile menu** — preset profiles for nRF9151 (PSM/eDRX/cold-attach/NB-NTN), Telit ME310G1, SIMCOM SIM7080G. Each uses worst-case peak currents (not Nordic OPP best case) and includes a source-note tooltip.
- **Poor-coverage preset variants** — Fair (2.4× retries), NB-IoT CE1 (8×), CE2 fringe (~27×).
- **Coverage quality modifier** with discrete dropdown + override slider.
- **Grouped preset dropdown** — "Simple single-pulse" / "LTE realistic" / "Custom".

---

## Architecture

```
Internet ──► Nginx Proxy Manager ──► Docker container (127.0.0.1:3001)
                                              │
                                              ├── Node/Express app
                                              └── SQLite db in ./data volume
```

- **Backend:** Node 22 + Express + `better-sqlite3`, single-file server
- **Auth:** shared team password (env var), signed-cookie sessions, 30-day expiry
- **Storage:** SQLite in `/data/battery-sim.db` inside the container, mapped to `./data/` on the host
- **Versioning:** every project save is recorded in `project_history` (last 50 kept)
- **Backups:** nightly cron script (see below)
- **Port:** 3001 on the host loopback — NPM handles TLS & the public edge

---

## Prerequisites (already present on your VPS, per the inspection run)

- Ubuntu 24.04 ✓
- Docker 29.x ✓
- Nginx Proxy Manager running ✓
- Gitea for source hosting ✓
- SQLite3 CLI ✓ (needed for the backup script)

---

## Deploy — first-time setup

### 1. Push the repo to your Gitea

From your local machine where this tarball was extracted:

```bash
cd ew-battery-sim
git init
git add .
git commit -m "initial commit: v3.4 hosted"
git remote add origin https://gitea.YOUR-DOMAIN/dale/ew-battery-sim.git   # adjust
git push -u origin main
```

### 2. Clone on the VPS

SSH to the VPS and:

```bash
mkdir -p /opt/battery-sim
cd /opt/battery-sim
git clone https://gitea.YOUR-DOMAIN/dale/ew-battery-sim.git .
```

### 3. Create the environment file

```bash
cp .env.example .env
```

Edit `.env`:

```bash
# Generate a strong secret — 32 bytes of hex
openssl rand -hex 32
# Paste the output as AUTH_SECRET

# Pick a team password (share with Kyle + Mark via Slack DM or 1Password)
# AUTH_PASSWORD=<something strong, 16+ chars>
```

Tighten perms so only root can read it:

```bash
chmod 600 .env
```

### 4. Build and start

```bash
docker compose up -d --build
```

First build takes 1-2 minutes (better-sqlite3 needs to compile). Subsequent starts are instant.

Verify it's running:

```bash
docker compose ps
curl -s http://127.0.0.1:3001/healthz
# Expected: {"ok":true,"version":"3.4"}
```

### 5. Add a proxy host in Nginx Proxy Manager

Open NPM's web UI (wherever you've got it — usually `http://VPS-IP:81`). Add a new **Proxy Host**:

| Field | Value |
|---|---|
| Domain Names | `battery.edenworth.com.au` (or whatever you want) |
| Scheme | `http` |
| Forward Hostname / IP | `127.0.0.1` |
| Forward Port | `3001` |
| Cache Assets | ✓ |
| Block Common Exploits | ✓ |
| Websockets Support | ✗ (not needed) |

On the **SSL** tab: request a new Let's Encrypt certificate, force SSL, HTTP/2.

DNS-wise: point the subdomain at the VPS's public IP. If you're using Cloudflare (you already have cloudflared running), use a CNAME through the tunnel if you prefer to keep the origin IP hidden.

### 6. Verify end-to-end

Browse to `https://battery.edenworth.com.au`. You should see the login screen. Sign in with any username (e.g. "Dale") and the AUTH_PASSWORD you set.

---

## Set up nightly backups

```bash
sudo cp /opt/battery-sim/scripts/backup.sh /usr/local/bin/battery-sim-backup.sh
sudo chmod +x /usr/local/bin/battery-sim-backup.sh

# Test it runs
sudo /usr/local/bin/battery-sim-backup.sh

# Add to root's crontab — runs at 3:00 AM daily
sudo crontab -e
# Add this line:
0 3 * * * /usr/local/bin/battery-sim-backup.sh >> /var/log/battery-sim-backup.log 2>&1
```

Backup rotation: 14 daily + 8 weekly + 6 monthly. Files live under `/opt/battery-sim/backups/`.

**Strongly recommended:** also rsync `/opt/battery-sim/backups/` off-VPS once a week (to another Hostinger instance, S3, Backblaze, whatever). A nightly backup on the same VPS doesn't help you if the VPS itself dies.

---

## Updating the app

```bash
cd /opt/battery-sim
git pull
docker compose up -d --build
```

Zero downtime isn't guaranteed (the container restarts for ~3 seconds), but session cookies survive so users stay logged in.

---

## Operational commands

```bash
# Tail logs
docker compose logs -f battery-sim

# Restart (e.g. after changing .env)
docker compose restart

# Stop
docker compose down

# Open the SQLite DB directly (read-only recommended)
sqlite3 -readonly /opt/battery-sim/data/battery-sim.db

# Quick export of all projects as JSON (bypasses the web UI)
sqlite3 /opt/battery-sim/data/battery-sim.db \
  "SELECT json_group_object(id, json_object('name', name, 'data', json(data))) FROM projects" \
  | jq . > projects-dump.json

# See who's been active
sqlite3 /opt/battery-sim/data/battery-sim.db \
  "SELECT username, last_seen FROM user_activity ORDER BY last_seen DESC"

# Review all open feedback
sqlite3 /opt/battery-sim/data/battery-sim.db \
  "SELECT id, author, substr(comment,1,80) FROM feedback WHERE status='open' ORDER BY created_at DESC"

# Mark feedback #5 as implemented with a note (from host shell)
sqlite3 /opt/battery-sim/data/battery-sim.db \
  "UPDATE feedback SET status='implemented',
                      resolution_note='Added summer duty bump modifier',
                      resolved_by='Dale',
                      resolved_at=datetime('now')
   WHERE id=5"
```

---

## Security considerations

- **Shared password** is fine for 2-5 team members. If you ever add customers (Farmo, SAFEgroup) direct access, replace with proper per-user auth (bcrypt hashes, a real `users` table).
- The signed-cookie sessions are stateless (no Redis needed). If you rotate `AUTH_SECRET`, everyone gets logged out on next request — acceptable.
- `AUTH_PASSWORD` is compared in constant-ish time via plain string equality plus a 400ms delay on failure. Not hardened against a sophisticated timing attack, but adequate against casual brute force. NPM also rate-limits at the edge.
- Container runs as `node` user (not root), uses read-only Node base image, only `/data` is writable.
- `.env` file is `chmod 600` and gitignored.
- NPM terminates TLS and sets the `secure` flag so the auth cookie never goes over plain HTTP.

---

## Troubleshooting

**Can't log in — "invalid credentials"**
- Check `.env` has the right `AUTH_PASSWORD`, and that `docker compose restart` was run after editing

**Container won't start — "AUTH_PASSWORD not set"**
- You forgot to fill `.env`. Build from `.env.example` and restart.

**"sqlite3 not found" inside container**
- Not needed — the Node binding `better-sqlite3` is bundled. The sqlite3 CLI is only needed on the host for backups/inspection.

**Need to reset everything**
```bash
cd /opt/battery-sim
docker compose down -v   # -v removes the volume too
rm -rf data/*
docker compose up -d --build
```

**DB looks corrupt**
```bash
docker compose exec battery-sim node -e "
  const db = require('better-sqlite3')('/data/battery-sim.db');
  console.log(db.pragma('integrity_check'));
"
```
If that returns anything other than `[{ integrity_check: 'ok' }]`, restore from the most recent backup in `/opt/battery-sim/backups/daily/`.

---

## File layout

```
/opt/battery-sim/
├── server/index.js           # Backend (Express + SQLite)
├── public/index.html         # Frontend (React via CDN, single file)
├── scripts/backup.sh         # Nightly SQLite backup
├── Dockerfile
├── docker-compose.yml
├── package.json
├── CHANGELOG.md              # ← version history + physics change provenance
├── README.md                 # ← this file
├── .env                      # ← secrets, gitignored, chmod 600
├── .env.example
├── data/                     # ← SQLite database lives here (gitignored)
│   └── battery-sim.db
└── backups/                  # ← rotated backups (gitignored)
    ├── daily/
    ├── weekly/
    └── monthly/
```

---

## Future enhancements

Sensible next steps when you have time:

1. **Per-user accounts** — replace the shared password with proper bcrypt-hashed user records. Needed before any customer access.
2. **PDF export** — generate a branded PDF report for customer handover ("Battery lifespan analysis · Farmo Yea silo · 2026-04-20")
3. **Duty-cycle auto-import** — pull real current profiles from the nRF9151 firmware's sleep/wake markers instead of slider guesses
4. **Off-VPS backup** — automate rsync to a second location (weekly)
5. **Uptime monitoring** — point UptimeRobot or similar at `/healthz`

---

**Repo:** whatever Gitea URL you pushed to
**Maintainer:** Dale (primary), Kyle (cover)
**Last updated:** 2026-04-20 · v3.7
