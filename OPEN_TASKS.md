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

### Levels (publishing is final: no versions)

- [ ] Show the difficulty label in the UI (level cards, `/play/[slug]`,
      Discover) - nothing displays it yet
- [ ] `Tag`/`LevelTag` models — dev/moderator-curated pool, two
      user-suggested tags auto-applied per level, one "Other" free-text
      slot requiring moderation
- [ ] Moderation tables — `ModerationReason` (shared pool for level and
      user actions), `LevelModerationAction`, `LevelReviewFlag` (the
      "review children" queue for direct remixes of a
      deleted/suspended level), `UserModerationAction`

### Public playthrough experience (`/play/[slug]`)

- [ ] **Ghost: stronger run verification (future)** - the server can't
      prove a run was really played, only that it's plausible; a
      determined cheater can craft a believable path. Real verification
      needs deterministic server-side replay of recorded inputs, which
      the current Arcade-physics loop isn't built for.
- [ ] **Ghost: owner/staff reset (future)** - remove a ghost that
      slipped through (owner of the level, moderators).
- [ ] **Ghost: show the record on level cards (future)** - best time and
      holder next to likes/clear rate on `/u/[username]` and Discover.

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
      review, building on the difficulty-label data (`PlayAttempt`)

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
        TAS!?!? - see Levels (publishing is final); these come from
        `Level.difficulty_label_cached`, which is unset until a level
        has 10 attempts). A category with zero
        matching levels is greyed out in the picker. Repeats are fine,
        and a user can be served their own levels.
      - **Server-authoritative runs.** One active run per user at a
        time, owned by the backend so a refresh can't reset lives and the
        client can't edit them. Starting a new run while one is active
        asks "resume or start over"; start over ends the old run as
        forfeited. A run records user, difficulty filter, starting and
        remaining lives, levels cleared, deaths, skips, status and
        timestamps; each level served within it records the level,
        order, outcome (cleared / died / skipped) and deaths.
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
        'endless' | 'direct'` on `PlayAttempt`, plus the run
        tables above).
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
- [ ] **Endless mode: longest runs (future)** - a record of the longest
      endless runs (most levels cleared in one run, by difficulty
      category). The data already exists: `EndlessRun.levels_cleared`
      plus `difficulty` and `starting_lives`. Needs a leaderboard
      query/endpoint and somewhere to show it (entry screen, profile).
- [ ] **Scoreboard mode (future)** - a separate mode from the lives-based
      endless mode above, built around a high-score leaderboard. Idea
      only, no design work or code yet:
      - Every run is **5 lives**, fixed.
      - The same difficulty categories can be picked as in endless mode
        (Any, Easy, Normal, Hard, Very Hard, TAS!?!?).
      - A run's score is the **number of levels beaten**, with one
        exception: in the **Any** category a level is worth more the
        harder it is - +1 for Easy, +2 for Normal, +3 for Hard, and so
        on up the labels (the values for Very Hard and TAS!?!? aren't
        set yet; +4 and +5 would continue the pattern).
      - A scoreboard to show the high scores, per category.
      - Not yet decided: how it relates to the "longest runs" record
        above (likely replaces or absorbs it); whether it shares endless
        mode's daily lives pool and free/paid limits; whether skipping
        still costs a life; how an unlabeled level (under 10 attempts)
        scores in Any; and whether a score counts the same level more
        than once.
- [ ] **Endless mode: report abandons on page close (future)** - a
      best-effort report to the server when the page is closed or hidden
      (`navigator.sendBeacon`), so most abandoned attempts resolve right
      away instead of only when the player next returns. Never relied on:
      the lazy resolve-on-return path is still the source of truth.

## Multiplayer (planned, after ghosts)

- [ ] **Live race** - everyone plays the same published level at once
      and sees each other as ghosts, no interaction. Design settled in
      conversation (no code yet).
      - **Transport.** Flask-SocketIO inside the existing Render
        backend: free, one codebase, no Redis (a free Render service is
        a single instance, so room state lives in memory). Expected load
        is a handful of races a day, mostly promoted on Twitch. Needs a
        deploy change so the backend can serve WebSockets - a simple
        threaded mode that avoids monkey-patching is preferred (check
        Flask-SocketIO's deployment docs). Keep the race logic in its own
        module behind a thin boundary (join, leave, position, finish) so
        the transport could later move to something like Cloudflare
        Durable Objects. Practical notes: the free service takes about a
        minute to wake from idle (open the site before going live), and
        a deploy or restart drops every live room, so don't deploy
        mid-race.
      - **Access.** Logged-in **paid** accounts only (the tier derivation
        under "Account tiers & content restrictions" - staff roles count
        as paid). `is_paid` doesn't exist yet and there is no payment
        processor, so for now access is staff accounts plus accounts
        granted `is_paid` by hand. Max 4 players per room. An empty or
        idle room expires after about 10 minutes. Cap messages per
        socket so nobody can flood a room.
      - **Joining, leaving and hosting.**
        - **Join mode**, set by the host and changeable from the lobby:
          (1) **host invite only** - only the host can invite;
          (2) **party invite** - any racer in the room can invite;
          (3) **public** - anyone with the link can join. In modes 1
          and 2 an invite is sent to a specific account (by username)
          and the room link only admits someone on the invite list - a
          copied link alone doesn't get a stranger in; in public mode
          the link alone is enough. Everyone still needs a paid account
          and a free slot.
        - **Kicking.** The host can kick a player, and a kicked player
          can't rejoin the room through the link.
        - **Leaving.** A **Leave race** button works at any time, without
          closing the window or app. Leaving mid-race is a DNF, placed
          last, counted in the player's DNF total, and it breaks their
          win streak. Their ghost fades out for everyone else.
        - **Joining mid-race.** A new player can fill a freed slot but
          can't enter a race already under way: they wait in the room
          ("race in progress, you're in the next one") and are included
          in the next vote. Joining a room that is only voting or
          showing results is allowed. If more people want in than there
          are free slots it is first come, first served.
        - **Host leaving.** The host role passes to the longest-present
          player, so the room survives.
        - **Last racer left.** They can finish the level, but it only
          counts as a win in the stats if at least 2 players were
          present when the race started - so nobody can farm wins by
          having a friend join and quit.
        - **Spectating** a race in progress is not in the first version.
      - **Room flow.** The host creates a room and gets an invite link
        (`/race/<short code>`); up to 4 players join. The host picks a
        difficulty category (the same choices as endless mode, including
        Any), and the server draws **1-4 random levels** from it as the
        candidates (fewer if the category doesn't have that many; no
        duplicates). Every racer votes; the level with the **most
        votes** wins, and a tie (including a four-way 1-1-1-1 split) is
        broken by a selection animation that spins over the tied levels
        and lands on one. Candidates can include levels owned by
        anyone in the room (no restriction). The vote has a timer of
        about 20 seconds, and if nobody votes the server picks at random.
      - **Starting.** Every client loads the chosen level and tells the
        server it is ready - phones load slower than laptops - and
        anyone who doesn't within about 15 seconds is dropped. Then 
        the server sends a "go at time T" against a shared
        server clock (with a clock-offset estimate per client), with a
        3-2-1 countdown and controls locked until go.
      - **The race.** Each client simulates only its own player and
        streams position about 20x a second (the ghost sample shape: x,
        y, facing, pose). Opponents are drawn as translucent ghosts with
        name tags, tinted by player slot, rendered ~100-150 ms behind
        real time and interpolated between samples. Players don't
        collide, and keys, swap objects and doors stay local to each
        player. The existing scene has exactly one ghost, so this means
        generalizing it to a set of live, network-fed opponents.
      - **Death.** Respawn at the start and keep racing. Deaths show on
        the results and break ties; they never eliminate anyone.
      - **Winning.** The first finish message to reach the server wins,
        and placements follow arrival order. Finish times are measured by
        the server (they include a little network latency) - client-
        reported times are deliberately not used.
      - **Ending.** 30 seconds after the first player finishes, anyone
        still running is marked DNF. Overall cap of **2 minutes** from
        go: anyone still running when it expires is DNF, so a race where
        nobody finishes still ends.
      - **Disconnects.** About 15 seconds to reconnect, then a forfeit
        (DNF). iOS will likely drop the socket when the app is
        backgrounded - untested.
      - **After the race.** The results screen shows placements, times
        and deaths, with **Next Race / Leave**. Next Race sends everyone
        still in the room back to a fresh candidate draw and vote once
        all remaining players have clicked it. Anyone who hasn't clicked
        after 30 seconds is treated as having left, so one idle player
        can't stall the room. Leave lets the room continue as long as 2
        or more players remain. The room also keeps a **running win count**
        across its races, shown on the results screen; it lives only
        while the room exists and is not saved.
      - **Stored.** A race record plus one entry per player (placement,
        finish time, deaths, status), written when the race ends. Live
        room state stays in memory. Races stay out of `PlayAttempt`
        (they don't move difficulty labels, source `'race'` if ever
        recorded there) and out of ghost records; both can change later.
        Race results appear on the public `/u/[username]` page and on
        the player's own `/profile`: totals (races entered, wins, podium
        finishes, DNFs), current and longest win streak, and a list of
        recent races (level, placement, finish time, deaths, number of
        racers). No best-time-per-level stat for now - race times
        include network latency, so they aren't comparable to ghost
        times.
      - **Cheating.** Positions can't be proven honest. The cheap
        defence is a speed limit and no-teleport check on the incoming
        stream, reusing the ghost validator's logic; anything stricter
        (server-side input replay) isn't realistic with the current
        physics.
      - **Known tradeoff:** because a racer's own level can be drawn,
        its creator may race it with a big head start. Accepted for now;
        revisit if it causes complaints.
      - **Build stages.** Each stage is usable and testable on its own,
        and everything stays behind the paid/staff gate, so it can ship
        piece by piece. Race rules (vote tally and ties, finish order,
        the 30-second and 2-minute endings, win-streak rules) belong in
        Phaser-free modules with unit tests; the scene wiring is checked
        manually in the browser, as elsewhere in this project.
        1. **Transport and bare rooms.** Flask-SocketIO deployed on the
           backend in its threaded mode (confirm WebSockets work on
           Render without disturbing the REST API), JWT check on
           connect, the paid/staff gate, create a room and invite link,
           the three join modes with username invites, kick/ban, leave,
           host handover, idle-room expiry, and the per-socket message
           cap. Done when two paid accounts can open a room, see each
           other join and leave, and hand off the host. Also the first
           chance to check how iOS behaves when the app is backgrounded.
        2. **Level choice and start.** Category pick, the 1-4 candidate
           draw, the 20-second vote with the tie-breaking spin animation
           and random fallback, the load-ready handshake (15-second
           timeout), per-client clock offset, and the synchronized 3-2-1
           countdown with controls locked until go. Done when every
           client in a room reaches the same "go" on the same level.
        3. **The race.** Position streaming at about 20 Hz, the single
           ghost generalized into several interpolated live opponents
           with name tags and slot tints, respawn-on-death with a death
           count, finish messages and placements by arrival, the
           30-second and 2-minute endings, DNF handling, leaving
           mid-race, late joiners waiting for the next race, the
           results screen with Next Race / Leave (30-second rule), the
           in-room running win count, and the sanity checks on the
           position stream. The largest stage.
        4. **Storage and profiles.** The race and per-player entry
           tables with a migration, written when a race ends (a win
           counts only if at least 2 players were present at the start),
           then the totals, win streaks and recent-races list on
           `/u/[username]` and `/profile`.
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