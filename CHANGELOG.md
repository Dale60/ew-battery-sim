# Changelog

All notable changes to the Eden Worth Battery Simulator are documented here.
Format loosely based on [Keep a Changelog](https://keepachangelog.com/).

---

## [3.8] — 2026-04-21

### Added — Design tab (Mode B: reverse spec)

New tab between Simulate and How-this-works. Works opposite to the Simulate tab —
instead of picking a cell and seeing how long it lasts, state the requirement
(target lifespan, environment, backhaul technology, TX frequency, coverage) and
the tool recommends feasible cell configurations.

- **5 requirement sections:** lifespan target, environment (preset dropdown +
  sliders), backhaul (LoRaWAN / NB-IoT nRF91 / NB-IoT Telit / GSM / NB-NTN),
  TX frequency (5min–weekly), coverage quality (good / fair / CE1 / CE2),
  pre-deployment shelf time.
- **Analyse button** runs 36 simulations (6 cells × 6 TX frequencies) per click.
  Roughly 1s on modern hardware.
- **Three output sections:**
  1. **Verdict card** — ACHIEVABLE / MARGINAL / INFEASIBLE with colour-coded
     headline showing margin vs target, plus narrative (what you asked for,
     how many cells meet it, design-flavour recommendation).
  2. **Ranked cell list** — all 6 cells sorted by margin at the target TX
     frequency. ✓ / ⚠ / ✗ icons, margin percentage, achievable years.
  3. **Feasibility envelope scatter plot** — X = TX frequency (log-ish),
     Y = achievable life years, one series per cell, target line overlay,
     vertical marker at user's chosen TX freq. Tooltip shows target-met status.

Answers questions like:
- "Can we hit 10yr NB-IoT hourly in an NSW hay shed?"
- "If we drop to 4hr TX, what cells become feasible?"
- "Is this Farmo deployment pushing ER18505M pack too hard?"

### Deferred

- **Mode C (what-if dashboard)** — side-by-side scenario comparison.
  Requires a more substantial UI (N parallel sim states + delta display).
  Planned for v3.9 or v3.10.

### Feedback entry

Seeded as implemented entry #5 documenting the design decision and Mode C
deferral rationale.

---

## [3.7] — 2026-04-20

### Fixed — product/cell data corrected against Confluence

Previous built-in projects had incorrect backhaul-to-product mappings that I
guessed rather than verified. Kyle caught this on first production use
("Optima Pulse is NB-IoT not LoRaWAN"). Corrected against Confluence pages:
Farmo Product Documentation, LoRaWAN Hay Shepherd, Optima Pulse Logger
(LWM2M), Farmo Water Pressure Sensor NB-IoT Build, senseAll series.

### Changed — CELLS dict expanded 3 → 6 variants

| Cell key | Type | Capacity | Notes |
|---|---|---|---|
| `ER34615` | Bobbin D | 19 Ah | unchanged |
| `ER34615M` | Spiral D | **14 Ah** (was 13) | corrected |
| `ER34615_HPC1520` | Hybrid | 19 Ah + 150 mAh HPC | ≥3.35V @ 5Ω |
| `ER34615_HPC1530` | Hybrid | 19 Ah + 225 mAh HPC | ≥3.40V @ 5Ω |
| `ER34615_HPC1550` | Hybrid + PPTC | 19 Ah + 350 mAh HPC | ≥3.45V @ 5Ω |
| `ER18505M_2P` | Fanso spiral A ×2 parallel | 7 Ah | new |

All variants include a `supplier` field with traceability to the datasheet
that numbers came from (Long Sing drawings P101001460/70/80 for HPCs).

Removed: generic `ER34615_HPC` key. Existing saved projects referencing it
auto-migrate to `ER34615_HPC1530` on load (the sensible default).

### Changed — Built-in projects restructured

11 projects, properly mapped to actual product × backhaul × cell:

- Optima Pulse · NB-IoT (ER18505M ×2)
- Optima Enviro Shepherd · LoRa AS923 (ER34615)
- Optima Enviro Shepherd · NB-IoT (ER34615)
- eco-SENSE · LoRa AU915 (ER34615)
- eco-SENSE · LoRa AS923 (ER34615)
- eco-SENSE · NB-IoT (ER34615)
- SenseAll · LoRa AS923 (ER34615) — LoRa only for now
- EW PRO68 · GSM tracker (ER34615M)
- Water Rat · NB-IoT (ER34615) — new
- Farmo Water Pressure · NB-IoT (ER18505M ×2) — new, matches real build
- Dog Tracker · NB-IoT farm (ER34615)

Each project sets sensible default modifiers (voltage-scaled modem ON for
cellular devices, retry multiplier bumped to 2.4× for Hay Shepherd NB-IoT
reflecting known Balco-style marginal coverage).

Skipped: Optima Enviro generic (unreleased), Sigfox variants (legacy).

### Added — Smart compare mode

`CELL_FAMILIES` groups cells so compareMode compares within family rather
than dumping all 6 onto the screen:
- `d-cell`: Bobbin vs Spiral vs Hybrid HPC1530
- `hpc-variants`: HPC1520 vs HPC1530 vs HPC1550 (pick-your-HPC view)
- `a-pack`: ER18505M_2P (standalone, no in-family alternatives)

Cell dropdown gets optgroups grouping D-cells, HPC variants, and A-pack.
Cell cards show supplier datasheet reference + 5Ω load voltage spec.

### Added — Feedback entry documenting this fix

Dale's correction seeded as `implemented` feedback entry #4 with full
resolution notes for audit trail.

---

## [3.6] — 2026-04-19 / 2026-04-20

### Added

- **LTE realistic power profile presets** — menu of device/scenario combinations
  that roll up PSM sleep + periodic TAU + data TX into an equivalent pulse
  model using **worst-case peaks** (not Nordic OPP best-case figures):

  - `nRF9151 · PSM + hourly TX (realistic, includes attach)`
  - `nRF9151 · PSM + daily TX (best case LTE)`
  - `nRF9151 · hourly + daily cold attach` (bad-network worst case)
  - `nRF9151 · eDRX, always-reachable`
  - `Telit ME310G1 · hourly TX`
  - `SIMCOM SIM7080G · hourly TX`
  - `nRF9151 · NB-NTN satellite, 15min`

- **Poor-coverage LTE preset variants** (Kyle's retry feedback):
  - `nRF9151 · hourly TX, FAIR coverage (2.4× retries)`
  - `nRF9151 · hourly TX, POOR coverage (NB-IoT CE1, 8× reps)`
  - `nRF9151 · CE2 fringe coverage (128× reps, 15min TX)`

  Each preset includes a tooltip note explaining the source, assumptions
  (PSM timers, attach frequency, power class, band), and what it models.

- **Grouped preset dropdown** — presets now split into optgroups:
  "Simple single-pulse", "LTE realistic (includes attach/TAU)", "Custom".

- **Coverage retry multiplier** in Custom Modifiers — captures NB-IoT Coverage
  Enhancement repetition behaviour that multiplies TX active time in marginal
  RF conditions. Discrete dropdown (good/fair/poor CE1/fringe CE2) plus
  override slider (1–40×). Applied as `pulseDuration_s × multiplier` in the
  duty-cycle calculation. Default 1.0 preserves v3.5 behaviour.

- **Feedback seed (Kyle x2)** — Kyle's three-part request and follow-up on
  TX power class captured as feedback entries; the retry-related portion
  marked `implemented` with resolution note pointing to this release.

### Known open asks

- **Peak current vs average** — clarification requested. Existing model
  already handles peak separately. Reply drafted.
- **Min/max operational voltages + under-voltage event counting** — planned
  for v3.7. Per-project `deviceMinV` / `deviceMaxV` modifier pair, sim
  reports first brownout time + event count.
- **Power Class 5 (20 dBm)** preset — pending Kyle's confirmation that any
  EW products use PC5 mode. If yes, add a separate preset variant.
- **Full multi-phase LTE profile** — partially addressed via preset menu + retry
  multiplier. A true multi-phase profile (discrete attach / TAU / TX / PSM
  phases with their own currents and durations) remains a future refactor.

---

## [3.5] — 2026-04-17

### Added

- **Voltage-scaled modem peak current** — optional per-project physics modifier.
  Models cellular modems as constant-power loads (not constant-current), so
  pulse current scales as `I(V) = I_nominal × (3.6V / V_terminal)`, capped at
  1.8×. Addresses peer-review observation that nRF91 peak can reach ~500mA at
  3.0V battery vs ~350–400mA at 3.7V. Default **OFF** to preserve existing
  saved projects; users toggle on for known constant-power loads (nRF91 series,
  Telit ME310G1, SIMCOM cellular).

- **Custom modifiers panel** (per project):
  - `voltageScaledModem` (bool) — the physics correction above.
  - `inrushMultiplier` (1.0–3.0×) — extra current at cold-start.
  - `coldStartThresh` (°C) — temperature below which inrush kicks in.
  - `summerDutyBump` (0–100%) — seasonal duty-cycle increase (fridges, pumps).

  All modifiers save with the project, apply cleanly, and appear in exported
  JSON for auditability.

- **Model feedback system** — reviewers can post prose comments against a
  specific project or as general model feedback. Comments are *never*
  auto-applied to the physics — they're triaged manually (Dale/Kyle) and can
  be marked `open`, `accepted`, `rejected`, or `implemented` with a resolution
  note. Full audit trail: author, timestamp, resolver, resolution note.

- **Backend endpoints:** `GET/POST/PUT/DELETE /api/feedback` with project
  filtering and status workflow.

- **Database seed:** first start seeds the peer-review comment that motivated
  this release, marked `implemented` with a reference to the modifier.

- **Technical notes** in the "How this works" tab updated to document the
  voltage-scaled modem entry as a validated physics addition.

### Provenance

The voltage-scaled modem correction was prompted by peer review feedback
submitted April 2026:

> The documentation suggests nrf91 peak power could easily reach 500 mA when
> battery is at 3.0 V, but 50 to 100 mA less when battery is fully charged
> (3.7 V used in documents). So in addition to the average load on the battery,
> the peak currents coupled with the voltage sag of the higher internal
> resistance batteries may make the outcome worse, and favour the hybrid
> battery even more.

Validated against Nordic nRF9151 Power Class 3 characterisation and Telit
ME310G1 datasheet — both confirm constant-power modem behaviour, so I = P/V.
The 1.8× cap reflects that at very low terminal voltages (<2.0V cutoff) the
modem hits a brownout reset rather than continuing to draw more current.

### Design rationale — why chatbot-modifies-code was rejected

A chatbot that rewrites model code in response to free-text feedback was
considered and rejected. Reasons:

1. No audit trail of what changed in the physics.
2. No way to verify new coefficients against anchor data (Ultralife / MDPI).
3. Silent drift of the 30mV RMS error guarantee.
4. Customer-facing defensibility ("how did you get this number?") breaks down.

Instead: peer-review comments are captured as first-class feedback entries,
structured per-project modifiers cover the common per-deployment tweaks, and
genuine physics corrections (like this one) go through a proper version bump
with this changelog documenting the change and its source.

---

## [3.4] — 2026-04-17 (hosted)

### Added

- **VPS-hosted edition.** Replaces IndexedDB storage with server-backed SQLite.
  Team members (2–5 Eden Worth staff) share the same project database.
- **Auth:** shared team password, signed-cookie sessions, 30-day expiry.
- **Project versioning:** every save recorded in `project_history` table,
  last 50 versions per project kept.
- **Team activity:** `/api/team/activity` endpoint shows who's been active
  in the last 7 days.
- **Docker packaging:** `Dockerfile` + `docker-compose.yml` (binds
  `127.0.0.1:3001`, proxied by existing Nginx Proxy Manager).
- **Nightly backups:** `scripts/backup.sh` — SQLite `.backup` snapshot with
  14-daily / 8-weekly / 6-monthly rotation.
- **Login screen** + logout button + username indicator in header.

### Changed

- `loadAllProjects()` / `saveProject()` / `deleteProject()` / `bulkImportProjects()`
  removed. Replaced with `api.*` HTTP client.
- `beforeunload` synchronous-save removed (not needed — server is authoritative).

### Infrastructure

- Targets Ubuntu 24.04 with existing Docker + Nginx Proxy Manager.
- Uses port 3001 (verified free on the target VPS).
- Database lives in `/data/battery-sim.db` (host path `./data/`).

---

## [3.3] — 2026-04-16

### Added

- **IndexedDB persistent storage** (with localStorage fallback mirror) for
  saved projects. Survives browser restarts and most cache clears.
- **Debounced auto-save** — 2s after any slider change, when a user project
  is loaded. Status indicator shows `saving…` → `auto-saved`.
- **Export reminder banner** — appears after 10 auto-saves or 7 days since
  last export. Single-session dismissible.
- **Last-used project restore** — reopens to the project you were last on.
- **`beforeunload` save** — flushes pending changes to localStorage mirror
  on tab close.

### Changed

- Built-in Eden Worth projects marked read-only; edits require "Save as new".

---

## [3.2] — 2026-04-16

### Added

- **Project save/load system** — full slider state (cell, currents, temps,
  shelf time, duration) saved to browser localStorage.
- **6 built-in Eden Worth project presets**: Optima Pulse, Optima Enviro,
  eco-SENSE Balco, SenseAll Farmo, EW PRO68 GSM, Dog Tracker farm.
- **Project description field** shown under the selector.
- **Save / Delete / Export / Import** buttons.

---

## [3.1] — earlier

### Added

- **Kinetic overpotential** (Tafel form) calibrated against 16 Ultralife
  V-vs-T datapoints. RMS error 30 mV across −40°C to +60°C, 0.2–35 mA.
- **Predictive internal resistance** — DoD and age evolution.
- **Passivation TMV predictor** — calibrated to MDPI Fig. 15b
  (8913h @ 70°C → TMV 1.6V), amplification 5.2×.

---

## [3.0] — earlier

### Added

- Peukert fit against Ultralife datasheet (4 datapoints, <6% residuals).
- CSV overlay validation tab.
- Plain-English deployment recommendations.

---

## Earlier

See git log for pre-v3.0 history. Initial React prototype compared three
Li-SOCl₂ D-cell variants (ER34615 bobbin, ER34615M spiral, ER34615+HPC
hybrid) with basic capacity derating, passivation, and temp cycling.
