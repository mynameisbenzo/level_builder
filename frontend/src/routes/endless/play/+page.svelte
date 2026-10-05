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
	import { LEVEL_BEATEN_EVENT, LEVEL_DIED_EVENT } from '$lib/game/PlatformerScene';
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

	let gameContainer: HTMLDivElement | undefined = $state();
	let game: Phaser.Game | undefined;
	let heartbeatTimer: ReturnType<typeof setInterval> | null = null;

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
	}

	function teardownGame() {
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

		const content = await getLevelForPlay(level.slug);
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
			createGameConfig(gameContainer, { startMode: 'play', content: content.content })
		);
		game.events.on(LEVEL_BEATEN_EVENT, handleBeaten);
		game.events.on(LEVEL_DIED_EVENT, handleDied);

		startHeartbeat();
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

	async function handleBeaten() {
		if (phase !== 'playing') return;
		const myGeneration = ++generation;
		teardownGame();
		phase = 'interstitial';

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
	async function handleBeatenRetry() {
		phase = 'playing'; // satisfies handleBeaten's guard
		await handleBeaten();
	}

	async function handleDied() {
		if (phase !== 'playing') return;
		const myGeneration = ++generation;
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
			</div>

			{#if run && phase === 'interstitial'}
				<p class="muted cleared">
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
					<button class="primary" onclick={() => goto('/endless')}>New run</button>
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