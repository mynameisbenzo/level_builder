<script lang="ts">
	import { onDestroy, onMount, tick } from 'svelte';
	import Phaser from 'phaser';
	import { getLevelForPlay, recordLevelCompletion, recordLevelPlay } from '$lib/api';
	import { auth } from '$lib/auth.svelte';
	import { withSession } from '$lib/endlessSession';
	import { createGameConfig } from '$lib/game/gameConfig';
	import { readCheckpointState } from '$lib/game/checkpoints';
	import {
		clearedRunsDurationMs,
		emptyGhostSet,
		GHOST_KINDS,
		GHOSTS_REGISTRY_KEY,
		type ClearedRuns,
		type GhostSet
	} from '$lib/game/ghost';
	import { LEVEL_BEATEN_EVENT, LEVEL_DIED_EVENT } from '$lib/game/PlatformerScene';
	import { getLevelGhost, submitLevelGhost } from '$lib/ghostApi';
	import { PLAYTIME_HEARTBEAT_INTERVAL_MS } from '$lib/game/playtime';
	import { getLevelRecord, postLevelPlaytime, submitLevelWin } from '$lib/playtimeApi';
	import type { PlatformerScene } from '$lib/game/PlatformerScene';
	import TouchControls from '$lib/game/TouchControls.svelte';
	import LandscapeGuard from '$lib/game/LandscapeGuard.svelte';
	import LevelResultModal from './LevelResultModal.svelte';
	import type { PageProps } from './$types';

	let { params }: PageProps = $props();
	const slug = $derived(params.slug);

	let gameContainer: HTMLDivElement = $state()!;
	let game: Phaser.Game | undefined;

	let loadStatus: 'loading' | 'ready' | 'error' = $state('loading');
	let loadError = $state('');
	let title = $state('');
	let ownerUsername = $state('');
	let difficulty: string | null = $state(null);

	// Set the moment a playthrough ends (win or death) - see
	// LEVEL_BEATEN_EVENT/LEVEL_DIED_EVENT. null means no modal is
	// showing, i.e. the game is still in progress.
	let resultOutcome: 'won' | 'died' | null = $state(null);

	// Ghosts: the fastest recorded clears of this level, replayed alongside
	// the player - one full ghost, or on a level with a checkpoint a before
	// and an after ghost. Refreshed after a clear, so "Replay" races the
	// new record straight away.
	let ghosts: GhostSet = emptyGhostSet();
	// What the result modal shows for a win: the player's total playtime
	// across every try (null for an anonymous player, who has no total),
	// this last attempt's clear time, and the level's playtime record
	// (isNew when this very clear just set it).
	let totalMs: number | null = $state(null);
	let runTimeMs: number | null = $state(null);
	let recordInfo: { username: string; totalMs: number; isNew: boolean } | null = $state(null);
	// The record standing when the page loaded / after the last clear.
	let standingRecord: { username: string; totalMs: number } | null = null;

	// Ghost submission is separate from the record: the ghost is the
	// replayed route, the record is the total playtime.
	async function handleGhostRun(cleared: ClearedRuns) {
		runTimeMs = clearedRunsDurationMs(cleared);

		// Only an account can hold a ghost.
		if (!auth.accessToken) return;

		// A run through a checkpoint is two stretches (before and after),
		// each offered as its own ghost; a run that skipped it is one full
		// stretch.
		for (const kind of GHOST_KINDS) {
			const run = cleared[kind];
			if (!run || run.frames.length === 0) continue;
			await withSession((token) =>
				submitLevelGhost(slug, token, { durationMs: run.durationMs, frames: run.frames }, kind)
			);
		}

		// Pick up whatever ghosts stand now - ours if they were records,
		// or newer ones someone else set since the page loaded.
		const fresh = await getLevelGhost(slug);
		if (fresh.success && fresh.ghosts) ghosts = fresh.ghosts;
	}

	// The playtime record: report the last stretch with the win. The
	// server adds it to the running total, ends the total (the next try
	// starts from zero) and compares it with the record.
	async function handleRecordRun() {
		recordInfo = standingRecord ? { ...standingRecord, isNew: false } : null;
		if (!auth.accessToken) return;

		// A heartbeat might still be on its way; let it land first so the
		// win's report is what comes after it.
		await flushInFlight;
		const scene = game?.scene.getScene('PlatformerScene') as PlatformerScene | undefined;
		const ms = scene && typeof scene.takePlaytimeMs === 'function' ? scene.takePlaytimeMs() : 0;

		const result = await withSession((token) => submitLevelWin(slug, token, ms));
		if (!result?.success) {
			// Not recorded; the player still sees the level record as it stood.
			if (scene && ms > 0) scene.returnPlaytimeMs(ms);
			return;
		}
		totalMs = result.totalMs ?? null;
		if (result.record) {
			standingRecord = result.record;
			recordInfo = { ...result.record, isNew: result.isRecord === true };
		}
	}

	function handleLevelBeaten(cleared?: ClearedRuns) {
		resultOutcome = 'won';
		totalMs = null;
		void handleRecordRun();
		if (cleared) void handleGhostRun(cleared);
		// Best-effort, fire-and-forget - a metrics call failing shouldn't
		// block or interrupt the win screen the player is already looking
		// at (see recordLevelCompletion's own comment). Passing the access
  		// token (when logged in) is what lets the backend also count the
  		// clear toward the level's clear rate.
		void recordLevelCompletion(slug, auth.accessToken ?? undefined);
	}

	// Total playtime: the scene counts the time the player is really
	// playing; this reports it to the server every few seconds (and when
	// the tab is hidden, or the player dies), where the running total
	// lives. Only a logged-in player has a total.
	let playtimeTimer: ReturnType<typeof setInterval> | undefined;

	// The report currently on its way, so a win can wait for it.
	let flushInFlight: Promise<void> = Promise.resolve();

	function flushPlaytime(): Promise<void> {
		flushInFlight = flushInFlight.then(sendPlaytime);
		return flushInFlight;
	}

	async function sendPlaytime() {
		if (!auth.accessToken) return;
		const scene = game?.scene.getScene('PlatformerScene') as PlatformerScene | undefined;
		if (!scene || typeof scene.takePlaytimeMs !== 'function') return;

		const ms = scene.takePlaytimeMs();
		if (ms <= 0) return;

		const result = await withSession((token) => postLevelPlaytime(slug, token, ms));
		// Not reported (offline, logged out): carry the time into the next report.
		if (!result?.success) scene.returnPlaytimeMs(ms);
	}

	function handleVisibilityChange() {
		if (document.hidden) void flushPlaytime();
	}

	function handleLevelDied() {
		void flushPlaytime();
		// A checkpoint was reached: no result modal - straight back into
		// the level at the checkpoint (the scene's own create() puts the
		// player there), counted as a new attempt exactly like "Play Again".
		if (game && readCheckpointState(game.registry) !== null) {
			restartLevel();
			return;
		}
		resultOutcome = 'died';
	}

	function restartLevel() {
		// Seeded before the restart so create() sees the current ghosts.
		game?.registry.set(GHOSTS_REGISTRY_KEY, ghosts);
		// create() resets every runtime field (hasWon, hasDied, position,
		// collected keys, ...) on every (re)start, same as the editor's
		// own "test my level" flow already relied on - restarting is
		// what actually puts the player back at the level's real spawn
		// point (or its checkpoint, if one was reached), not just closing
		// the modal.
		game?.scene.getScene('PlatformerScene')?.scene.restart();
		// A conscious "Play Again" - or a respawn at the checkpoint - is a
		// genuine new attempt at the level, same as the very first load
  		// below - counted the same way (the access token is what lets the
  		// backend also count it toward the clear rate).
		void recordLevelPlay(slug, auth.accessToken ?? undefined);
	}

	function handleReplay() {
		resultOutcome = null;
		runTimeMs = null;
		totalMs = null;
		recordInfo = null;
		restartLevel();
	}

	onMount(async () => {
		const [result, ghostResult, recordResult] = await Promise.all([
			getLevelForPlay(slug),
			getLevelGhost(slug),
			getLevelRecord(slug)
		]);

		if (!result.success || !result.content) {
			loadStatus = 'error';
			loadError = result.error ?? 'This level could not be found.';
			return;
		}

		ghosts = ghostResult.success ? (ghostResult.ghosts ?? emptyGhostSet()) : emptyGhostSet();

		standingRecord = recordResult.success ? (recordResult.record ?? null) : null;

		title = result.title ?? '';
		ownerUsername = result.ownerUsername ?? '';
		difficulty = result.difficulty ?? null;
		loadStatus = 'ready';

		// Same reasoning as /edit/[slug] - loadStatus just flipped to
		// 'ready', which is what makes the {#if} block (and
		// gameContainer, the bind:this target inside it) actually exist
		// in the DOM. tick() awaits that Svelte-batched update before
		// gameContainer is safe to use.
		await tick();
		if (!gameContainer) return;

		// startMode: 'play' registers ONLY PlatformerScene (see
		// gameConfig.ts) - a visitor here can never reach the editor for
		// someone else's level, since it's simply never loaded into this
		// game instance at all.
		game = new Phaser.Game(
			createGameConfig(gameContainer, {
				startMode: 'play',
				content: result.content,
				ghosts
			})
		);
		game.events.on(LEVEL_BEATEN_EVENT, handleLevelBeaten);
		game.events.on(LEVEL_DIED_EVENT, handleLevelDied);

		// The level actually loaded and a real playthrough is starting -
		// counted the same way as a later "Play Again" (see handleReplay).
		void recordLevelPlay(slug, auth.accessToken ?? undefined);

		playtimeTimer = setInterval(() => void flushPlaytime(), PLAYTIME_HEARTBEAT_INTERVAL_MS);
		document.addEventListener('visibilitychange', handleVisibilityChange);
	});

	onDestroy(() => {
		clearInterval(playtimeTimer);
		document.removeEventListener('visibilitychange', handleVisibilityChange);
		void flushPlaytime();
		game?.events.off(LEVEL_BEATEN_EVENT, handleLevelBeaten);
		game?.events.off(LEVEL_DIED_EVENT, handleLevelDied);
		game?.destroy(true);
	});
