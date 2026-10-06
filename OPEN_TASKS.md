# Open Tasks

Everything still to do, organized the same way as the original roadmap
phases. See [PROJECT.md](PROJECT.md) for how the existing systems work
and the design decisions behind them, and
[CLOSED_TASKS.md](CLOSED_TASKS.md) for everything already built.

## Phase 2 — Gameplay

- [ ] **Character-specific abilities (SMB2-style)** — explore giving each
      of the five character colors a distinct gameplay trait instead of
      being purely cosmetic (e.g. one jumps higher, one can float
      briefly, one moves faster). A bigger, more exploratory idea than
      the rest of this list — worth prototyping before committing, since
      it touches the shared movement/pose system every character
      currently uses identically (`getPlayerPose`,
      `getAcceleratedVelocity`, `getJumpVelocity`/`getJumpCutVelocity`
      are all color-agnostic right now). The character-swap system (see
      [PROJECT.md](PROJECT.md#character-swapping)) is the foundational
      piece this was building toward.
- [ ] Interactable objects beyond keys (coins, etc.)
- [ ] Enemies, mini-enemies, bosses
- [ ] Climb animation exists in the sprite atlas but isn't wired to
      anything yet (no climbable surfaces)
- [ ] Second win-condition variant: doors requiring a *specific* key
      already works (color-matching is built); a more elaborate
      variant (e.g. requiring multiple keys, or a key that's consumed
      on use) hasn't been explored.

## Phase 3 — Level creation, accounts & persistence

### Accounts, roles & permissions

- [ ] Whether/how unverified email accounts are restricted (e.g. can
      they save levels before verifying?) hasn't been decided - the
      mechanism exists now, but nothing currently checks
      `email_verified_at` to gate any other action

### Account tiers & content restrictions

Design settled, not yet built. Three tiers - anonymous (no account),
free, and paid - restrict both how much of the level grid an editor can
reach and which catalog content they can use.

- [ ] **`User.is_paid`** (boolean, default `false`) - the only new
      billing-state field needed. No subscription/expiry fields: the
      paid tier is a one-time purchase, not a recurring plan, so
      there's no lapse to model.
- [ ] **Tier derivation** - one function, called identically from the
      editor-load response and the save/publish validator (never
      computed independently client-side vs. server-side):
      `role in {OWNER, DEVELOPER, MODERATOR} -> paid`, else
      `is_paid -> paid`, else `logged in -> free`, else `anonymous`.
- [ ] **Screen-bounds policy**, anchored **bottom-left** of the fixed
      3x30 world (`WORLD_ROWS`/`WORLD_COLUMNS` in `camera.ts`) so a
      later upgrade always expands a level outward/upward from what's
      already built rather than shifting existing content: anonymous =
      1x1 (bottom-left screen only), free = 2x2 (bottom-left 2 rows x
      2 columns), paid = full 3x30.
      - Enforced by clamping the space-bar drag-pan's scrollable range
        in `LevelEditorScene` to the tier's pixel rect (not the full
        world's `camera.setBounds`). This is specifically about the
        pan-to-look-around-while-building camera used during editing -
        a separate concern from the in-game `follow`/`quadrant` camera
        modes used during play.
- [ ] **Catalog gating** - anonymous and free both get the full
      *current* catalog (every existing tile style, enemy type, hazard,
      win-condition/door type, character-swap color, character) with no
      content restriction - only the screen-bounds restriction above
      applies to them. Going forward, anything *newly added* to a
      catalog is paid-only by default.
      - Requires refactoring each flat catalog array (`ENEMY_TYPES`,
        `GROUND_TILE_STYLES`, `PLAYER_COLORS`, door types, etc.) into
        `{ id, displayName, icon, minTier }` entries - there's no
        per-item metadata registry today, just flat `as const` arrays
        with labels/icons hardcoded inline in `LevelEditorScene.ts`.
        Every existing item gets `minTier: 'free'`.
      - Locked (`minTier: 'paid'`) items render **disabled** in the
        toolbar - plain disabled state, no upsell tooltip/copy for now
        (not the `title=`-on-disabled pattern used elsewhere, e.g. the
        Publish button's "Test and beat your level first").
      - **Separate locked-items toolbar/shelf** - once there's enough
        paid-only content to warrant its own grouping, rather than
        disabled items scattered among unlocked ones.
- [ ] **Backend is the real gate, not the toolbar** - the save/publish
      validator (same spot as today's `MAX_GROUND_TILES` etc. in
      `level_content.py`) must independently re-derive the account's
      tier and reject any `draft_content` with a placed object outside
      the tier's bottom-left rect, or of a type whose `minTier` exceeds
      the account's tier - regardless of what the editor UI allowed,
      since the UI restriction alone can't stop a direct API call.
- [ ] `is_paid` stays unset until a payment processor is chosen (see
      "Payment processor for the paid tier" under Future Considerations
      below) - nothing in this design is blocked on that; the gating
      logic just needs the boolean to exist.

### Levels & versioning

- [ ] `PlayAttempt` model — source of truth for clear rate; only
      registered users' real playthrough attempts count, anonymous
      plays don't
- [ ] Difficulty auto-labeling from clear rate (Easy 50-100%, Normal
      25-50%, Hard 5-25%, Very Hard 1-5%, "TAS!?!?" under 1%),
      per-version
- [ ] `Tag`/`LevelTag` models — dev/moderator-curated pool, two
      user-suggested tags auto-applied per level, one "Other" free-text
      slot requiring moderation
- [ ] Moderation tables — `ModerationReason` (shared pool for level and
      user actions), `LevelModerationAction`, `LevelReviewFlag` (the
      "review children" queue for direct remixes of a
      deleted/suspended level), `UserModerationAction`

### Public playthrough experience (`/play/[slug]`)

- [ ] Every death or play counted as a "playthrough attempt" -
      deliberately deferred; this is what the not-yet-built
      `PlayAttempt` model above is actually for (clear-rate tracking,
      registered users only), rather than a quick counter bolted onto
      the result modal work.
- [x] **Ghost run** - one ghost per published level *version*: the
      fastest recorded clear, replayed as a translucent, tinted character
      with its owner's name above it (in `/play/[slug]` and endless). A
      strictly faster clear by a logged-in player replaces it; a tie
      keeps the old one; a new version starts with none. Recorded
      client-side every 50ms (position, facing, pose, character color)
      against a run clock that only counts time actually playing, and
      checked server-side for shape, sane duration, a start near the
      spawn, and no teleports between samples (`app/services/ghosts.py`).
      The result modal shows your time and the record ("New record!").
- [ ] **Ghost: stronger run verification (future)** - the server can't
      prove a run was really played, only that it's plausible; a
      determined cheater can craft a believable path. Real verification
      needs deterministic server-side replay of recorded inputs, which
      the current Arcade-physics loop isn't built for.
- [ ] **Ghost: owner/staff reset (future)** - remove a ghost that
      slipped through (owner of the level, moderators).
- [ ] **Ghost: show the record on level cards (future)** - best time and
      holder next to likes/clear rate on `/u/[username]` and Discover.
- [ ] **Ghost: carry a ghost across a republish (future)** - currently
      every new version starts with none; a cosmetic-only edit could
      keep the old one.

### Marketing site & blog

- [ ] Blog with text and image posts, for incremental dev updates -
      `BlogPost`/`BlogComment`/`BlogReaction` models, plus the actual
      `/blog` and `/blog/[slug]` pages
- [ ] All registered users can comment and react (thumbs up/down,
      more reaction types later) on posts; Developer/Moderator/Owner
      comments each get their own distinct badge

### Level Editor

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
      persist across sessions (see PROJECT.md's
      [Testing philosophy](PROJECT.md#testing-philosophy) for a working
      example of this pattern).
- [ ] **Instructions as a dedicated page** — the modal works for now, but
      if the content list keeps growing (more tools, more mechanics),
      it'd outgrow a Phaser-rendered modal.
- [ ] **Kill zone** — generalize the current "player falls off-screen →
      revert to Editor" behavior into a proper system for removing/
      resetting *any* sprite (not just the player) that leaves the
      playable bounds, once there are other objects (enemies, etc.) that
      need the same handling.
- [ ] **Service worker / offline support** — installable as a home-screen
      app now (`manifest.json`, icons, standalone display mode - see
      `IosInstallBanner.svelte`), but deliberately no service worker yet.
      What exists is purely the app-like launch experience (icon,
      chromeless window, straight to `/profile` if already logged in);
      the editor/game still needs a live connection for auth and level
      data regardless, so true offline play would mean caching game
      assets and deciding a real strategy for what happens to
      save/load while offline - a genuinely separate, bigger piece of
      work, not a small addition to what's already there.

## Phase 4 — Moderation & community (not started)

Most of what this phase originally covered is now part of the settled
design in Phase 3 above (roles, `LevelModerationAction`/
`UserModerationAction`, the tag/reason pools, "review children"
flagging for remixes) rather than a separate, later concern.

Still genuinely unbuilt and not yet designed in detail:
- [ ] User-submitted reports — a "report this level/comment" action
      feeding a dev/moderator review queue; the settled design so far
      only covers devs/moderators proactively moderating, not a
      user-facing flagging mechanism
- [ ] System-flagged review — e.g. a level with real play attempts but
      a nose-diving clear rate getting automatically surfaced for
      review, building on the difficulty-label data once it exists

## Discover / browsing levels

Not started - `/play/[slug]` goes straight to one specific,
already-known level. Nothing yet lets someone find a level they don't
already have a link to:

- [ ] **A discover/search area** - browsing and searching published
      levels by title, and searching for creators by username. No
      design work done yet on ranking/sorting (newest? most played?
      highest clear rate?) or what filters make sense.
- [ ] **Endless mode** - a lives-based run: the player is served random
      published levels one after another until they run out of lives.
      Design settled (no code yet):
      - **Accounts only.** Non-users see the option but are redirected
        to sign up; the start-run endpoint also requires a JWT (the
        redirect alone is only UX).
      - **Lives per run.** Free accounts: fixed at 10. Paid accounts:
        default 100, adjustable from 1 to 100 (capped server-side). A
        death costs a life, and so does skipping a level.
      - **Daily pool (free accounts only).** 50 lives per 24 hours, with
        every life lost in a run (deaths, abandoned attempts, skips)
        coming out of it. There is no carryover between runs: a new run
        always starts with 10 lives, or whatever is left in the pool if
        that is under 10 (e.g. pool 16: run 1 loses all 10, pool is 6;
        run 2 starts with 6). Quitting a run early only costs the lives
        actually lost, nothing is charged up front or refunded. The pool
        resets every 24 hours counted from the user's `created_at`
        (plain UTC arithmetic, no per-user timezone handling). Paid
        accounts have no pool and are never locked out.
      - **Selection.** Either truly random (any difficulty) or filtered
        by one of the difficulty labels (Easy, Normal, Hard, Very Hard,
        TAS!?!? - see Levels & versioning; these depend on `PlayAttempt`
        and the auto-labeling existing first). A category with zero
        matching levels is greyed out in the picker. Repeats are fine,
        and a user can be served their own levels.
      - **Server-authoritative runs.** One active run per user at a
        time, owned by the backend so a refresh can't reset lives and the
        client can't edit them. Starting a new run while one is active
        asks "resume or start over"; start over ends the old run as
        forfeited. A run records user, difficulty filter, starting and
        remaining lives, levels cleared, deaths, skips, status and
        timestamps; each level served within it records the level and
        version, order, outcome (cleared / died / skipped) and deaths.
      - **Resuming.** A saved run restores the run state, not the
        in-level position: resuming restarts the current level from the
        beginning. A run idle for 24 hours expires.
      - **Abandoned attempts.** The client tells the server when an
        attempt actually begins (level loaded), not when the interstitial
        is shown. If an attempt is still unresolved when the player next
        comes back (tab closed, crash, lost connection), the server
        resolves it as a death at that point - no background job. An
        attempt abandoned within 30 seconds of beginning is not counted
        (grace period, for accidental closes and crashes - kept short on
        purpose, since a long one would let players quit just before
        dying and never lose a life). One abandoned in an earlier pool
        window costs nothing, same as any normal reset.
      - **Metrics.** Clear rate counts every try, same as direct play
        (a level cleared on the 5th try is 5 attempts, 1 completion).
        Endless plays and clears count toward a level's play/completion
        counts, tracked separately from direct plays (a `source:
        'endless' | 'direct'` on play records / the future `PlayAttempt`
        table, plus the run tables above).
      - **Interstitial screen** shown before every level (and again
        after a death): a centered banner with the level name above the
        creator's name; above that, the level's starting character with
        "x {lives}" beside it. After a death the character plays a quick
        death animation, pops back into place, and the counter ticks
        down by one.
      - **Game over.** When lives reach 0 the counter ticks down to zero
        on the interstitial, then a "game over" banner falls in from
        above and lands in the center. For a free user whose daily pool
        is exhausted, it also shows that the 50 lives refresh and how
        long until they do (they can't start another run until then). A
        free user with pool left, or a paid user, can start another run.
- [ ] **Endless mode: 1-ups (future)** - clearing a level can award 1-ups,
      the only way a player gets lives back mid-run. Max 3 per level, only
      granted on a clear, and shown in the UI. Not part of the first
      version.
- [ ] **Endless mode: "rejoining cost you a life" notice (future)** - when
      a player returns to a run whose in-progress attempt was abandoned
      (tab closed, crash, lost connection) and the server resolves it as
      a death, tell them on the interstitial that rejoining cost a life,
      so the lower count isn't a surprise.
- [ ] **Endless mode: report abandons on page close (future)** - a
      best-effort report to the server when the page is closed or hidden
      (`navigator.sendBeacon`), so most abandoned attempts resolve right
      away instead of only when the player next returns. Never relied on:
      the lazy resolve-on-return path is still the source of truth.

## Multiplayer (planned, after ghosts)

- [ ] **Live race** - everyone plays the same published version at once
      and sees each other as ghosts, no interaction. Each client simulates
      only its own player and broadcasts position ~10-20x a second. Needs
      a realtime transport (Flask-SocketIO with a Redis message queue, or
      a separate websocket service), rooms/invite codes, a synchronized
      start against a shared server clock, interpolated remote players,
      and match/result storage. Reuses the ghost sample format.
- [ ] **Co-op / competitive with interaction** - players collide and
      share keys, enemies and character swaps. Needs a server-
      authoritative simulation or deterministic lockstep; the heaviest
      option and likely a game-loop rewrite. Decide only after the live
      race exists.

## Future Considerations (way down the line)

Not part of the active technical roadmap — noted for later, pricing
model only, details TBD:

- [ ] **Payment processor for the paid website tier** — not yet chosen
      (Stripe or otherwise). The settled design for that tier (see
      "Account tiers & content restrictions" in Phase 3) is a
      **one-time purchase**, which conflicts with the "monthly
      subscription" framing of the next bullet below - that bullet
      predates this decision and hasn't been reconciled with it yet.
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