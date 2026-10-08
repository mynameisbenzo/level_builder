# Pixel Maker — Project Overview

An in-browser, Mario Maker–style platformer where levels are built screen by
screen — and different screens in the same level can be built by different
people. Players share and play each other's levels; level creation happens
one screen at a time, with screens later connected together into a full
level.

This document describes how the game and its underlying systems actually
work, and the design decisions behind them. See [README.md](README.md) for
setup/running instructions and the tech stack, [CLOSED_TASKS.md](CLOSED_TASKS.md)
for everything that's been built, and [OPEN_TASKS.md](OPEN_TASKS.md) for
everything still to do.

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
  in this project - see [Testing philosophy](#testing-philosophy))
- A **character HUD portrait** (top-left) always reflects the current
  color, with a shrink/overshoot/settle "pop" animation on every swap

**Mobile:** the game is landscape-only — a rotate prompt blocks portrait
orientation. On-screen touch controls only appear on touch-capable
devices; desktop mouse/keyboard users won't see them. **The overall
mobile experience, especially in the Editor, needs real work - see
[OPEN_TASKS.md](OPEN_TASKS.md).**

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
  junction piece for where they meet was tried and removed (see
  [OPEN_TASKS.md](OPEN_TASKS.md)); they currently just don't visually
  connect.

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

This is a foundational piece for a planned feature (see
[OPEN_TASKS.md](OPEN_TASKS.md)) where each character eventually plays
differently, not just looks different.

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

## Checkpoints

A level can hold one checkpoint (a flag, placed from the editor's
win-condition picker; placing a second moves the first). It is pure level
design data - `checkpointObjects` in the level content, validated to at
most one - so every account type can use it.

- **Touch.** Distance-based like keys and doors. It captures a
  `CheckpointState` (player color, collected key positions, swap-object
  colors) in the Phaser game registry, which survives `scene.restart()`.
- **Respawn.** Dying after the touch restarts the scene at the flag with
  that state restored. On `/play` there is no result modal and the page
  records a new attempt, exactly as "Play Again" does. Before the touch,
  the old modal flow is unchanged. In the editor's test play a death after
  the touch restarts in place. A win, or the editor's `create()`, clears
  the progress.
- **Endless.** Each death boots a brand-new game, so the page carries the
  checkpoint across the restart and drops it on skip, clear and game over.
- **Ghosts.** Three kinds, one row per (level, kind): `full` (spawn to
  finish, never touched the flag), `before` (spawn to the touch) and
  `after` (flag to finish). Each is one unbroken no-death stretch. The
  ghost route is the fastest of: the full ghost, or before + after
  (credited to both holders when they differ; the full ghost wins a tie).
  A spawn-start player follows the route with the lower combined time, and
  the before ghost hands over to the after ghost when the player themselves
  touches the flag. The backend rejects before/after for levels with no
  checkpoint and checks the start/end positions (64 px tolerance).
- **Total playtime and the level record.** The level record is a player's
  total playtime for the level across every try, not their fastest single
  stretch; it is separate from the ghosts. The browser's `PlaytimeClock`
  counts from the first control and stops when the player can't move
  (death, result modal, hidden tab). It reports to
  `POST /api/levels/<slug>/playtime` every 5 s, on death and when the tab
  is hidden. The server keeps one `level_playtimes` row per (user, level).
  Each report is capped at the real time since the previous one (plus a
  2 s tolerance) and the total at the real time since the row was created,
  with a 99:59.999 ceiling. A win goes to `POST /api/levels/<slug>/record`
  with the last stretch: the server adds it, deletes the row (the next try
  starts from zero) and compares the total with the level's `level_records`
  row (strictly faster replaces; a tie keeps the holder; totals under
  200 ms can't set a record). The result modal shows the total and "New
  record!"; level cards show the record. Anonymous players have no total.
  The client controls what it reports, so records are plausible, not
  proven, as with ghosts. Endless mode shares the same row and record: its
  page takes the playtime out of each game before it is destroyed (every
  death boots a new one), sends it in order through a small reporter that
  carries anything that failed to deliver, and sends the last stretch with
  a clear through the same win endpoint.

## Accounts, roles & permissions

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

## Levels (publishing is final)

No more "Screens" — that composable-sub-unit idea from an earlier plan
is superseded by a simpler model: a `Level` is one slug-addressable
level (what a share link points at), content included. There are no
versions. A level is a `draft` (private, freely editable) until the
creator beats it personally via a real playthrough (not a
recorded/replayed one) and publishes it - and **publishing is final**:
afterwards its content, name and thumbnail never change, and it can't
be published again. (`published_at` is set once and never cleared; the
only way to take a published level down is the owner's soft delete.)
Because a published level never changes, everything measured against
it - plays, completions, ratings, its ghost, its difficulty - is about
exactly one layout. Once published, the creator's own plays count like
anyone's, toward play/completion counts and the clear rate alike (as in
Super Mario Maker); only the pre-publish test plays, which happen on the
draft, never do. Anyone can remix a published level into a new,
separate level they own (`remixed_from_level_id`; no endpoint yet) —
this forms a remix tree, not a chain, with both ancestry and descendant
views.

## Public playthrough experience (`/play/[slug]`)

What a second player (not the level's owner) actually gets when they
open a published level's share link and play it - as opposed to the
owner's own test-play loop inside the Editor, which is a separate code
path with different behavior throughout. See
[CLOSED_TASKS.md](CLOSED_TASKS.md) for the full list of what this
covers today (death/win handling, the result modal, like/dislike
rating, routing back to the creator's profile, logout behavior) and
[OPEN_TASKS.md](OPEN_TASKS.md) for what's still deliberately deferred
(playthrough-attempt tracking).

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
kind of cross-platform build issues (see the Windows note in
[README.md](README.md)) this project has already run into once.

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
  server or emulation** - see README.md's CI section (Preview
  Environments) for the workflow this led to.

## Level limits per user

Modeled on Mario Maker's 100-course limit, split into two separate
budgets rather than one shared pool:

- **Drafts (never-published levels): capped at 5**
  (`MAX_DRAFT_LEVELS` in `app/api/levels.py`). Enforced on
  `POST /api/levels` - refused once the caller already owns 5 levels
  that aren't published yet. Cheap to create and abandon, so this is
  kept tight: "how many works-in-progress can you juggle at once," not
  a lifetime count. Publishing a draft moves it out of this bucket
  entirely, freeing the slot for a new one.

- **Published levels: capped at 100** (`MAX_PUBLISHED_TOTAL`). Enforced
  on `POST /api/levels/<slug>/publish` - every level the user has ever
  published counts as 1, soft-deleted ones included (deleting doesn't
  refund the slot). Publishing is final - a published level can't be
  edited or published again - so there's no way to get extra levels out
  of one slot.

Still open, deliberately not decided: whether a soft-deleted or
moderated level should keep counting toward either
cap once moderation exists (see [OPEN_TASKS.md](OPEN_TASKS.md)) -
nothing like that is built yet, so there's nothing to decide about it
today.

## Discover / browsing levels

Not started - `/play/[slug]` (see [Levels](#levels-publishing-is-final)
above) goes straight to one specific, already-known level. Nothing yet
lets someone find a level they don't already have a link to - see
[OPEN_TASKS.md](OPEN_TASKS.md) and [CLOSED_TASKS.md](CLOSED_TASKS.md)
for the current state of this area.