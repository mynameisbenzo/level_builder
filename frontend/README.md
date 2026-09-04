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

```
level-builder/
├── backend/                    # Flask API
│   ├── app/
│   │   ├── main.py              # create_app() factory, landing page route
│   │   ├── config.py            # Testing/Development/Production config
│   │   ├── extensions.py        # shared Flask-SQLAlchemy instance
│   │   ├── templates/           # Jinja - portfolio landing page
│   │   └── models/               # SQLAlchemy models
│   ├── tests/
│   ├── requirements.txt
│   └── requirements-dev.txt
├── frontend/                   # SvelteKit app
│   ├── static/assets/kenney/    # Kenney platformer pack (sprites, tiles, sfx)
│   └── src/
│       ├── lib/
│       │   ├── api.ts                  # backend API client
│       │   └── game/                   # Phaser scenes + supporting logic:
│       │       ├── PlatformerScene.ts    # Play mode
│       │       ├── LevelEditorScene.ts   # Edit mode (default scene)
│       │       ├── movement.ts           # pure input/physics logic (tested)
│       │       ├── gridSnap.ts           # grid snapping (tested)
│       │       ├── groundTiling.ts       # auto-tiling + platform run logic (tested)
│       │       ├── placedObjects.ts      # placed-tile data, selection, group merge (tested)
│       │       ├── playerState.ts        # position carryover (tested)
│       │       ├── mode.ts               # Play/Edit mode logic (tested)
│       │       ├── touchInput.ts         # mobile touch input state (tested)
│       │       ├── currentMode.ts        # Svelte store for active mode
│       │       ├── textures.ts           # texture/atlas loading (Phaser wiring)
│       │       ├── TouchControls.svelte  # on-screen mobile buttons
│       │       └── LandscapeGuard.svelte # portrait-mode block screen
│       └── routes/
│           └── play/             # the game itself
├── .github/workflows/          # CI: backend-ci.yml, frontend-ci.yml
├── render.yaml                 # Render Blueprint (backend + frontend)
└── .python-version              # pins Python 3.10.13 via pyenv
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

Visit `http://localhost:5000/` for the portfolio landing page, or
`curl http://localhost:5000/health` → `{"status":"ok"}`.

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

With both servers running, visit **`localhost:5173/play`**. It opens
directly into the **Level Editor** (Edit mode is the default scene).

**Level Editor (Edit mode):**
- Drag the player square to reposition it (snaps to the grid)
- Click-and-drag empty grid space (along a single row) to place a platform
  of ground tiles
- Click any tile to select its **whole platform** (highlighted with a gold
  border), click again to deselect
- **Placing a new platform right next to an existing one of the same
  style automatically connects them into one platform.** A different
  style stays visually and functionally separate, even when touching —
  see [Platform grouping](#platform-grouping) below
- The style palette (bottom of screen) sets the style of the selected
  platform, or the default style for new platforms if nothing is selected
- `[?] Hide/Show Instructions` button, top-left, toggles the on-screen
  help text
- Tab, or the on-screen ⇄ button on mobile, switches to Play mode

**Play mode:**

| Action | Keyboard      | Gamepad                    | Touch (mobile)         |
| ------ | ------------- | --------------------------- | ------------------------ |
| Move   | A/D or ←/→    | D-pad or left stick          | On-screen left/right buttons |
| Jump   | W or ↑        | A (Xbox) / X (PlayStation)   | On-screen jump button     |

Platforms built in the Editor become real, solid ground in Play mode.
There's no ground unless you've placed some — walk/fall off the edge of
what you've built (or off nothing at all) and falling far enough below
the screen automatically sends you back to the Editor.

**Mobile:** the game is landscape-only — a rotate prompt blocks portrait
orientation. On-screen touch controls only appear on touch-capable
devices; desktop mouse/keyboard users won't see them.

### Platform grouping

Each platform has an explicit identity (`groupId`), assigned per
click-and-drag placement action — not inferred from which tiles happen to
be touching. This is what makes selection, restyling, and the visual
end-caps behave like separate physical objects rather than one blob:

- Placing tiles in one continuous drag: each new tile checks its
  immediate left/right neighbor; if a same-style neighbor exists, the new
  tile joins that platform. This is how a whole drag ends up as one group
  without any special "gesture" tracking.
- Placing a **new, separate** platform touching an **existing** one of a
  **different** style: no matching neighbor, so it starts its own group —
  visually distinct end-caps at the seam, independently selectable.
- Placing a **new, separate** platform touching an **existing** one of
  the **same** style: it joins that platform's group directly.
- Placing a single tile that bridges two existing same-style platforms
  (filling a one-cell gap between them) merges both into one group.

## Testing philosophy

Pure logic (input calculations, mode switching, position resolution, grid
snapping, auto-tiling, platform grouping/merging) lives in Phaser-free
TypeScript modules and is fully unit tested. Phaser-specific wiring (scene
setup, rendering, tweens, drag/click events) is verified manually in the
browser rather than unit tested — faking a canvas in a test runner
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

Both run on every push and pull request to `main`. Render's
`autoDeployTrigger: checksPass` means deployment only happens once these
checks pass — a failing test or lint blocks the deploy automatically, no
manual gating required.

## Roadmap

### Phase 1 — Foundations ✅ Complete

- [x] Backend skeleton, CI for both backend and frontend, Phaser
      integration, deployment on Render + Neon with a CI-gated pipeline,
      portfolio-facing landing page.

### Phase 2 — Gameplay (in progress)

- [x] Player movement (keyboard, gamepad, and touch)
- [x] Object architecture decided: interfaces for contracts + lightweight
      composition for shared behavior, built on Phaser Sprites/Groups
- [ ] Interactable objects (coins, keys)
- [ ] Enemies, mini-enemies, bosses

### Phase 3 — Level creation, accounts & persistence (in progress)

Building a level or playing your own in-progress level requires **no
account** — it's entirely client-side (Phaser's registry + in-memory)
until the moment someone wants to save or share.

