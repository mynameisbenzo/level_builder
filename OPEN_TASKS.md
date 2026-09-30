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

### Levels & versioning

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

### Public playthrough experience (`/play/[slug]`)

- [ ] Every death or play counted as a "playthrough attempt" -
      deliberately deferred; this is what the not-yet-built
      `PlayAttempt` model above is actually for (clear-rate tracking,
      registered users only), rather than a quick counter bolted onto
      the result modal work.

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