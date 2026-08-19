# Level Builder

An in-browser, Mario Maker–style platformer where levels are built screen by
screen — and different screens in the same level can be built by different
people. Players share and play each other's levels; level creation happens
one screen at a time, with screens later connected together into a full
level.

## Tech stack

| Layer      | Tech                                             |
| ---------- | ------------------------------------------------- |
| Frontend   | SvelteKit + TypeScript + Phaser 4                  |
| Backend    | Flask + Flask-SQLAlchemy + Flask-Migrate           |
| Database   | PostgreSQL (SQLite in-memory for tests)            |
| Testing    | pytest (backend), Vitest (frontend)                |
| CI/CD      | GitHub Actions                                     |
| Deployment | Render (planned)                                   |

## Prerequisites

- **Python 3.10.13** — this project is pinned via [pyenv](https://github.com/pyenv/pyenv) (`.python-version` at the repo root). Newer Python versions can hit missing prebuilt wheels for `psycopg`; 3.10.13 is the tested baseline.
- **Node.js 20+** and npm — install via [nodejs.org](https://nodejs.org) or [nvm](https://github.com/nvm-sh/nvm).
- **PostgreSQL** — running locally, or a `DATABASE_URL` pointing at one. Not required to run the test suite (tests use in-memory SQLite).
- **Git**

> **Windows note:** if `pip install` fails while building `psycopg`, this project uses `psycopg[binary]` specifically to avoid the native-compile issues `psycopg2-binary` runs into on Windows. Make sure you're on the pinned version in `requirements.txt`, not an older `psycopg2-binary`.

## Project structure

```
level-builder/
├── backend/                 # Flask API
│   ├── app/
│   │   ├── main.py           # create_app() factory
│   │   ├── config.py         # Testing/Development/Production config
│   │   ├── extensions.py     # shared Flask-SQLAlchemy instance
│   │   └── models/            # SQLAlchemy models
│   ├── tests/
│   ├── requirements.txt
│   └── requirements-dev.txt
├── frontend/                # SvelteKit app
│   └── src/
│       ├── lib/
│       │   ├── api.ts         # backend API client
│       │   └── game/          # Phaser scenes, movement/mode logic
│       └── routes/
│           └── play/          # the game itself
├── .github/workflows/       # CI: backend-ci.yml, frontend-ci.yml
└── .python-version          # pins Python 3.10.13 via pyenv
```

## Backend setup

```bash
cd backend
pyenv local 3.10.13          # if not already picked up from the repo root
python3 -m venv venv
source venv/bin/activate     # Windows: venv\Scripts\activate
pip install --upgrade pip
pip install -r requirements-dev.txt
```

Run the test suite (uses in-memory SQLite, no Postgres required):

```bash
pytest -v
ruff check .
```

Run the dev server (requires Postgres, or set `DATABASE_URL` to override):

```bash
flask --app "app.main:create_app('development')" run --port 5000
```

Health check: `curl http://localhost:5000/health` → `{"status":"ok"}`

## Frontend setup

```bash
cd frontend
npm install
```

Run the test suite:

```bash
npm run test    # Vitest
npm run check   # svelte-check (TypeScript)
```

Run the dev server:

```bash
npm run dev -- --open
```

Opens `localhost:5173`. The homepage checks the backend's `/health`
endpoint — with the backend running, it should show **"Backend status: ✅
connected."**

## Running the game

With both servers running, visit **`localhost:5173/play`**.

**Play Mode controls:**

| Action | Keyboard      | Gamepad                 |
| ------ | ------------- | ------------------------ |
| Move   | A/D or ←/→    | D-pad or left stick       |
| Jump   | W or ↑        | A (Xbox) / X (PlayStation) |

**Tab** toggles between Play Mode and Edit Mode. In Edit Mode, click and
drag the player square to reposition it — its position carries over
between modes.

## Testing philosophy

Pure logic (input calculations, mode switching, position resolution) lives
in Phaser-free TypeScript modules and is fully unit tested. Phaser-specific
wiring (scene setup, rendering, tweens, drag events) is verified manually
in the browser rather than unit tested — faking a canvas in a test runner
requires a compiled native dependency (`canvas`), which risks the exact
kind of cross-platform build issues (see the Windows note above) this
project has already run into once.

## CI

Two independent GitHub Actions workflows, each scoped to its own folder so
a backend-only change doesn't trigger a frontend build and vice versa:

- **`.github/workflows/backend-ci.yml`** — installs dependencies, runs
  `ruff check`, runs `pytest`.
- **`.github/workflows/frontend-ci.yml`** — installs dependencies, runs
  `svelte-check`, runs `npm run test`, runs `npm run build`.

Both run on every push and pull request to `main`.

## Roadmap

### Phase 1 — Foundations ✅ Complete

- [x] Backend skeleton (Flask app factory, config, Flask-SQLAlchemy, TDD workflow)
- [x] Frontend scaffolded (SvelteKit), connected to backend via CORS
- [x] CI for both backend (pytest + ruff) and frontend (svelte-check + Vitest + build)
- [x] Game engine integrated: Phaser 4, basic platforming scene, WASD/arrow/gamepad input
- [x] Deployed: Render (backend + static frontend) + Neon (Postgres), CI-gated auto-deploy
- [x] Portfolio-facing landing page at the backend root

### Phase 2 — Gameplay (in progress)

- [x] Player movement (move, jump; keyboard + gamepad)
- [x] Object architecture decided: interfaces for contracts (`Interactable`,
      `Damageable`, etc.) + lightweight composition for shared behavior,
      built on Phaser Sprites/Groups — not deep inheritance, not a full ECS
- [ ] Interactable objects (coins, keys)
- [ ] Enemies
- [ ] Mini-enemies
- [ ] Bosses

### Phase 3 — Level creation, accounts & persistence (in progress)

Building a level or playing your own in-progress level requires **no
account** — it's entirely client-side (in-memory + localStorage) until the
moment someone wants to save or share. An account is only required to
persist/publish content; playing anyone's *published* level is always
public, no account needed.

**Accounts (prerequisite for everything below):**
- [ ] `User` auth: JWT-based (not session cookies — the frontend and
      backend live on different Render subdomains, which browsers treat as
      cross-site; Safari/Firefox block third-party cookies by default, so
      tokens via `Authorization` header are the reliable choice here)
- [ ] Password hashing via Werkzeug's built-in `generate_password_hash`
- [ ] `POST /auth/register`, `POST /auth/login`, `GET /auth/me`
- [ ] Rate limiting on login (`flask-limiter`)

**Screens** — the real unit of authored content, owned by a user, savable
and playable standalone, and reusable across levels other than the one it
was created in ("borrowing," open to anyone, no approval step):
- [ ] `Screen` model + save/load
- [ ] Screen editor UI (placing platforms/objects — the actual IDE; the
      Play/Edit mode toggle already built is the groundwork for this)

**Levels** — an ordered composition of screens (a mix of your own and
borrowed ones), connected via a join model (`LevelScreen`) that carries
per-placement data (position in sequence, entry/exit connections, goals) so
the same screen can behave differently depending on which level it's
placed in:
- [ ] `Level` model + `LevelScreen` join
- [ ] Screen-to-screen navigation/connections, goals/gates
- [ ] Publish workflow: a level must have a set goal and be finishable.
      The creator must clear their own level before it can publish — this
      is auto-verified (not manually reviewed) by capturing an input-log
      trace (`PlaythroughRecording`: just the input sequence, not video) on
      the clear. Failed attempts only increment a lightweight
      `attempt_count` counter — no full trace captured on failures.
- [ ] Level lifecycle: `draft` → `published`, tracking `attempt_count` and
      `clear_count` (clear rate computed on read)

### Phase 4 — Moderation & community (not started)

- [ ] Content moderation for screens/level names (Flask has no built-in
      admin panel like Django, so this needs to be hand-built)
- [ ] Comments and ratings on published levels
- [ ] User-submitted reports (`Report` model) feeding an admin review queue
- [ ] System-flagged review: a level with climbing `attempt_count` but a
      clear rate that stays near zero gets surfaced for admin review
- [ ] Admin playback of a level's `PlaythroughRecording` input logs to
      assess whether a clear is legitimate
- [ ] `tool_assisted` classification: if an admin determines a published
      level isn't legitimately clearable as submitted, it stays live but
      gets re-labeled rather than removed (same idea as a TAS label in
      speedrunning — honest disclosure, not deletion)

### Data model (target shape)

```
User
 ├── owns many → Screen (standalone: saveable, playable, borrowable)
 ├── owns many → Level (draft → published)
 └── has many → Comment, Rating, Report

Level ──(via LevelScreen: position, connections, goals)──> Screen
Level ──has many──> PlaythroughRecording (captured on clears only)
Level ──has many──> Comment, Rating, Report
```