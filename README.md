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
- **Restyling a selected platform to match a directly touching different
  platform merges them** into one, even after the fact
- A style picker (toolbar by default, or a radial menu — see below)
  appears only while a platform is selected, letting you change its
  appearance
- `[?] Hide/Show Instructions` button, top-left, toggles the on-screen
  help text
- `Style UI: Toolbar` / `Style UI: Radial` button, top-right, switches
  between the two style-picker UIs. The choice persists across Play/Edit
  toggles for the session (not yet across a full page reload)
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
- **Restyling a selected platform to match a touching different
  platform** merges them too — this check happens retroactively, not
  just at placement time.

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
- [x] Restyling a selected platform retroactively merges it with a newly
      matching adjacent platform, not just at placement time
- [x] Style picker UI: toolbar (default) and a radial menu, switchable
      via a top-right toggle; either UI only appears while a platform is
      selected
- [x] Drag-to-reposition the player, snapped to the grid
- [x] Placed platforms persist across Play/Edit toggles and become real,
      solid ground in Play mode (with collision)
- [x] Falling off-screen in Play mode (no ground, or walked off an edge)
      automatically reverts to the Editor
- [x] Mobile support: touch controls, landscape-only enforcement,
      scale-to-fit canvas
- [x] Toggleable on-screen instructions
- [ ] **Eraser tool** — click the eraser option and drag across tiles to
      remove them (excluding the player). There's still no delete
      interaction at all in the Editor; `removePosition` exists in code
      but isn't wired to any UI yet.
- [ ] **Y-axis / multi-row placement** — drag-placement is currently
      X-axis-only (a single row per drag); no way yet to build vertical
      structures or start a platform on an arbitrary row via a vertical
      drag.
- [ ] **Placement rules** beyond "no stacking duplicates" — e.g. what's
      allowed to be adjacent to what — are still undecided.
- [ ] **UI mode preference doesn't survive a full page reload** — the
      toolbar/radial choice is stored in Phaser's registry, so it
      persists across Play/Edit toggles within a session, but resets to
      the toolbar default on refresh. Would need `localStorage` to
      persist across sessions.
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

## Housekeeping

- [ ] npm version differs between the two dev machines this project is
      built on (Windows and macOS) — not urgent, but worth syncing to
      keep `package-lock.json` diffs from being noise.