<script lang="ts">
	import { onDestroy, onMount, tick } from 'svelte';
	import { goto } from '$app/navigation';
	import Phaser from 'phaser';
	import { getLevelForPlay } from '$lib/api';
	import { auth } from '$lib/auth.svelte';
	import CharacterPortrait from '$lib/CharacterPortrait.svelte';
	import {
		beginEndlessAttempt,
		formatTimeUntil,
		getEndlessStatus,
		parseServerTime,
		quitEndlessRun,
		reportEndlessClear,
		reportEndlessDeath,
		sendEndlessHeartbeat,
		skipEndlessLevel,
		type EndlessCurrentLevel,
		type EndlessResult,
		type EndlessRun
	} from '$lib/endlessApi';
	import { withSession } from '$lib/endlessSession';
	import { createGameConfig } from '$lib/game/gameConfig';
	import { readCheckpointCarry, type CheckpointCarry } from '$lib/game/checkpoints';
	import { emptyGhostSet, GHOST_KINDS, type ClearedRuns, type GhostSet } from '$lib/game/ghost';
	import { LEVEL_BEATEN_EVENT, LEVEL_DIED_EVENT } from '$lib/game/PlatformerScene';
	import { getLevelGhost, submitLevelGhost } from '$lib/ghostApi';
	import { PLAYTIME_HEARTBEAT_INTERVAL_MS } from '$lib/game/playtime';
	import { PlaytimeReporter } from '$lib/game/playtimeReporter';
	import { postLevelPlaytime, submitLevelWin } from '$lib/playtimeApi';
	import type { PlatformerScene } from '$lib/game/PlatformerScene';
	import LandscapeGuard from '$lib/game/LandscapeGuard.svelte';
	import TouchControls from '$lib/game/TouchControls.svelte';

	// How long the "who made this" screen holds before a level starts.
	const INTERSTITIAL_MS = 2000;
	// After a life is lost: how long before the counter ticks down...
	const COUNTER_DELAY_MS = 500;
	// ...and how long the new number sits before the next step.
	const HOLD_MS = 1000;
	// On the final death: how long the zeroed counter sits before the
	// game-over banner drops in.
	const GAME_OVER_DELAY_MS = 1200;
	// Matches record_heartbeat's expectations on the backend (~10s).
	const HEARTBEAT_INTERVAL_MS = 10_000;

	type Phase = 'loading' | 'interstitial' | 'playing' | 'gameover' | 'no-levels' | 'error';

	let phase: Phase = $state('loading');
	let run = $state<EndlessRun | null>(null);
	// The level the interstitial is showing. Kept separately from
	// run.current_level because the run no longer has one once its last
	// life is gone - the game-over screen still needs to show where you died.
	let shownLevel = $state<EndlessCurrentLevel | null>(null);
	let displayedLives = $state(0);
	let hit = $state(false);
	let errorMessage = $state('');
	let retryAction = $state<(() => void) | null>(null);

	// The level currently being played - what a cleared run's ghost
	// submission is filed under - and the ghosts (fastest clears) it races.
	let currentSlug = '';
	let currentGhosts: GhostSet = emptyGhostSet();
	// A checkpoint the player reached on a level they then died on. Every
	// death boots a brand-new game, so it's carried here between them and
	// seeded back in - for the same level only (see startLevel).
	let checkpointCarry: { slug: string; carry: CheckpointCarry } | null = null;

	let gameContainer: HTMLDivElement | undefined = $state();
	let game: Phaser.Game | undefined;
	let heartbeatTimer: ReturnType<typeof setInterval> | null = null;
	let playtimeTimer: ReturnType<typeof setInterval> | null = null;

	// Total playtime (shared with /play - one running total per player and
	// level, and a clear updates the level's record). The scene counts the
	// time under control; every death boots a new game, so what it counted
	// is taken out before the game goes, and the reporter sends it in order
	// and carries anything that could not be delivered.
	const playtime = new PlaytimeReporter({
		heartbeat: async (slug, ms) => {
			const result = await withSession((token) => postLevelPlaytime(slug, token, ms));
			return result?.success === true;
		},
		win: (slug, ms) => withSession((token) => submitLevelWin(slug, token, ms))
	});

	// Every transition takes a new generation; an async step that wakes up
	// to find the generation has moved on (a skip/quit mid-timer, or the
	// page closing) quietly stops instead of acting on stale state.
	let generation = 0;
	let destroyed = false;

	const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

	function stopHeartbeat() {
		if (heartbeatTimer !== null) {
			clearInterval(heartbeatTimer);
			heartbeatTimer = null;
		}
		if (playtimeTimer !== null) {
			clearInterval(playtimeTimer);
			playtimeTimer = null;
		}
	}

	/** Takes the playtime the running game has counted since the last report (0 if none). */
	function takePlaytime(): number {
		const scene = game?.scene.getScene('PlatformerScene') as PlatformerScene | undefined;
		return scene && typeof scene.takePlaytimeMs === 'function' ? scene.takePlaytimeMs() : 0;
	}

	function flushPlaytime() {
		const ms = takePlaytime();
		if (ms > 0 && currentSlug) void playtime.report(currentSlug, ms);
	}

	function handleVisibilityChange() {
		if (document.hidden) flushPlaytime();
	}

	function teardownGame() {
		// Whatever the game counted but has not reported goes out before it
		// is destroyed (a win takes its time first, see handleBeaten).
		flushPlaytime();
		stopHeartbeat();
		if (game) {
			game.events.off(LEVEL_BEATEN_EVENT, handleBeaten);
			game.events.off(LEVEL_DIED_EVENT, handleDied);
			game.destroy(true);
			game = undefined;
		}
	}

	function fail(message: string, retry: (() => void) | null = null) {
		teardownGame();
		errorMessage = message;
		retryAction = retry;
		phase = 'error';
	}

	/** Runs an API call; on a dead session sends the person to log in. Null means "already redirected". */
	async function api<T>(fn: (token: string) => Promise<EndlessResult<T>>) {
		const result = await withSession(fn);
		if (result === null) {
			goto('/login');
		}
		return result;
	}

	function adoptRun(next: EndlessRun) {
		run = next;
	}

	// ── Screens ─────────────────────────────────────────────────────────

	function showInterstitial() {
		if (!run?.current_level) {
			phase = 'no-levels';
			return;
		}

		const myGeneration = ++generation;
		shownLevel = run.current_level;
		displayedLives = run.lives_remaining;
		phase = 'interstitial';

		void sleep(INTERSTITIAL_MS).then(() => {
			if (destroyed || generation !== myGeneration) return;
			void startLevel();
		});
	}

	function showGameOver() {
		teardownGame();
		checkpointCarry = null;
		++generation;
		phase = 'gameover';
	}

	// ── Level lifecycle ─────────────────────────────────────────────────

	async function startLevel() {
		const level = run?.current_level;
		if (!level) {
			phase = 'no-levels';
			return;
		}

		const myGeneration = ++generation;

		const [content, ghostResult] = await Promise.all([
			getLevelForPlay(level.slug),
			getLevelGhost(level.slug)
		]);
		if (destroyed || generation !== myGeneration) return;
		if (!content.success || !content.content) {
			fail(content.error ?? 'This level could not be loaded.', () => void startLevel());
			return;
		}

		// The level is loaded and play is about to start - only now does
		// the backend count an attempt (an interstitial that's merely
		// shown never costs a life, see begin_attempt).
		const begun = await api(beginEndlessAttempt);
		if (destroyed || generation !== myGeneration || begun === null) return;
		if (!begun.success || !begun.data) {
			fail(begun.error ?? 'Could not start this level.', () => void startLevel());
			return;
		}

		currentSlug = level.slug;
		currentGhosts = ghostResult.success ? (ghostResult.ghosts ?? emptyGhostSet()) : emptyGhostSet();

		adoptRun(begun.data);
		if (!begun.data.is_active) {
			// Settling an earlier abandoned attempt just used the last life.
			displayedLives = 0;
			showGameOver();
			return;
		}
		displayedLives = begun.data.lives_remaining;

		phase = 'playing';
		await tick();
		if (destroyed || generation !== myGeneration || !gameContainer) return;

		game = new Phaser.Game(
			createGameConfig(gameContainer, {
				startMode: 'play',
				content: content.content,
				ghosts: currentGhosts,
				// A death restarts the same level at its checkpoint if it
				// was reached; a different level starts clean.
				checkpoint:
					checkpointCarry && checkpointCarry.slug === level.slug
						? checkpointCarry.carry
						: undefined
			})
		);
		game.events.on(LEVEL_BEATEN_EVENT, handleBeaten);
		game.events.on(LEVEL_DIED_EVENT, handleDied);

		startHeartbeat();
		playtimeTimer = setInterval(flushPlaytime, PLAYTIME_HEARTBEAT_INTERVAL_MS);
	}

	function startHeartbeat() {
		stopHeartbeat();
		// Immediately, then on a timer - an attempt with no heartbeat gets
		// no grace period if it's abandoned (see record_heartbeat).
		void beat();
		heartbeatTimer = setInterval(() => void beat(), HEARTBEAT_INTERVAL_MS);
	}

	async function beat() {
		// Best-effort: one missed beat just narrows the grace window.
		await withSession((token) => sendEndlessHeartbeat(token));
	}

	/**
	 * Best-effort: offers each stretch of a cleared run as the level's
	 * ghost of that kind (one full run, or a before and an after half
	 * through a checkpoint); the backend keeps each only if it's the fastest.
	 */
	function submitGhosts(cleared: ClearedRuns) {
		const slug = currentSlug;
		for (const kind of GHOST_KINDS) {
			const run = cleared[kind];
			if (!run || run.frames.length === 0) continue;
			void withSession((token) =>
				submitLevelGhost(slug, token, { durationMs: run.durationMs, frames: run.frames }, kind)
			);
		}
	}

	async function handleBeaten(cleared?: ClearedRuns) {
		if (phase !== 'playing') return;
		const myGeneration = ++generation;
		// The last stretch of playtime goes out with the win: the server
		// adds it to the player's total for this level, ends the total and
		// offers it as the level's record. Taken before the game goes.
		const winSlug = currentSlug;
		const winMs = takePlaytime();
		teardownGame();
		phase = 'interstitial';
		// A retry of a failed clear report has nothing left to send.
		if (!retryingClear) void playtime.win(winSlug, winMs);
		retryingClear = false;
		// Only the first report carries the run - a retry of a failed
		// clear report (see handleBeatenRetry) has none, and was already
		// submitted the first time.
		if (cleared) submitGhosts(cleared);
		// The level is done; the next one starts from its own spawn.
		checkpointCarry = null;

		const result = await api(reportEndlessClear);
		if (destroyed || generation !== myGeneration || result === null) return;
		if (!result.success || !result.data) {
			fail(result.error ?? 'Could not record your clear.', () => void handleBeatenRetry());
			return;
		}

		adoptRun(result.data);
		showInterstitial();
	}

	// A failed clear report is retried as-is (the attempt is still
	// pending server-side), not by replaying the level.
	let retryingClear = false;

	async function handleBeatenRetry() {
		phase = 'playing'; // satisfies handleBeaten's guard
		retryingClear = true;
		await handleBeaten();
	}

	async function handleDied() {
		if (phase !== 'playing') return;
		const myGeneration = ++generation;
		// Remember a reached checkpoint before the game (and its registry)
		// is torn down, so the level restarts there - the death still
		// costs a life like any other.
		const carry = game ? readCheckpointCarry(game.registry) : null;
		checkpointCarry = carry ? { slug: currentSlug, carry } : null;
		teardownGame();

		// Back to the same screen as before the attempt, still showing
		// the old life count - the counter ticks down once the death is
		// recorded.
		phase = 'interstitial';
		hit = false;

		const result = await api(reportEndlessDeath);
		if (destroyed || generation !== myGeneration || result === null) return;
		if (!result.success || !result.data) {
			fail(result.error ?? 'Could not record your death.', () => void handleDiedRetry());
			return;
		}

		await settleLifeLost(result.data, myGeneration, false);
	}

	async function handleDiedRetry() {
		phase = 'playing';
		await handleDied();
	}

	/**
	 * The shared "a life was just lost" beat: the counter ticks down with a
	 * quick hit animation, then either the game-over banner drops, the
	 * same level restarts (death), or the next level's interstitial shows
	 * (skip).
	 */
	async function settleLifeLost(next: EndlessRun, myGeneration: number, wasSkip: boolean) {
		await sleep(COUNTER_DELAY_MS);
		if (destroyed || generation !== myGeneration) return;

		adoptRun(next);
		displayedLives = next.lives_remaining;
		hit = true;

		if (!next.is_active) {
			await sleep(GAME_OVER_DELAY_MS);
			if (destroyed || generation !== myGeneration) return;
			showGameOver();
			return;
		}

		await sleep(HOLD_MS);
		if (destroyed || generation !== myGeneration) return;
		hit = false;

		if (wasSkip) {
			showInterstitial();
		} else {
			void startLevel();
		}
	}

	// ── Player actions ──────────────────────────────────────────────────

	async function handleSkip() {
		if (!run || (phase !== 'playing' && phase !== 'interstitial')) return;
		if (!window.confirm('Skip this level? It will cost you a life.')) return;

		const myGeneration = ++generation;
		teardownGame();
		// Skipping moves on to a different level - a checkpoint reached
		// on this one doesn't follow the player there.
		checkpointCarry = null;
		phase = 'interstitial';
		hit = false;
		// Keep showing the level being skipped while the counter ticks.
		if (run.current_level) shownLevel = run.current_level;
		displayedLives = run.lives_remaining;

		const result = await api(skipEndlessLevel);
		if (destroyed || generation !== myGeneration || result === null) return;
		if (!result.success || !result.data) {
			fail(result.error ?? 'Could not skip this level.', () => showInterstitial());
			return;
		}

		await settleLifeLost(result.data, myGeneration, true);
	}

	async function handleQuit() {
		if (!window.confirm('Quit this run? Your progress will be lost.')) return;

		++generation;
		teardownGame();
		const result = await api(quitEndlessRun);
		if (result === null) return;
		await goto('/endless');
	}

	// ── Mount / unmount ─────────────────────────────────────────────────

	onMount(async () => {
		document.addEventListener('visibilitychange', handleVisibilityChange);
		if (!auth.isLoggedIn) {
			goto('/signup');
			return;
		}

		const status = await api(getEndlessStatus);
		if (destroyed || status === null) return;
		if (!status.success || !status.data) {
			fail(status.error ?? 'Could not load your run.', () => location.reload());
			return;
		}

		if (!status.data.active_run) {
			await goto('/endless');
			return;
		}

		adoptRun(status.data.active_run);
		showInterstitial();
	});

	onDestroy(() => {
		document.removeEventListener('visibilitychange', handleVisibilityChange);
		destroyed = true;
		++generation;
		teardownGame();
	});

	const poolResetText = $derived(
		run?.pool ? formatTimeUntil(parseServerTime(run.pool.resets_at)) : ''
	);
