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

- **Phase 1 — Foundations** (in progress): backend/frontend connectivity,
  TDD workflow, CI/CD, game engine integration. Remaining: Render
  deployment.
- **Phase 2 — Gameplay**: player movement (done), enemies, bosses.
- **Phase 3 — Level creation IDE**: screen-by-screen editing, screen-to-
  screen navigation, goals/gates.
- **Phase 4 — Moderation**: content review for screens and level names.