<script lang="ts">
	import { onDestroy, onMount, tick } from 'svelte';
	import Phaser from 'phaser';
	import { getLevelForPlay } from '$lib/api';
	import { createGameConfig } from '$lib/game/gameConfig';
	import { LEVEL_BEATEN_EVENT, LEVEL_DIED_EVENT } from '$lib/game/PlatformerScene';
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

	function handleLevelBeaten() {
		resultOutcome = 'won';
	}

	function handleLevelDied() {
		resultOutcome = 'died';
	}

	function handleReplay() {
		resultOutcome = null;
		// create() resets every runtime field (hasWon, hasDied, position,
		// collected keys, ...) on every (re)start, same as the editor's
		// own "test my level" flow already relied on - restarting is
		// what actually puts the player back at the level's real spawn
		// point, not just closing the modal.
		game?.scene.getScene('PlatformerScene')?.scene.restart();
	}

	onMount(async () => {
		const result = await getLevelForPlay(slug);

		if (!result.success || !result.content) {
			loadStatus = 'error';
			loadError = result.error ?? 'This level could not be found.';
			return;
		}

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
			createGameConfig(gameContainer, { startMode: 'play', content: result.content })
		);
		game.events.on(LEVEL_BEATEN_EVENT, handleLevelBeaten);
		game.events.on(LEVEL_DIED_EVENT, handleLevelDied);
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