</script>

<svelte:head>
	<title>Endless Mode · Pixel Maker</title>
</svelte:head>

{#if phase === 'loading'}
	<div class="screen"><p class="muted">Loading…</p></div>
{:else if phase === 'error'}
	<div class="screen">
		<p class="error">{errorMessage}</p>
		<div class="row">
			{#if retryAction}
				<button class="primary" onclick={() => retryAction?.()}>Try again</button>
			{/if}
			<button class="secondary" onclick={() => goto('/endless')}>Leave</button>
		</div>
	</div>
{:else if phase === 'no-levels'}
	<div class="screen">
		<h1>No more levels</h1>
		<p class="muted">There's nothing left to serve for this run right now.</p>
		<div class="row">
			<button class="secondary" onclick={handleQuit}>End run</button>
		</div>
	</div>
{:else if phase === 'playing'}
	<div class="game-page">
		<TouchControls allowModeToggle={false} />
		<LandscapeGuard />
		<div class="game-container" bind:this={gameContainer}></div>

		<div class="hud lives-hud">
			<CharacterPortrait color={shownLevel?.player_starting_color ?? 'green'} size={32} />
			<span>x {displayedLives}</span>
			{#if run?.mode === 'scoreboard'}
				<span class="score-hud">Score {run.score}</span>
			{/if}
		</div>
		<div class="hud action-hud">
			<button class="hud-button" onclick={handleSkip}>Skip (−1 ♥)</button>
			<button class="hud-button" onclick={handleQuit}>Quit</button>
		</div>
	</div>
{:else}
	<!-- interstitial, and the stage the game-over banner drops onto -->
	<div class="screen interstitial">
		{#if shownLevel}
			<div class="lives" class:hit>
				<CharacterPortrait color={shownLevel.player_starting_color} size={72} />
				{#key displayedLives}
					<span class="lives-count" class:pop={hit}>x {displayedLives}</span>
				{/key}
			</div>

			<div class="banner">
				<h1>{shownLevel.title}</h1>
				<p class="creator">by {shownLevel.owner_username}</p>
				{#if run?.mode === 'scoreboard' && shownLevel.points != null && phase === 'interstitial'}
					<p class="points">Worth {shownLevel.points} {shownLevel.points === 1 ? 'point' : 'points'}</p>
				{/if}
			</div>

			{#if run && phase === 'interstitial'}
				<p class="muted cleared">
					{#if run.mode === 'scoreboard'}
						Score {run.score} ·
					{/if}
					{run.levels_cleared}
					{run.levels_cleared === 1 ? 'level' : 'levels'} cleared
				</p>
				<div class="row">
					<button class="secondary" onclick={handleSkip}>Skip (−1 ♥)</button>
					<button class="secondary" onclick={handleQuit}>Quit</button>
				</div>
			{/if}
		{/if}

		{#if phase === 'gameover' && run}
			<div class="gameover-banner">
				<h2>Game Over</h2>
				{#if run.mode === 'scoreboard'}
					<p class="final-score">Score: <strong>{run.score}</strong></p>
				{/if}
				<p>
					{run.levels_cleared}
					{run.levels_cleared === 1 ? 'level' : 'levels'} cleared · {run.deaths}
					{run.deaths === 1 ? 'death' : 'deaths'}
				</p>
				{#if run.pool}
					<p class="muted">
						{#if run.pool.remaining > 0}
							{run.pool.remaining} of {run.pool.daily_limit} daily lives left.
						{:else}
							You're out of lives for today. They refresh in {poolResetText}.
						{/if}
					</p>
				{/if}
				<div class="row">
					{#if run.mode === 'scoreboard'}
						<button class="primary" onclick={() => goto('/endless?mode=scoreboard')}>New run</button>
						<button
							class="secondary"
							onclick={() => goto(`/scoreboard?difficulty=${run?.difficulty ?? 'any'}`)}
						>
							High scores
						</button>
					{:else}
						<button class="primary" onclick={() => goto('/endless')}>New run</button>
					{/if}
					<button class="secondary" onclick={() => goto('/')}>Home</button>
				</div>
			</div>
		{/if}
	</div>
{/if}

<style>
	:global(body) {
		background: #1a1b3a;
		color: #f4f6ff;
	}

	.screen {
		position: relative;
		min-height: 100dvh;
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		gap: 20px;
		padding: 24px;
		text-align: center;
		overflow: hidden;
	}

	.muted {
		color: #8b8fc7;
		margin: 0;
	}

	.error {
		color: #ff8a7a;
	}

	.row {
		display: flex;
		gap: 12px;
	}

	h1 {
		font-family: 'Baloo 2', sans-serif;
		font-weight: 800;
		font-size: clamp(1.8rem, 5vw, 2.8rem);
		margin: 0;
	}

	.creator {
		margin: 4px 0 0;
		color: #c7cbef;
		font-size: 1.1rem;
	}

	.points {
		margin: 8px 0 0;
		color: #ffd23f;
		font-family: 'Baloo 2', sans-serif;
		font-weight: 700;
	}

	.final-score {
		font-family: 'Baloo 2', sans-serif;
		font-size: 1.4rem;
	}

	.final-score strong {
		color: #ffd23f;
	}

	.lives {
		display: flex;
		align-items: center;
		gap: 14px;
		font-family: 'Baloo 2', sans-serif;
		font-weight: 800;
		font-size: 2.4rem;
	}

	/* The quick "hit" reaction when a life is lost: a shake on the
	   portrait and a pop on the number that just changed. */
	.lives.hit :global(.portrait) {
		animation: shake 0.4s ease;
	}

	.lives-count.pop {
		animation: pop 0.4s ease;
	}

	@keyframes shake {
		0%,
		100% {
			transform: translateX(0);
		}
		20%,
		60% {
			transform: translateX(-8px);
		}
		40%,
		80% {
			transform: translateX(8px);
		}
	}

	@keyframes pop {
		0% {
			transform: scale(1.6);
			color: #ff8a7a;
		}
		100% {
			transform: scale(1);
			color: inherit;
		}
	}

	/* Falls in from above the screen and lands in the center. */
	.gameover-banner {
		position: absolute;
		top: 50%;
		left: 50%;
		translate: -50% -50%;
		width: min(90vw, 380px);
		background: #252650;
		border: 3px solid #ffd23f;
		border-radius: 10px;
		padding: 28px 24px;
		box-shadow: 0 10px 0 rgba(0, 0, 0, 0.4);
		animation: drop 0.8s cubic-bezier(0.34, 1.4, 0.64, 1) both;
		z-index: 10;
	}

	.gameover-banner h2 {
		font-family: 'Baloo 2', sans-serif;
		font-weight: 800;
		font-size: 2rem;
		margin: 0 0 12px;
		color: #ffd23f;
	}

	.gameover-banner p {
		margin: 0 0 10px;
	}

	.gameover-banner .row {
		justify-content: center;
		margin-top: 18px;
	}

	@keyframes drop {
		from {
			transform: translateY(-100vh);
		}
		to {
			transform: translateY(0);
		}
	}

	button.primary,
	button.secondary,
	.hud-button {
		font-family: 'Baloo 2', sans-serif;
		font-weight: 700;
		font-size: 0.95rem;
		padding: 9px 20px;
		border-radius: 8px;
		cursor: pointer;
	}

	button.primary {
		color: #142013;
		background: #4ecb71;
		border: 2px solid #4ecb71;
	}

	button.secondary {
		color: #c7cbef;
		background: transparent;
		border: 2px solid #3a3d76;
	}

	.game-page {
		position: relative;
		width: 100vw;
		height: 100dvh;
		overflow: hidden;
		background: #000;
		touch-action: none;
		user-select: none;
		-webkit-user-select: none;
		-webkit-touch-callout: none;
	}

	.game-container {
		width: 100%;
		height: 100%;
		touch-action: none;
		user-select: none;
		-webkit-user-select: none;
		-webkit-touch-callout: none;
	}

	.game-container :global(canvas) {
		display: block;
		touch-action: none;
		user-select: none;
		-webkit-user-select: none;
		-webkit-touch-callout: none;
	}

	.hud {
		position: absolute;
		top: calc(8px + env(safe-area-inset-top, 0px));
		z-index: 20;
		display: flex;
		align-items: center;
		gap: 8px;
	}

	.lives-hud {
		left: 12px;
		font-family: 'Baloo 2', sans-serif;
		font-weight: 800;
		font-size: 1.3rem;
		color: #f4f6ff;
		text-shadow: 0 2px 0 rgba(0, 0, 0, 0.6);
		pointer-events: none;
	}

	.score-hud {
		margin-left: 10px;
		color: #ffd23f;
	}

	.action-hud {
		right: 12px;
	}

	.hud-button {
		font-size: 0.8rem;
		padding: 5px 10px;
		color: #f4f6ff;
		background: rgba(26, 27, 58, 0.75);
		border: 2px solid #3a3d76;
	}
</style>