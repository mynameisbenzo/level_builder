# Pixel Maker

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
those rules (see Phase 3/4 below), not raw CRUD - with a UI, admin
panel or otherwise, layered on top of *those* once they exist, not the
other way around. For now, inspecting local data directly via `psql`
is the practical stand-in.

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
- **No cap, and no color-uniqueness requirement** - any color can be
  placed any number of times, including a duplicate of the level's
  current starting color. This was a deliberate restriction earlier in
  development (max 4 objects, every one a distinct color, the starting
  color excluded from placement entirely), removed to not limit level
  design creativity - e.g. placing the same color in multiple spots as
  a deliberate "reset" point, or leaning heavily into one or two colors
  throughout a level.
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
- **Touch-drag placement can genuinely only be trusted on a real,
  HTTPS-hosted deployment, not a local dev server.** A real iPhone
  could tap to place single objects (swap objects, doors, keys) but
  not drag-place platforms, while Chrome DevTools' device emulation
  showed no problem at all. The code was proven byte-identical between
  `main` and the branch under test, and the *built* production bundle
  served locally (`vite preview`) had the exact same failure as the
  dev server - ruling out both "it's a code bug" and "it's Vite's
  dev-mode client" as explanations. Render's own HTTPS deployment
  worked immediately with the same code. The mechanism was never
  fully pinned down (both `localtunnel` and `ngrok` failed before an
  HTTPS-vs-HTTP tunnel test could complete), but the practical
  takeaway holds either way: **testing any touch/drag interaction on
  an actual phone requires a real HTTPS-hosted build, not a local dev
  server or emulation** - see the Render Preview Environments section
  below for the workflow this led to.

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
see the Testing philosophy section above for what that cost us to
discover.

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

## Roadmap

### Phase 1 — Foundations ✅ Complete

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

**Accounts, roles & permissions (design settled; implementation in progress):**

Two signup paths - verified email (magic-link/passwordless, not
password-based) or Twitch OAuth, either or both linkable to one
account. Anonymous visitors can freely build/playtest a level from
scratch (nothing saved), and read the blog - any interaction with
*someone else's* level (playing it, editing it, opening a shared
link) requires an account. Username is a public, unique identity
chosen as a hard gate right after signup, separate from email/Twitch
(which the user can hide from public view).