</script>

<svelte:head>
	<title>{title ? title : 'Pixel Maker'}</title>
</svelte:head>

{#key slug}
	{#if loadStatus === 'loading'}
		<div class="status-page">
			<p>Loading…</p>
		</div>
	{:else if loadStatus === 'error'}
		<div class="status-page">
			<p class="error">{loadError}</p>
			<a href="/">Back home</a>
		</div>
	{:else}
		<div class="game-page">
			<TouchControls allowModeToggle={false} />
			<LandscapeGuard />
			<div class="game-container" bind:this={gameContainer}></div>
			{#if resultOutcome}
				<LevelResultModal
					outcome={resultOutcome}
					{slug}
					{ownerUsername}
					onReplay={handleReplay}
					{totalMs}
					timeMs={runTimeMs}
					record={recordInfo}
					{difficulty}
				/>
			{/if}
		</div>
	{/if}
{/key}

<style>
	.status-page {
		min-height: 100dvh;
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		gap: 16px;
		background: #1a1b3a;
		color: #f4f6ff;
	}

	.status-page a {
		color: #4ecb71;
	}

	.error {
		color: #ff8a7a;
	}

	.game-page {
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
		/* touch-action isn't inherited from .game-page above - measured
		   directly in a real browser, the computed touch-action on this
		   element and the canvas inside it was still "auto" despite
		   .game-page's "none", which is exactly what let a touch-drag on
		   the canvas fall through to the browser's own text-selection
		   gesture. Repeated here and on the canvas itself (below) rather
		   than trusted to cascade down. */
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
</style>