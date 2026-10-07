# Closed Tasks

Everything completed so far, organized the same way as the original
roadmap phases. See [PROJECT.md](PROJECT.md) for how these systems
actually work and the design decisions behind them, and
[OPEN_TASKS.md](OPEN_TASKS.md) for what's left.

## Phase 1 — Foundations ✅ Complete

- [x] Backend skeleton, CI for both backend and frontend, Phaser
      integration, deployment on Render + Neon with a CI-gated pipeline,
      portfolio-facing landing page.

## Phase 2 — Gameplay

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
      (see [PROJECT.md](PROJECT.md#win-conditions-doors-and-keys)). This
      was the blocker noted for backend work in Phase 3 - now cleared,
      see the Phase 3 note below.
- [x] **World size doubled + full camera system.** Every level is now
      four quadrants (2x2 grid); Play mode has Follow/Quadrant camera
      modes per level; the Editor has a Navigate/Edit interaction-mode
      toggle for panning around the larger world. Not originally on this
      roadmap - added mid-session as a deliberate scope expansion (see
      [PROJECT.md](PROJECT.md#world-size-and-the-camera)).
- [x] **Checkpoints (single player).** One per level, placed in the
      editor's win-condition picker (the flag), available to every
      account type and limited to one by the save/publish validator.
      Touching it captures the player's color, held keys and swap-object
      colors; dying afterwards respawns there with all of that restored
      and no result modal. Every respawn still counts as a new attempt.
      A level with a checkpoint keeps up to three ghosts - full, before
      and after - each with its own holder, and the level record is the
      fastest route (see [PROJECT.md](PROJECT.md#checkpoints)). Endless
      mode carries the checkpoint across the new game each death boots.

## Phase 3 — Level creation, accounts & persistence

### Accounts, roles & permissions

(See [PROJECT.md](PROJECT.md#accounts-roles--permissions) for the
settled design - signup paths, roles, and permissions this work
implements.)

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
- [x] **Fixed a real, confirmed data-corruption bug: every timestamp this
      app wrote was silently off by the local machine's UTC offset.**
      Root cause: Postgres.app defaults a database's own *session*
      timezone to the host machine's timezone, not UTC. Every write used
      `datetime.now(timezone.utc)` - correct in Python - but psycopg
      converts a timezone-aware datetime into the *connection's session
      timezone* before storing it in a column that has no timezone of
      its own, not into UTC regardless of what timezone the value
      started in. On a Pacific-timezone machine, this meant every
      `created_at`/`expires_at`/`used_at` came out ~7 hours off while
      still looking like a plausible value - a `LoginToken` meant to
      expire in 15 minutes was actually valid for ~7 hours. Confirmed by
      direct reproduction (broke it on demand with the DB session set to
      `America/Los_Angeles`, then proved the fix closes it against that
      exact session), not just inspection. Two independent fixes: (1)
      `app/utils/time.py`'s `utc_now()` strips the timezone label in
      Python *before* SQLAlchemy/psycopg ever see it, so there's nothing
      timezone-aware left to "helpfully" convert - used everywhere a
      timestamp gets written, across `User`, `Level`, `LevelVersion`,
      `EmailVerificationToken`, `LoginToken`, `LoginLinkRequest`; (2)
      `SQLALCHEMY_ENGINE_OPTIONS` in `config.py` forces every Postgres
      session's timezone to UTC at the connection level itself, so even
      a future stray `datetime.now(timezone.utc)` bypassing `utc_now()`
      wouldn't silently corrupt storage again. `LoginToken`'s 15-minute
      expiry is now a real, verified guarantee, not an accidental
      side effect of which timezone happens to be running the server -
      a previous fix attempt (comparing against naive local time instead)
      "worked" locally only because PDT happens to sit behind UTC; it
      would have failed completely in production, where Render runs UTC
      and that accidental slack disappears entirely.
- [x] **JWT refresh tokens.** `RefreshToken` model, `POST /api/auth/refresh`
      (issues a new access + refresh pair, revoking the old one) and
      `POST /api/auth/logout` (revokes it). The access token is
      actually 15 minutes (`JWT_ACCESS_TOKEN_EXPIRES` in `config.py` -
      this item previously said 1 hour, which was wrong), but that's
      no longer the exposure it sounds like: `auth.svelte.ts` schedules
      a silent refresh 2 minutes before the token's own expiry (read
      from its `exp` claim, not a hardcoded guess), plus a reactive
      `tryRefresh()` fallback every authenticated call already uses if
      a request ever comes back expired anyway (e.g. the machine was
      asleep through the scheduled time). A long level-building session
      should never actually hit a dead access token.
- [x] **Twitch OAuth.** Backend: `/auth/twitch/callback` (login or
      first-time signup, prompting for a username since Twitch's own
      isn't guaranteed unique here), `/auth/twitch/finish-signup`, and
      `/auth/twitch/link` (attaching Twitch to an already-logged-in
      email account). Frontend: "Continue with Twitch" on both
      `/login` and `/signup`, the callback page handling both the
      direct-login and needs-a-username branches, and a link/unlink
      control on `/profile`.

### Levels & versioning

(See [PROJECT.md](PROJECT.md#levels--versioning) for the settled
lifecycle design this work implements.)

- [x] `PlayAttempt` model — source of truth for clear rate; only
      registered, non-owner users' real playthrough attempts count,
      anonymous plays don't (they still bump the play/completion
      counts shown on level cards). One row per try, with `source`
      `'direct'` or `'endless'`; `completed_at` is null for a death,
      quit or abandon.
- [x] Difficulty auto-labeling from clear rate (Easy 50-100%, Normal
      25-50%, Hard 5-25%, Very Hard 1-5%, "TAS!?!?" under 1%),
      per-level (a published level never changes). A level needs 10
      attempts before it gets a label; a boundary belongs to the
      easier label. Cached on `Level.difficulty_label_cached` and
      recomputed on every attempt start/completion
      (`app/services/difficulty.py`). No backfill, so older levels
      start unlabeled.

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
- [x] **Portals (API endpoints) for `Level`/`LevelVersion`.** Built:
      `POST /api/levels` (create), `GET /api/levels` (caller's own
      list, drafts included), `GET /api/levels/<slug>` (owner-only,
      full content), `PATCH /api/levels/<slug>` (save the draft),
      `POST /api/levels/<slug>/beat`, `POST /api/levels/<slug>/publish`
      (creates the `LevelVersion`), `GET /api/levels/<slug>/play`
      (public, no auth - serves the last published version),
      `DELETE /api/levels/<slug>` (soft-delete via `is_deleted`, owner
      only - a direct-unpublish/remove action, distinct from the
      edit-demotion path above), `GET /api/levels/by-user/<username>`
      (public - a creator's published levels only, excluding deleted
      ones). `User` already had its own portals from the Accounts work
      above (`PATCH`/`DELETE` on `/api/users/<id>`, plus the public
      `by-username` lookup) - this item was specifically the
      `Level`/`LevelVersion` side, which was the actual gap.
- [x] **Alembic migrations, via Flask-Migrate.** `flask db init` +
      `flask db migrate` generated an initial migration covering the
      full schema; verified by actually applying it against a fresh
      database and structurally comparing the result to what
      `db.create_all()` produces (exact match: same tables, columns,
      types, unique constraints, foreign keys). One thing worth
      knowing: Alembic's autogenerate isn't infallible - the generated
      migration for the JSONB columns (`Level.draft_content`,
      `LevelVersion.content`) referenced `Text()` without importing it,
      a known quirk with that particular column pattern. Always review
      what autogenerate produces rather than trusting it blindly. See
      "Database schema changes" in [README.md](README.md) for the
      actual workflow, including the one-time step existing databases
      need.

### Public playthrough experience (`/play/[slug]`)

(See [PROJECT.md](PROJECT.md#public-playthrough-experience-playslug)
for what this covers and why it's separate from the Editor's own
test-play flow.)

- [x] Every play counted as a "playthrough attempt" - done via the
      `PlayAttempt` model (clear-rate tracking, registered non-owner
      users only). Deaths aren't reported individually: an attempt that
      never completes simply stays open.
- [x] **Ghost run** - one ghost per published level: the
      fastest recorded clear, replayed as a translucent, tinted character
      with its owner's name above it (in `/play/[slug]` and endless). A
      strictly faster clear by a logged-in player replaces it; a tie
      keeps the old one. Recorded
      client-side every 50ms (position, facing, pose, character color)
      against a run clock that only counts time actually playing, and
      checked server-side for shape, sane duration, a start near the
      spawn, and no teleports between samples (`app/services/ghosts.py`).
      The result modal shows your time and the record ("New record!").

- [x] Dying restarts the level from the beginning (`scene.restart()`,
      which `create()` already resets every piece of runtime state for
      - collected keys, swap state, position history) instead of
      leaving the player stuck on a frozen, non-interactive screen.
- [x] A visitor never sees the "Tab to switch to Edit Mode" hint or has
      the Tab/touch-toggle actually do anything - both are now gated