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
- Drag the player character to reposition it (snaps to the grid)
- Click-and-drag empty grid space to place a platform — drag horizontally
  or vertically, whichever way you move first
- Click a platform to select it (highlights the whole thing, not just one
  tile), click again to deselect
- Placing or restyling a platform next to another of the **same style**
  automatically connects them into one platform; a **different style**
  stays separate even when touching — see
  [Platform grouping](#platform-grouping)
- A style picker (toolbar by default, or a radial menu — toggle between
  them top-right) appears only while a platform is selected
- Tools toolbar (top-center): **Select** (default) and **Eraser** — click
  or click-drag tiles to remove them while the eraser is active; each
  tool has its own custom cursor
- `[?] Instructions` opens a quick reference modal
- Tab, or the on-screen ⇄ button on mobile, switches to Play mode

**Play mode:**

| Action | Keyboard      | Gamepad                    | Touch (mobile)         |
| ------ | ------------- | --------------------------- | ------------------------ |
| Move   | A/D or ←/→    | D-pad or left stick          | On-screen left/right buttons |
| Jump   | W or ↑        | A (Xbox) / X (PlayStation)   | On-screen jump button     |
| Duck   | S or ↓        | —                            | —                          |

Platforms built in the Editor become real, solid ground in Play mode.
There's no ground unless you've placed some — walk/fall off the edge of
what you've built (or off nothing at all) and falling far enough below
the screen automatically sends you back to the Editor.

**Player feel:**
- Horizontal movement **accelerates and decelerates** rather than
  snapping instantly to full speed — tap for a quick nudge, hold for a
  build-up to top speed (P-speed-style, tunable via `ACCELERATION` in
  `PlatformerScene.ts`)
- **Variable jump height** — tap jump for a short hop, hold it for the
  full arc; releasing early cuts the jump short (tunable via
  `JUMP_CUT_MULTIPLIER`)
- The player is a real animated character (Kenney sprite): idle, walk
  cycle, duck, and jump poses, all driven by one pose-priority state
  machine (`getPlayerPose` in `movement.ts`) so adding a new pose later
  is a one-line addition, not a new branch of scene code
- **Character color is randomized once per session** (5 available: beige,
  green, pink, purple, yellow) — picked the first time a scene loads and
  kept consistent across Play/Edit toggles for the rest of the session

**Mobile:** the game is landscape-only — a rotate prompt blocks portrait
orientation. On-screen touch controls only appear on touch-capable
devices; desktop mouse/keyboard users won't see them.

### Platform grouping

Each platform has an explicit identity (`groupId`), assigned per
click-and-drag placement gesture — not inferred from which tiles happen
to be touching:

- Placing tiles in one continuous drag: each new tile checks its
  immediate neighbor along the drag's axis; if a same-style neighbor
  exists, the new tile joins that platform.
- A **new, separate** platform touching an existing one of a
  **different** style: stays its own group, with its own end caps, even
  when touching.
- A **new, separate** platform touching an existing one of the **same**
  style: joins that platform's group directly.
- A single tile bridging two existing same-style platforms (filling a
  gap between them) merges both into one.
- **Restyling** a selected platform to match a touching different
  platform merges them too — this check happens retroactively, not just
  at placement time.
- Horizontal and vertical platforms **never merge with each other**,
  even when touching and same-styled — each runs one way only. A visual
  junction piece for where they meet was tried and removed (see TODOs
  below); they currently just don't visually connect.

## Testing philosophy

Pure logic (input calculations, mode switching, position resolution, grid
snapping, auto-tiling, platform grouping/merging, player pose priority,
acceleration/jump physics, color selection) lives in Phaser-free
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

### Phase 2 — Gameplay (real progress now)

- [x] Player movement (keyboard, gamepad, and touch)
- [x] Object architecture decided: interfaces for contracts + lightweight
      composition for shared behavior, built on Phaser Sprites/Groups
- [x] Real animated player sprite (Kenney character), replacing the
      placeholder square
- [x] Pose state machine — idle/walk/duck/jump, priority-ordered, driven
      by one pure decision function + a data table (not scattered
      conditional branches)
- [x] Gradual acceleration/deceleration ("P-speed"-style build-up)
      instead of instant velocity snapping
- [x] Variable jump height ("jump cut") — tap for a short hop, hold for
      the full arc
- [x] Player character color randomized per session (5 Kenney colors)
- [ ] **Manual character selection** — let the user pick their preferred
      color instead of leaving it to chance
- [ ] **Character-specific abilities (SMB2-style)** — explore giving each
      color a distinct gameplay trait (higher jump, brief float, faster
      movement, etc.) instead of being purely cosmetic. A bigger,
      exploratory idea — would mean threading a "which character"
      parameter through the currently color-agnostic shared movement
      functions (`getPlayerPose`, `getAcceleratedVelocity`,
      `getJumpVelocity`/`getJumpCutVelocity`), worth designing
      deliberately before starting
- [ ] Interactable objects (coins, keys)
- [ ] Enemies, mini-enemies, bosses
- [ ] Climb animation exists in the sprite atlas but isn't wired to
      anything yet (no climbable surfaces)

### Phase 3 — Level creation, accounts & persistence (in progress)

Building a level or playing your own in-progress level requires **no
account** — it's entirely client-side (Phaser's registry + in-memory)
until the moment someone wants to save or share.