**Level Editor:**
- [x] Level Editor is the default scene; Play mode is entered from it
- [x] Click-and-drag platform placement (single row / X-axis)
- [x] Auto-tiling: single/left/center/right frames computed per platform,
      six selectable styles (grass, dirt, sand, snow, stone, purple)
- [x] Explicit platform grouping (`groupId`), assigned per placement
      gesture, with same-style neighbor joining and bridge-merging —
      physical adjacency alone no longer means "same platform"
- [x] Click a tile to select its whole platform; click again to deselect
- [x] Style palette UI (toolbar): restyles the selected platform, or sets
      the default for new placements
- [x] Drag-to-reposition the player, snapped to the grid
- [x] Placed platforms persist across Play/Edit toggles and become real,
      solid ground in Play mode (with collision)
- [x] Falling off-screen in Play mode (no ground, or walked off an edge)
      automatically reverts to the Editor
- [x] Mobile support: touch controls, landscape-only enforcement,
      scale-to-fit canvas
- [x] Toggleable on-screen instructions
- [ ] **Restyling doesn't re-check for merges** — if a selected platform
      is restyled to match a directly touching different platform, they
      currently stay separate groups (with a redundant seam) instead of
      merging. Placement-time merging works; style-change-time merging
      does not yet.
- [ ] **Eraser tool** — click the eraser option and drag across tiles to
      remove them (excluding the player). Currently there's no delete
      interaction at all in the Editor.
- [ ] **UI preference: toolbar vs. radial menu** — let the user choose
      which style-selection UI they prefer, defaulting to the toolbar. A
      working radial-menu prototype exists (built and compared against
      four other UI approaches — cycling arrows, dropdown, modal, radial —
      before the toolbar was chosen as default), but isn't wired in as a
      togglable option yet.
- [ ] **Placement rules** beyond "no stacking duplicates" — e.g. what's
      allowed to be adjacent to what — are still undecided.
- [ ] **Kill zone** — generalize the current "player falls off-screen →
      revert to Editor" behavior into a proper system for removing/
      resetting *any* sprite (not just the player) that leaves the
      playable bounds, once there are other objects (enemies, etc.) that
      need the same handling.

**Accounts (prerequisite for saving/sharing, not yet built):**
- [ ] `User` auth: JWT-based (not session cookies — frontend and backend
      live on different Render subdomains, which browsers treat as
      cross-site; third-party cookies are unreliable there)
- [ ] Password hashing via Werkzeug's built-in `generate_password_hash`
- [ ] `POST /auth/register`, `POST /auth/login`, `GET /auth/me`

**Screens & Levels (design settled, not yet built):**
- [ ] `Screen` model — ownable, savable, playable standalone, and
      reusable ("borrowable") across other users' levels
- [ ] `Level` model + `LevelScreen` join — an ordered composition of
      screens, carrying per-placement connections/goals
- [ ] Publish workflow: a level must have a set goal and be finishable;
      the creator must clear it themselves before it can publish, which
      is auto-verified by capturing an input-log trace
      (`PlaythroughRecording`) on the clear — not a full replay video,
      just the input sequence
- [ ] Level lifecycle: `draft` → `published`, tracking `attempt_count`
      and `clear_count`

### Phase 4 — Moderation & community (not started)

- [ ] Content moderation for screens/level names (Flask has no built-in
      admin panel, so this needs to be hand-built)
- [ ] Comments and ratings on published levels
- [ ] User-submitted reports feeding an admin review queue
- [ ] System-flagged review: a level with climbing attempts but a near-
      zero clear rate gets surfaced for admin review
- [ ] `tool_assisted` classification for levels an admin determines
      aren't legitimately clearable as submitted (stays live, gets
      relabeled — like a TAS tag in speedrunning, not deletion)