Four roles: **Owner** (the first account ever created, auto-granted;
alone manages the Developer roster), **Developer** (created by Owner
or another Developer; otherwise-identical content/moderation powers to
Owner), **Moderator** (a role granted to/revoked from an existing user
by any dev; manages user-generated content and regular user accounts,
but can't touch Developer/Owner accounts or blog posts), and
**registered user**.

- [x] `User` model — both auth identities (email + Twitch, at least one
      required via a DB check constraint), role enum, per-identity
      privacy flags (`hide_email`/`hide_twitch`), suspension and
      soft-delete state (deleted accounts become an anonymized
      placeholder rather than cascading deletes)
- [x] First account ever created automatically becomes Owner (checked
      via "does an Owner already exist," not "is this the first row" -
      more robust to edge cases like the original Owner later being
      deleted); every account after that defaults to a regular user
- [x] Email verification, fully working end-to-end — `EmailVerificationToken`
      (single-use, 24h expiry), `POST /api/users` issues one and sends a
      real email via [Resend](https://resend.com) when signing up with
      email (not for Twitch - its own OAuth already confirms the
      account), the frontend's `/verify-email` page reads the token
      from the link and calls `POST /api/users/verify-email`, which
      consumes it and sets `User.email_verified_at`. If `RESEND_API_KEY`
      isn't set (e.g. a fresh local clone with nothing configured yet),
      sending is skipped and the link is logged instead - the flow
      still works either way, since in debug mode `POST /api/users`
      also includes the raw token directly in its response as
      `dev_verification_token` for testing without any inbox at all.
      `TestingConfig` hardcodes `RESEND_API_KEY = ""` regardless of what
      a local `.env` has set, specifically so the test suite can never
      accidentally trigger real Resend API calls.
- [x] Login, fully working end-to-end — magic-link, same mechanism as
      email verification but a genuinely separate token model
      (`LoginToken`, 15-minute expiry, vs. `EmailVerificationToken`'s
      24 hours - kept distinct so one could never accidentally double
      as the other). `POST /api/auth/request-login-link` accepts
      either a username or an email as the identifier, is
      enumeration-safe (identical response whether or not the
      identifier matches a real account - directly tested, not just
      asserted), and is rate-limited to 3 requests per identifier per
      day (tracked by the raw submitted identifier, not a matched user,
      so the rate limit itself can't leak account existence either -
      also directly tested). `POST /api/auth/login` consumes the token
      and issues a JWT via Flask-JWT-Extended, deliberately short-lived
      (1 hour) since it's stored in `localStorage` client-side (not an
      `HttpOnly` cookie - necessary given the cross-origin Render
      setup, but more exposed to XSS as a result; a short expiry is the
      main mitigation until a proper refresh-token pattern exists). The
      app refuses to start under the production config without a real
      `JWT_SECRET_KEY` set (fails loudly, not silently falls back to
      the random-per-process dev default) - both directions of this
      check are directly tested.
- [x] Frontend login, fully wired to the real backend - `/login` (accepts
      username or email), `/auth/callback` (completes the exchange for
      a JWT), and `/profile` (edit username/privacy, delete account) all
      actually call the real endpoints, attaching
      `Authorization: Bearer <token>` on the two that need it
      (`PATCH`/`DELETE` on users). Auth state is a shared, reactive
      Svelte 5 store (`auth.svelte.ts`) persisted to `localStorage`,
      initialized via SvelteKit's `browser` check at module-load time
      rather than a component's `onMount` - deliberately, so it doesn't
      depend on parent/child `onMount` ordering, which Svelte doesn't
      actually guarantee.
- [x] **`/verify-email` and `/auth/callback` both require an explicit
      button click before consuming their single-use token** - neither
      auto-verifies/auto-logs-in on page load anymore. This isn't
      stylistic: email security scanners (Microsoft Safe Links,
      Proofpoint, Mimecast, Gmail's link checker) visit every link in
      an email within seconds of delivery to check it's safe, before
      the recipient ever opens it. A page that consumes its token the
      instant it loads gets that token burned by the scanner, not the
      actual person - a real, hit-in-practice bug during this session,
      not a hypothetical. A scanner renders a page but doesn't click a
      button on it, which is the actual fix.
- [ ] **The 1-hour JWT expiry may be a real problem once actual level-
      building sessions exist, not just a minor UX tradeoff.** Building
      a level could plausibly take well over an hour - maybe most of a
      day for something involved. With no refresh-token mechanism, a
      long, uninterrupted building session risks the JWT silently
      expiring mid-session, only surfacing when the person finally
      tries to save. Worth solving before real users hit it, but not
      before actual level-saving exists to hit it against - noted here
      to revisit once that's built, not acted on now.
- [ ] Twitch OAuth integration - a separate, later flow entirely (a
      real OAuth redirect dance, not a magic-link), doesn't reuse any
      of the above
- [ ] Whether/how unverified email accounts are restricted (e.g. can
      they save levels before verifying?) hasn't been decided - the
      mechanism exists now, but nothing currently checks
      `email_verified_at` to gate any other action

**Levels & versioning (design settled; implementation in progress):**

No more "Screens" — that composable-sub-unit idea from the original
plan below is superseded by a simpler model: a `Level` is the
persistent, slug-addressable identity (what a share link points at);
a `LevelVersion` is an immutable content snapshot. Three-state
lifecycle per level - `draft` (private) → `testing` (private) →
`published` (public; gated on the creator personally beating their own
level via a real playthrough, not a recorded/replayed one). Editing a
published level demotes it to `testing` while the last published
version stays live for everyone else; a new version is only created
once re-beaten and re-published. A separate direct-unpublish action
also exists, clearing public visibility immediately without editing.
Anyone can fork a published level into a new one they own, crediting
the exact version copied from (not a generic "came from this level"
pointer) — this forms a remix tree, not a chain, with both ancestry
and descendant views.

- [x] `Level` model — slug (short/random, lives on the level not a
      version, so share links survive re-publishes), visibility state
      enum, the `latest_published_version_id` pointer that
      distinguishes edit-demotion from direct-unpublish at the data
      level, and remix lineage (exact-version pointer + a denormalized
      level-level pointer for descendant queries)
- [x] `LevelVersion` model — JSONB content snapshot, per-version
      `beaten_at` publish gate, cached difficulty fields
- [x] Circular FK between `levels` and `level_versions` handled via
      `use_alter` + `post_update`, specifically tested (publish,
      edit-demotion, direct-unpublish, and remix lineage each have a
      dedicated test - see `backend/tests/test_level_model.py`)
- [ ] `PlayAttempt` model — source of truth for clear rate; only
      registered users' real playthrough attempts count, anonymous
      plays don't
- [ ] Difficulty auto-labeling from clear rate (Easy 50-100%, Medium
      25-50%, Hard 5-25%, Very Hard 1-5%, "TAS!?!?" under 1%),
      per-version
- [ ] `Tag`/`LevelTag` models — dev/moderator-curated pool, two
      user-suggested tags auto-applied per level, one "Other" free-text
      slot requiring moderation
- [ ] Moderation tables — `ModerationReason` (shared pool for level and
      user actions), `LevelModerationAction`, `LevelReviewFlag` (the
      "review children" queue for direct remixes of a
      deleted/suspended level), `UserModerationAction`
- [ ] **Portals (API endpoints/CRUD) for `User`, `Level`, and
      `LevelVersion` — next up.** Actual create/read/update endpoints
      for these three models, plus tests exercising them, before
      continuing on to the remaining models above.
- [ ] Alembic migration via `flask db migrate` (schema has so far only
      been exercised via `db.create_all()` in tests, not a real
      migration)

**Marketing site & blog:**
- [x] Revamped landing page — hero section with a looping animation
      built from the game's own sprites (walk onto a starting
      platform, jump a gap while the Editor builds a landing spot,
      walk off, Editor erases it, loops), a "Build Now" CTA, and a
      devlog preview section (currently a placeholder single post +
      link, both pointing at not-yet-built `/blog` routes)
- [ ] Blog with text and image posts, for incremental dev updates -
      `BlogPost`/`BlogComment`/`BlogReaction` models, plus the actual
      `/blog` and `/blog/[slug]` pages
- [x] Blog posting restricted to developers only - covered by the
      Accounts/roles design above (Owner + Developer only; Moderators
      explicitly excluded, since posts aren't user-generated content)
- [ ] All registered users can comment and react (thumbs up/down,
      more reaction types later) on posts; Developer/Moderator/Owner
      comments each get their own distinct badge



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
- [ ] **Touch controls during Play** — how movement/jump/dash buttons
      feel, their layout, and responsiveness haven't had a dedicated
      pass; a separate concern from Editor usability specifically.
- [ ] **General mobile layout/scaling** — how the canvas fits different
      phone screen sizes and orientations beyond the existing
      landscape-only + scale-to-fit baseline hasn't been revisited.
- [ ] **Revisit Method A (dual-camera zoom) for mobile Editor
      usability, if picked back up later.** Three approaches were
      explored for making the Editor easier to use on a phone -
      bigger touch targets with no camera zoom (`mobile-touch-targets`
      - the one actually adopted, for now), a naive single-camera zoom
      with no compensation (`mobile-zoom-naive` - confirmed broken,
      UI ends up off-screen), and a proper dual-camera setup where a
      second, dedicated, never-zoomed camera renders UI independently
      of a zoomed world camera (`mobile-zoom-method-a` - technically
      correct and confirmed working; this is also the fix Phaser's own
      maintainers recommend for this exact class of problem, per
      [phaserjs/phaser#6374](https://github.com/phaserjs/phaser/issues/6374)).
      A fourth angle - repositioning UI to compensate for zoom on a
      single camera, without a second camera - was tried
      (`mobile-zoom-method-b`) and found to be a genuine dead end: that
      same GitHub issue confirms `scrollFactor` can cancel camera
      *scroll* but not camera *zoom*, so no amount of repositioning
      math can fix it - only a second camera can.

      Method A's real, measured cost turned out to be a substantial
      reduction in how much of the level fits on screen at once - a
      concrete example found during testing: a repeating "5-wide
      platform, 1-tile gap" pattern fit 7 platforms at 1.5x zoom versus
      8 platforms plus a 2-tile platform unzoomed, since zooming in
      necessarily shows fewer world units at once in exchange for
      showing them larger (`800 / 1.5 ≈ 533px` visible instead of
      `800px`, roughly a third fewer tiles across). `mobile-touch-targets`
      has no such cost - it never touches the camera, so grid/tile size
      and therefore build capacity per screen stay identical on every
      device, which is why it was chosen over either zoom approach for
      now.

      If Method A is revisited, this capacity loss is the specific
      problem to solve - not by touching `WORLD_WIDTH`/`WORLD_HEIGHT`
      (those control total buildable area across all four quadrants,
      not how much is visible at once, so they don't address this at
      all), but by adjusting how much of the Editor's editing area
      is actually reachable/visible at a given zoom level, so a mobile
      user building at 1.5x zoom ends up with genuinely equivalent
      tile access to a desktop user at 1x - not just a bigger, blurrier
      version of a smaller working area.
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

### Phase 4 — Moderation & community (not started)

Most of what this phase originally covered is now part of the settled
design in Phase 3 above (roles, `LevelModerationAction`/
`UserModerationAction`, the tag/reason pools, "review children"
flagging for remixes) rather than a separate, later concern - the
`tool_assisted` classification idea below is essentially what the new
per-version "TAS!?!?" difficulty label already is, just auto-computed
from clear rate instead of manually assigned by an admin.

Still genuinely unbuilt and not yet designed in detail:
- [ ] User-submitted reports — a "report this level/comment" action
      feeding a dev/moderator review queue; the settled design so far
      only covers devs/moderators proactively moderating, not a
      user-facing flagging mechanism
- [ ] System-flagged review — e.g. a level with real play attempts but
      a nose-diving clear rate getting automatically surfaced for
      review, building on the difficulty-label data once it exists
- [x] ~~`tool_assisted` classification~~ — superseded by the per-version
      difficulty label system in Phase 3 (auto-computed "TAS!?!?" tier
      for near-zero clear rates)

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