**Level Editor:**
- [x] Level Editor is the default scene; Play mode is entered from it
- [x] Click-and-drag platform placement, both X-axis and Y-axis (axis
      locks to whichever direction the drag moves first)
- [x] Auto-tiling: single/end-cap/middle frames computed per platform,
      six selectable styles (grass, dirt, sand, snow, stone, purple)
- [x] Explicit platform grouping (`groupId`), orientation-aware so
      horizontal and vertical platforms never accidentally merge into an
      L-shape
- [x] Click a tile to select its whole platform; click again to deselect
- [x] Restyling a selected platform retroactively merges it with a newly
      matching adjacent platform
- [x] Style picker UI: toolbar (default) and a radial menu, switchable
      via a top-right toggle; either UI only appears while a platform is
      selected
- [x] Eraser tool — click or click-drag to remove tiles (player excluded
      by construction), with its own custom cursor
- [x] Tools toolbar (top-center), extensible for future tools beyond
      Select/Eraser
- [x] Custom cursors per tool
- [x] Instructions modal (replacing an earlier inline-panel version)
- [x] Drag-to-reposition the player, snapped to the grid
- [x] Placed platforms persist across Play/Edit toggles and become real,
      solid ground in Play mode (with collision)
- [x] Falling off-screen in Play mode (no ground, or walked off an edge)
      automatically reverts to the Editor
- [x] Mobile support: touch controls, landscape-only enforcement,
      scale-to-fit canvas
- [ ] **Vertical/horizontal junction piece** — a horizontal and vertical
      platform touching currently render with no visual connection
      between them. A junction was built and tried (a horizontal tile
      switching to a connector frame, the touching vertical tile
      switching to a middle piece) but removed - the available tile art
      didn't look right for it. Revisit if better-suited assets turn up.
- [ ] **Placement rules** beyond "no duplicate stacking" — e.g. what's
      allowed to be adjacent to what — are still undecided.
- [ ] **UI mode preference doesn't survive a full page reload** — the
      toolbar/radial choice is stored in Phaser's registry, so it
      persists across Play/Edit toggles within a session, but resets to
      the toolbar default on refresh. Would need `localStorage` to
      persist across sessions.
- [ ] **Instructions as a dedicated page** — the modal works for now, but
      if the content list keeps growing (more tools, more mechanics),
      it'd outgrow a Phaser-rendered modal.
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

## Future Considerations (way down the line)

Not part of the active technical roadmap — noted for later, pricing
model only, details TBD:

- [ ] **Website access** — monthly subscription all dlc updates included
- [ ] **Standalone Steam version** — flat fee new content blocked by paywall
- [ ] **DLC** — free on the website, paid on the Steam standalone
      version. Exact mechanics (what counts as DLC, how it's gated
      between the two versions, etc.) still to be figured out.

## Housekeeping

- [ ] npm version differs between the two dev machines this project is
      built on (Windows and macOS) — not urgent, but worth syncing to
      keep `package-lock.json` diffs from being noise.