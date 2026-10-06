<script lang="ts">
	import { onDestroy, onMount, tick } from 'svelte';
	import Phaser from 'phaser';
	import { getLevelForPlay, recordLevelCompletion, recordLevelPlay } from '$lib/api';
	import { auth } from '$lib/auth.svelte';
	import { withSession } from '$lib/endlessSession';
	import { createGameConfig } from '$lib/game/gameConfig';
	import {
		GHOST_REGISTRY_KEY,
		GHOST_SAMPLE_INTERVAL_MS,
		type GhostRun,
		type RecordedRun
	} from '$lib/game/ghost';
	import { LEVEL_BEATEN_EVENT, LEVEL_DIED_EVENT } from '$lib/game/PlatformerScene';
	import { getLevelGhost, submitLevelGhost } from '$lib/ghostApi';
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

	// Set the moment a playthrough ends (win or death) - see
	// LEVEL_BEATEN_EVENT/LEVEL_DIED_EVENT. null means no modal is
	// showing, i.e. the game is still in progress.
	let resultOutcome: 'won' | 'died' | null = $state(null);

	// Ghost: the fastest recorded clear of this level's current version,
	// replayed alongside the player. Updated in place when a clear beats
	// it, so "Replay" races the new record straight away.
	let levelVersion = 0;
	let ghost: GhostRun | null = null;
	// What the result modal shows for a win: this attempt's time and the
	// standing record (isNew when this very run just set it).
	let runTimeMs: number | null = $state(null);
	let recordInfo: { username: string; durationMs: number; isNew: boolean } | null = $state(null);

	async function handleGhostRun(run: RecordedRun) {
		runTimeMs = run.durationMs;
		// Until (or unless) this run is submitted, the standing record is
		// whichever ghost was loaded.
		recordInfo = ghost
			? { username: ghost.username, durationMs: ghost.durationMs, isNew: false }
			: null;

		// Only an account can hold a record - an anonymous win just
		// shows the time against the existing one.
		if (!auth.accessToken) return;

		const result = await withSession((token) =>
			submitLevelGhost(slug, token, {
				version: levelVersion,
				durationMs: run.durationMs,
				frames: run.frames
			})
		);
		if (!result?.success || !result.record) return;

		recordInfo = {
			username: result.record.username,
			durationMs: result.record.durationMs,
			isNew: result.isRecord === true
		};

		if (result.isRecord && auth.user) {
			ghost = {
				username: auth.user.username,
				durationMs: run.durationMs,
				sampleIntervalMs: GHOST_SAMPLE_INTERVAL_MS,
				version: levelVersion,
				frames: run.frames
			};
		} else {
			// Not a record - but someone may have set a newer one than the
			// ghost loaded at page load, so pick up whatever stands now.
			const fresh = await getLevelGhost(slug);
			if (fresh.success) ghost = fresh.ghost ?? null;
		}
	}

	function handleLevelBeaten(run?: RecordedRun) {
		resultOutcome = 'won';
		if (run) void handleGhostRun(run);
		// Best-effort, fire-and-forget - a metrics call failing shouldn't
		// block or interrupt the win screen the player is already looking
		// at (see recordLevelCompletion's own comment). Passing the access
		// token (when logged in) is what lets the backend recognize the
		// level's own owner and skip counting their own playthrough.
		void recordLevelCompletion(slug, auth.accessToken ?? undefined);
	}

	function handleLevelDied() {
		resultOutcome = 'died';
	}

	function handleReplay() {
		resultOutcome = null;
		runTimeMs = null;
		recordInfo = null;
		// Seeded before the restart so create() sees the current record.
		if (ghost) {
			game?.registry.set(GHOST_REGISTRY_KEY, ghost);
		} else {
			game?.registry.remove(GHOST_REGISTRY_KEY);
		}
		// create() resets every runtime field (hasWon, hasDied, position,
		// collected keys, ...) on every (re)start, same as the editor's
		// own "test my level" flow already relied on - restarting is
		// what actually puts the player back at the level's real spawn
		// point, not just closing the modal.
		game?.scene.getScene('PlatformerScene')?.scene.restart();
		// A conscious "Play Again" is a genuine new attempt at the level,
		// same as the very first load below - counted the same way
		// (including the same owner-exclusion via the access token).
		void recordLevelPlay(slug, auth.accessToken ?? undefined);
	}

	onMount(async () => {
		const [result, ghostResult] = await Promise.all([getLevelForPlay(slug), getLevelGhost(slug)]);

		if (!result.success || !result.content) {
			loadStatus = 'error';
			loadError = result.error ?? 'This level could not be found.';
			return;
		}

		levelVersion = result.version ?? 0;
		// A ghost recorded against a different version than the one just
		// loaded (republished between the two requests) would run through
		// walls - better none than that.
		ghost =
			ghostResult.success && ghostResult.ghost && ghostResult.ghost.version === result.version
				? ghostResult.ghost
				: null;

		title = result.title ?? '';
		ownerUsername = result.ownerUsername ?? '';
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
				ghost: ghost ?? undefined
			})
		);
		game.events.on(LEVEL_BEATEN_EVENT, handleLevelBeaten);
		game.events.on(LEVEL_DIED_EVENT, handleLevelDied);

		// The level actually loaded and a real playthrough is starting -
		// counted the same way as a later "Play Again" (see handleReplay).
		void recordLevelPlay(slug, auth.accessToken ?? undefined);
	});

	onDestroy(() => {
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
					timeMs={runTimeMs}
					record={recordInfo}
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