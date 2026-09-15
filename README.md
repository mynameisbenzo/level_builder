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
│   ├── static/assets/
│   │   ├── kenney/               # Kenney platformer pack (sprites, tiles, sfx)
│   │   └── icons/                 # Eraser + select-tool cursor icons
│   └── src/
│       ├── lib/
│       │   ├── api.ts                    # backend API client
│       │   └── game/                     # Phaser scenes + supporting logic:
│       │       ├── PlatformerScene.ts      # Play mode
│       │       ├── LevelEditorScene.ts     # Edit mode (default scene)
│       │       ├── movement.ts             # pure input/physics/pose logic (tested)
│       │       ├── gridSnap.ts             # grid snapping + drag fill (tested)
│       │       ├── groundTiling.ts         # auto-tiling + platform run logic (tested)
│       │       ├── placedObjects.ts        # placed-tile data, selection, group merge (tested)
│       │       ├── characterSwapObjects.ts # floating swap-object logic (tested)
│       │       ├── winConditions.ts        # door win-condition logic (tested)
│       │       ├── keys.ts                 # key entity logic (tested)
│       │       ├── camera.ts               # world/viewport sizing, quadrant + edge-scroll math (tested)
│       │       ├── geometry.ts             # shared distance-check utility (tested)
│       │       ├── sounds.ts               # SFX loading, mute/volume settings (tested)
│       │       ├── tools.ts                # editor tool constants
│       │       ├── atlases.ts              # raw texture/atlas/icon loading
│       │       ├── playerColor.ts          # player color selection + frame mappings (tested)
│       │       ├── playerPose.ts           # pose config, hitbox bounds, walk animation
│       │       ├── playerState.ts          # position carryover (tested)
│       │       ├── mode.ts                 # Play/Edit mode logic (tested)
│       │       ├── touchInput.ts           # mobile touch input state (tested)
│       │       ├── currentMode.ts          # Svelte store for active mode
│       │       ├── TouchControls.svelte    # on-screen mobile buttons
│       │       └── LandscapeGuard.svelte   # portrait-mode block screen
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
connected."** (This page is due for a real overhaul - see TODOs.)

## Running the game

With both servers running, visit **`localhost:5173/play`**. It opens
directly into the **Level Editor** (Edit mode is the default scene).

### World size and the camera

A level ("screen") is **1600×1200** — twice the 800×600 viewport in each
dimension, forming a fixed 2×2 grid of four quadrants, each the same size
as the viewport itself. The viewport itself never changes size in either
scene; what changes is how much of the (now larger) world it can show at
once.

**In Play mode**, a level has a per-level **camera mode**, chosen in the
Editor:
- **Follow** (the default) — the camera smoothly tracks the player
  anywhere in the world.
- **Quadrant** — the camera stays fixed until the player crosses into a
  different quadrant, then pans there with a linear (constant-speed, not
  eased) animation.

**In the Editor**, switching between **Edit** and **Navigate** modes (a
toolbar button, top-right, or press **Space**) controls what the mouse
does:
- **Edit** (the default) — clicking places/erases/selects, exactly as
  described below. The camera never moves on its own.
- **Navigate** — the toolbar hides entirely, and hovering near a
  viewport edge pans the camera in that direction, continuously, for as
  long as the pointer stays there. Nothing places, erases, or selects
  while navigating.

These two modes are deliberately mutually exclusive - an earlier design
tried to let the mouse both edit *and* edge-scroll at the same time
(guarding toolbar regions well enough to avoid conflicts), which turned
out to be a genuinely hard problem to get right. Splitting them into
distinct modes removed the conflict entirely instead of trying to
reconcile it spatially.

