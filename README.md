# Pixel Maker

An in-browser, Mario Maker–style platformer where levels are built screen by
screen — and different screens in the same level can be built by different
people. Players share and play each other's levels; level creation happens
one screen at a time, with screens later connected together into a full
level.

See [PROJECT.md](PROJECT.md) for how the game itself works (controls, the
world/camera system, platform grouping, character swapping, win
conditions, accounts, level lifecycle, and the public playthrough
experience) and the design decisions behind it. See
[CLOSED_TASKS.md](CLOSED_TASKS.md) and [OPEN_TASKS.md](OPEN_TASKS.md) for
what's been built and what's left, phase by phase.

## Tech stack

| Layer      | Tech                                             |
| ---------- | ------------------------------------------------- |
| Frontend   | SvelteKit + TypeScript + Phaser 4                  |
| Backend    | Flask + Flask-SQLAlchemy + Flask-Migrate           |
| Database   | PostgreSQL via Neon (SQLite in-memory for tests)   |
| Assets     | Kenney "New Platformer Pack" (CC0)                 |
| Testing    | pytest (backend), Vitest (frontend)                |
| CI/CD      | GitHub Actions, deployed on Render (CI-gated)      |

## Prerequisites

- **Python 3.10.13** — pinned via [pyenv](https://github.com/pyenv/pyenv) (`.python-version` at the repo root). Newer Python versions can hit missing prebuilt wheels for `psycopg`; 3.10.13 is the tested baseline.
- **Node.js 20+** and npm.
- **PostgreSQL** — running locally, or a `DATABASE_URL` pointing at one (e.g. [Neon](https://neon.com), free tier). Not required to run the test suite (tests use in-memory SQLite).
- **Git**

> **Windows note:** this project uses `psycopg[binary]` (not `psycopg2-binary`) specifically to avoid native-compile issues on Windows. Keep the pinned version in `requirements.txt`.

## Project structure
level-builder/
├── backend/ # Flask API
│ ├── app/
│ │ ├── main.py # create_app() factory, landing page route
│ │ ├── config.py # Testing/Development/Production config
│ │ ├── extensions.py # shared Flask-SQLAlchemy instance
│ │ ├── templates/ # Jinja - portfolio landing page
│ │ └── models/ # SQLAlchemy models
│ ├── tests/
│ ├── requirements.txt
│ └── requirements-dev.txt
├── frontend/ # SvelteKit app
│ ├── static/assets/
│ │ ├── kenney/ # Kenney platformer pack (sprites, tiles, sfx)
│ │ └── icons/ # Eraser + select-tool cursor icons
│ └── src/
│ ├── lib/
│ │ ├── api.ts # backend API client
│ │ └── game/ # Phaser scenes + supporting logic:
│ │ ├── PlatformerScene.ts # Play mode
│ │ ├── LevelEditorScene.ts # Edit mode (default scene)
│ │ ├── movement.ts # pure input/physics/pose logic (tested)
│ │ ├── gridSnap.ts # grid snapping + drag fill (tested)
│ │ ├── groundTiling.ts # auto-tiling + platform run logic (tested)
│ │ ├── placedObjects.ts # placed-tile data, selection, group merge (tested)
│ │ ├── characterSwapObjects.ts # floating swap-object logic (tested)
│ │ ├── winConditions.ts # door win-condition logic (tested)
│ │ ├── keys.ts # key entity logic (tested)
│ │ ├── camera.ts # world/viewport sizing, quadrant + edge-scroll math (tested)
│ │ ├── geometry.ts # shared distance-check utility (tested)
│ │ ├── sounds.ts # SFX loading, mute/volume settings (tested)
│ │ ├── tools.ts # editor tool constants
│ │ ├── atlases.ts # raw texture/atlas/icon loading
│ │ ├── playerColor.ts # player color selection + frame mappings (tested)
│ │ ├── playerPose.ts # pose config, hitbox bounds, walk animation
│ │ ├── playerState.ts # position carryover (tested)
│ │ ├── mode.ts # Play/Edit mode logic (tested)
│ │ ├── touchInput.ts # mobile touch input state (tested)
│ │ ├── currentMode.ts # Svelte store for active mode
│ │ ├── TouchControls.svelte # on-screen mobile buttons
│ │ └── LandscapeGuard.svelte # portrait-mode block screen
│ └── routes/
│ └── play/ # the game itself
├── .github/workflows/ # CI: backend-ci.yml, frontend-ci.yml
├── render.yaml # Render Blueprint (backend + frontend)
└── .python-version # pins Python 3.10.13 via pyenv

## Backend setup

```bash
cd backend
pyenv local 3.10.13          # if not already picked up from the repo root
python3 -m venv venv
source venv/bin/activate     # Windows: venv\Scripts\activate
pip install --upgrade pip
pip install -r requirements-dev.txt
cp .env.example .env         # adjust values if your local setup differs
```

`.env` is gitignored and loaded automatically (via `python-dotenv`) -
`.env.example` documents every variable the app actually reads, with
safe non-secret defaults. Real secrets (once any exist - Twitch OAuth,
a magic-link email provider) go here too, locally, and are never
committed.

Run the test suite (uses in-memory SQLite, no Postgres required, and
doesn't read `.env` - `TestingConfig` hardcodes its own database URL):

```bash
pytest -v
ruff check .
```

Run the dev server (requires a local Postgres - see below for macOS
setup without Homebrew if needed):

```bash
flask --app "app.main:create_app('development')" run --port 5000
```

Visit `http://localhost:5000/` for the portfolio landing page, or
`curl http://localhost:5000/health` → `{"status":"ok"}`.

### Database schema changes

The schema is managed via [Flask-Migrate](https://flask-migrate.readthedocs.io)
(Alembic) - `db.create_all()` is no longer how a real Postgres database
gets its tables. The one exception is `pytest`, unaffected by any of
this: `TestingConfig`'s throwaway in-memory SQLite database is rebuilt
from scratch on every test run regardless, so migrating it would add
nothing.

For an actual Postgres database, which of these you need depends on
whether it already has these tables:

- **A brand-new, empty database** (a fresh clone, or setting this
  project up for the first time):
```bash
  flask --app "app.main:create_app('development')" db upgrade
```
  builds the full schema from the migration history in `migrations/`.

- **A database that already has these tables** (any local dev database
  set up before migrations existed) needs exactly one, one-time
  command instead:
```bash
  flask --app "app.main:create_app('development')" db stamp head
```
  This tells Alembic "the schema is already at this point, just start
  tracking from here" - it records that fact without touching any
  actual tables. Running `db upgrade` against a database that already
  has these tables instead would fail outright the moment it hit the
  first `CREATE TABLE` that already exists as a table - not
  destructive, just an error, but the wrong command for this case.

Going forward, a schema change means: edit the model, then
```bash
flask --app "app.main:create_app('development')" db migrate -m "what changed"
```
to generate a new migration, **review the generated file before
trusting it** - autogenerate is good but not infallible; this
project's very first generated migration needed one hand-fix, a
missing `Text` import its own JSONB-column renderer left out - then
```bash
flask --app "app.main:create_app('development')" db upgrade
```
to apply it. This replaces any ad hoc `db.create_all()`-based
workflow, including a personal shell alias built around one, if you
had one - that now bypasses migration tracking anymore, and shouldn't
be used for schema changes anymore.

**Local Postgres, without Homebrew (e.g. on an older macOS Homebrew
won't run on):** [Postgres.app](https://postgresapp.com) is a
standalone Mac app, no package manager needed - check their [legacy
downloads page](https://postgresapp.com/downloads_legacy.html) if on
macOS older than 11. After installing and clicking "Initialize," create
the project's database: `createdb level_builder_dev`. If you hit `role
"<your-username>" does not exist` even after initializing, connect as
the default superuser instead (`psql -U postgres postgres`) and run
`CREATE ROLE <your-username> WITH LOGIN SUPERUSER;` - this is a known
Postgres.app scenario where the default-role creation step fails
independently of the server itself starting fine.

**On admin/moderation tooling:** Flask-Admin was tried and deliberately
removed - a generic field-editor bypasses the actual moderation rules
already designed (recording a reason, flagging direct remixes for
review, writing an audit trail via `LevelModerationAction`), so it
would let a moderator silently skip all of that by editing a row
directly. Real moderation needs purpose-built endpoints that encode
those rules (see [OPEN_TASKS.md](OPEN_TASKS.md)), not raw CRUD - with a
UI, admin panel or otherwise, layered on top of *those* once they
exist, not the other way around. For now, inspecting local data
directly via `psql` is the practical stand-in.

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
connected."** (This page is due for a real overhaul - see
[OPEN_TASKS.md](OPEN_TASKS.md).)

## Running the game

With both servers running, visit **`localhost:5173/play`**. It opens
directly into the **Level Editor** (Edit mode is the default scene).

See [PROJECT.md](PROJECT.md#running-the-game) for controls, the
world/camera system, and how the core mechanics (platform grouping,
character swapping, win conditions) actually work.

## CI

Two independent GitHub Actions workflows, each scoped to its own folder so
a backend-only change doesn't trigger a frontend build and vice versa:

- **`.github/workflows/backend-ci.yml`** — installs dependencies, runs
  `ruff check`, runs `pytest`.
- **`.github/workflows/frontend-ci.yml`** — installs dependencies, runs
  `svelte-check`, runs `npm run test`, runs `npm run build`.

Both run on every push and pull request to `main`. Render's
`autoDeployTrigger: checksPass` means deployment only happens once these
checks pass — a failing test or lint blocks the deploy automatically, no
manual gating required.

### Preview Environments (mobile testing workflow)

`render.yaml` has `previews.generation: automatic` set on both services,
so **every pull request gets its own live, HTTPS-hosted deployment**,
separate from `main` and from each other. This exists specifically
because local dev servers (and even a locally-served production build)
cannot be trusted for testing touch/drag interactions on a real phone —
see PROJECT.md's [Testing philosophy](PROJECT.md#testing-philosophy)
section for what that cost us to discover.

Workflow for testing an in-progress branch on an actual phone:
1. Push the branch, open a PR into `main` (draft is fine — nothing about
   opening a PR deploys to or affects `main` itself).
2. Find the preview URL either on the PR's status checks (look for a
   `render/...` entry with a "View deployment" link) or in the Render
   dashboard, as a separate service entry named after the branch/PR.
3. Open that URL on the actual device. Further commits pushed to the
   same branch auto-update the same preview URL — no need to open a new
   PR each time.

Preview services are billed like regular Render services (prorated by
the second), though this stays within the free tier for a project this
size.