**Level Editor (Edit mode):**
- Drag the player character to reposition it (snaps to the grid) - this
  sets the level's starting spawn point
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
- Tools toolbar (top-center): **Select**, **Eraser**, **Character
  Swap**, and **Win Condition** — the eraser removes ground tiles,
  swap objects, doors, and keys, by click or click-drag; Character Swap
  and Win Condition each open a row of placeable options below (see
  [Character swapping](#character-swapping) and
  [Win conditions: doors and keys](#win-conditions-doors-and-keys))
- **Starting Character** toolbar button — opens a row of all 5 color
  swatches; picking one sets which character the level begins with in
  Play mode. Defaults to green.
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
what you've built (or off nothing at all) and falling below the bottom
of the *world* (not just the current camera view) automatically sends
you back to the Editor.

**Player feel:**
- Horizontal movement **accelerates and decelerates** rather than
  snapping instantly to full speed — tap for a quick nudge, hold for a
  build-up to top speed (P-speed-style, tunable via `ACCELERATION` in
  `PlatformerScene.ts`)
- **Variable jump height** — tap jump for a short hop, hold it for the
  full arc; releasing early cuts the jump short (tunable via
  `JUMP_CUT_MULTIPLIER`)
- The player is a real animated character (Kenney sprite, sized larger
  than a single grid tile): idle, walk cycle, duck, and jump poses, all
  driven by one pose-priority state machine (`getPlayerPose` in
  `movement.ts`) so adding a new pose later is a one-line addition, not
  a new branch of scene code
- **Sound effects** for jumping, character swapping, collecting a key,
  winning, and falling off a level - all from the bundled Kenney pack
  (win and "falling off" use the closest available stand-ins, since the
  pack has no purpose-made sounds for either). Volume/mute settings
  persist via `localStorage` (deliberately, unlike most other settings
  in this project - see Testing philosophy)
- A **character HUD portrait** (top-left) always reflects the current
  color, with a shrink/overshoot/settle "pop" animation on every swap

**Mobile:** the game is landscape-only — a rotate prompt blocks portrait
orientation. On-screen touch controls only appear on touch-capable
devices; desktop mouse/keyboard users won't see them. **The overall
mobile experience, especially in the Editor, needs real work - see
TODOs.**

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

### Character swapping

Five character colors exist (beige, green, pink, purple, yellow), each
with a full pose set (idle/walk/duck/jump). A level has a **starting
color** (Editor-controlled, defaults to green, set via the toolbar) -
what a fresh Play session always begins as. This is deliberately
separate from the **current color** during an active Play session, which
can change via swap objects but is reset back to the starting color every
time Play mode boots, so a mid-session swap never leaks back into the
Editor or into how the next session begins. The same separation applies
to swap objects themselves: what color an object was *placed* as (the
level's design data, Editor-controlled) is kept distinct from what color
it's *currently holding* after being swapped with during Play (pure
runtime state, discarded when the session ends).

- Touching an object swaps colors both ways: the player becomes the
  object's color, and the object is left holding the player's old one.
  Both the walk animation and the HUD portrait update with a matching
  pop animation.
- **Cooldown**: a just-triggered object can't fire again until the
  player has moved at least 64px away. While on cooldown, it stops
  bobbing, dims to 50% opacity, and shrinks to 50% size - all clear
  visual signals that it's temporarily inactive. Clearing the distance
  triggers a shrink→overshoot→settle "pop" before it resumes normal
  floating.
- **At most 4 objects per level**, enforced by the Editor: every object
  must hold a genuinely distinct color, and the level's current starting
  color is also excluded from placement - so a level can never end up in
  a state where two things share one color, even the moment it first
  loads.
- Placed objects can be removed with the Eraser tool, same as ground
  tiles.

This is a foundational piece for a planned feature (see TODOs) where each
character eventually plays differently, not just looks different.

### Win conditions: doors and keys

The first (and so far only) way to clear a level. Placed via the
**Win Condition** toolbar tool, which shows six options: two door types
and four key colors.

**Doors** are single-tile, two independent types:
- **Plain door** (`door_closed_top` / `door_open_top`) - no prerequisite.
  Walk up and press Up to open it, which immediately clears the level:
  a sound plays, "Level Cleared!" displays briefly, and the game returns
  to the Editor.
- **Key-required door** (`door_closed` / `door_open`) - needs a
  matching-color key collected first. Defaults to requiring **yellow**
  the moment it's placed; click a placed locked door (from any tool
  except the eraser) to open a picker and choose a different color.

**Keys** come in four colors (blue, green, red, yellow) and are
collected by physically **touching** one (real Arcade Physics overlap,
not just proximity) - no button press needed. An uncollected key bobs in
place at wherever it was placed. Once collected, it joins a **trailing
chain** behind the player: each collected key follows a delayed sample
of the player's own recent path (not a fixed offset), so the chain
visibly bends around corners and follows jumps rather than floating at a
static angle. No placement cap - a level can have as many keys of each
color as needed, since (unlike swap objects) there's no uniqueness
invariant to protect; a door just checks whether the matching color has
been collected at all.

Pressing Up near a key-required door that hasn't been unlocked yet does
nothing special - it just jumps normally, rather than silently failing
to open.

## Testing philosophy

Pure logic (input calculations, mode switching, position resolution, grid
snapping, auto-tiling, platform grouping/merging, player pose priority,
acceleration/jump physics, color-to-frame mappings, character-swap and
door/key distance/availability checks, quadrant and edge-scroll math,
sound settings parsing) lives in Phaser-free TypeScript modules and is
fully unit tested. Phaser-specific wiring (scene setup, rendering,
tweens, drag/click events, camera control) is verified manually in the
browser rather than unit tested — faking a canvas in a test runner
requires a compiled native dependency (`canvas`), which risks the exact
kind of cross-platform build issues (see the Windows note above) this
project has already run into once.

Most settings (editor tool, style picker mode, starting player color,
camera mode) are registry-only and reset on a hard page refresh - a
known limitation. Sound volume/mute is the one exception, using
`localStorage` instead, since nobody expects to have to re-mute a game
after every reload. If the other settings ever get fixed to persist too,
`sounds.ts` is a working example to copy.

Several genuinely subtle bugs surfaced and got fixed during development,
worth knowing about since the underlying *patterns* they represent could
recur:
- **Stale runtime state across scene restarts** - Phaser reuses the same
  scene instance every time a scene is re-entered rather than
  constructing a fresh one, so a plain class field's declared default
  only applies once, at true construction. Anything meant to reset each
  session (win state, collected keys, player position history, editor
  interaction mode) has to be explicitly reset at the top of `create()`.
- **Shared object references from the registry** - `registry.get()`
  returns the actual stored object, not a copy. Reading an array of
  placed objects and mutating one of them in place (e.g. a swap
  object's color changing during Play) was silently corrupting the
  level's persisted design data with no explicit `registry.set()` call
  even involved. Fixed by shallow-copying on read wherever runtime code
  might mutate what it read.
- **Screen-space vs. world-space pointer coordinates** - `pointer.x`/
  `pointer.y` are viewport-relative; once the camera could scroll,
  placement logic needed `pointer.worldX`/`pointer.worldY` instead
  (Phaser's built-in world-space equivalents) or clicks would land
  offset by however far the camera had panned.

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

### Phase 1 — Foundations ✅ Complete (landing page due for a revisit - see TODOs)

- [x] Backend skeleton, CI for both backend and frontend, Phaser
      integration, deployment on Render + Neon with a CI-gated pipeline,
      portfolio-facing landing page.

### Phase 2 — Gameplay

- [x] Player movement (keyboard, gamepad, and touch)
- [x] Object architecture decided: interfaces for contracts + lightweight
      composition for shared behavior, built on Phaser Sprites/Groups
- [x] Real animated player sprite (Kenney character), replacing the
      placeholder square, sized larger than a grid tile
- [x] Pose state machine — idle/walk/duck/jump, priority-ordered, driven
      by one pure decision function + a data table
- [x] Gradual acceleration/deceleration ("P-speed"-style build-up)
      instead of instant velocity snapping
- [x] Variable jump height ("jump cut") — tap for a short hop, hold for
      the full arc
- [x] Sound effects for jump, character swap, key collection, winning,
      and falling off a level
- [x] Player starting character, configurable per level (Editor toolbar
      picker, defaults to green)
- [x] Character HUD portrait (top-left), with an animated pop transition
      on every swap
- [x] Character-swap floating objects — full loop: touch to swap,
      cooldown with dim/shrink/frozen-bob visual state, distance-gated
      reactivation with a pop animation, Editor placement and erasure,
      correctly isolated from a level's persisted design data
- [x] **Win condition — first type built.** Doors (plain and
      key-required) plus collectible keys, fully playable end-to-end
      (see [Win conditions](#win-conditions-doors-and-keys)). This was
      the blocker noted for backend work in Phase 3 - now cleared, see
      the Phase 3 note below.
- [x] **World size doubled + full camera system.** Every level is now
      four quadrants (2x2 grid); Play mode has Follow/Quadrant camera
      modes per level; the Editor has a Navigate/Edit interaction-mode
      toggle for panning around the larger world. Not originally on this
      roadmap - added mid-session as a deliberate scope expansion (see
      [World size and the camera](#world-size-and-the-camera)).
- [ ] **Character-specific abilities (SMB2-style)** — explore giving each
      of the five character colors a distinct gameplay trait instead of
      being purely cosmetic (e.g. one jumps higher, one can float
      briefly, one moves faster). A bigger, more exploratory idea than
      the rest of this list — worth prototyping before committing, since
      it touches the shared movement/pose system every character
      currently uses identically (`getPlayerPose`,
      `getAcceleratedVelocity`, `getJumpVelocity`/`getJumpCutVelocity`
      are all color-agnostic right now). The character-swap system above
      is the foundational piece this was building toward.
- [ ] Interactable objects beyond keys (coins, etc.)
- [ ] Enemies, mini-enemies, bosses
- [ ] Climb animation exists in the sprite atlas but isn't wired to
      anything yet (no climbable surfaces)
- [ ] Second win-condition variant: doors requiring a *specific* key
      already works (color-matching is built); a more elaborate
      variant (e.g. requiring multiple keys, or a key that's consumed
      on use) hasn't been explored.

### Phase 3 — Level creation, accounts & persistence

> **Backend work below (Accounts, Screens/Levels) is intentionally on
> hold** until the Screens/Levels scope itself has been revisited - the
> design below is no longer considered settled; a scope change is
> planned before any of it gets built. (The other original blocker - at
> least one win condition existing - is now cleared; see Phase 2 above.)

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
- [x] Eraser tool — click or click-drag to remove ground tiles, swap
      objects, doors, and keys (player excluded by construction), with
      its own custom cursor
- [x] Character Swap and Win Condition placement tools + Starting
      Character picker (see Phase 2 above)
- [x] Tools toolbar (top-center), extensible for future tools
- [x] Custom cursors per tool
- [x] Instructions modal (replacing an earlier inline-panel version)
- [x] Drag-to-reposition the player, snapped to the grid
- [x] Placed platforms persist across Play/Edit toggles and become real,
      solid ground in Play mode (with collision)
- [x] Falling off-screen in Play mode (no ground, or walked off an edge)
      automatically reverts to the Editor
- [x] Mobile support: touch controls, landscape-only enforcement,
      scale-to-fit canvas
- [x] World size doubled to four quadrants, with Editor navigation via a
      Navigate/Edit mode toggle (mouse edge-scroll while navigating)
- [ ] **Toolbar touch-target priority on mobile** — this was flagged
      before the Navigate/Edit split existed; worth re-checking whether
      it's still an issue now that panning and editing are separate
      modes, since the original bug was specifically about a tap
      falling through to tile placement underneath the toolbar.
- [ ] **Vertical/horizontal junction piece** — a horizontal and vertical
      platform touching currently render with no visual connection
      between them. A junction was built and tried (a horizontal tile
      switching to a connector frame, the touching vertical tile
      switching to a middle piece) but removed - the available tile art
      didn't look right for it. Revisit if better-suited assets turn up.
- [ ] **Placement rules** beyond "no duplicate stacking" — e.g. what's
      allowed to be adjacent to what — are still undecided. Currently, a
      door or key can't be placed on top of existing content, but the
      reverse (a ground tile placed on top of an existing door/key)
      isn't prevented.
- [ ] **UI mode preference doesn't survive a full page reload** — the
      toolbar/radial choice is stored in Phaser's registry, so it
      persists across Play/Edit toggles within a session, but resets to
      the toolbar default on refresh. Would need `localStorage` to
      persist across sessions (see Testing philosophy for a working
      example of this pattern).
- [ ] **Instructions as a dedicated page** — the modal works for now, but
      if the content list keeps growing (more tools, more mechanics),
      it'd outgrow a Phaser-rendered modal.
- [ ] **Kill zone** — generalize the current "player falls off-screen →
      revert to Editor" behavior into a proper system for removing/
      resetting *any* sprite (not just the player) that leaves the
      playable bounds, once there are other objects (enemies, etc.) that
      need the same handling.

**Scope reconsideration (before any backend work begins):**
- [ ] **Revisit how levels/screens work.** The Screens & Levels design
      below was settled earlier in the project, but a scope change is
      being considered before building any of it. Treat everything in
      this subsection as provisional, not a spec to implement as-is.

**Accounts (prerequisite for saving/sharing, on hold - see note above):**
- [ ] `User` auth: JWT-based (not session cookies — frontend and backend
      live on different Render subdomains, which browsers treat as
      cross-site; third-party cookies are unreliable there)
- [ ] Password hashing via Werkzeug's built-in `generate_password_hash`
- [ ] `POST /auth/register`, `POST /auth/login`, `GET /auth/me`

**Screens & Levels (provisional - see scope reconsideration note above):**
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

**Marketing site & blog (new scope, not yet built):**
- [ ] Revamped landing page — hero artwork, a prominent "Build Now"
      button that sends visitors straight into the Level Editor,
      replacing the current backend-status-only homepage
- [ ] Blog with text and image posts, for incremental dev updates
- [ ] Blog posting restricted to developers only - some form of
      authorization needed; likely overlaps with the Accounts work
      above even if it ends up being a simple "developer" role rather
      than full user accounts

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

- [ ] **Website access** — monthly subscription, all DLC updates
      included
- [ ] **Standalone Steam version** — flat fee, new content blocked by a
      paywall
- [ ] **DLC** — free on the website, paid on the Steam standalone
      version. Exact mechanics (what counts as DLC, how it's gated
      between the two versions, etc.) still to be figured out.

## Housekeeping

- [ ] npm version differs between the two dev machines this project is
      built on (Windows and macOS) — not urgent, but worth syncing to
      keep `package-lock.json` diffs from being noise.