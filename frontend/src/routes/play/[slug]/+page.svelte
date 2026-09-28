<script lang="ts">
	import { onDestroy, onMount, tick } from 'svelte';
	import Phaser from 'phaser';
	import { getLevelForPlay } from '$lib/api';
	import { createGameConfig } from '$lib/game/gameConfig';
	import TouchControls from '$lib/game/TouchControls.svelte';
	import LandscapeGuard from '$lib/game/LandscapeGuard.svelte';
	import type { PageProps } from './$types';

	let { params }: PageProps = $props();
	const slug = $derived(params.slug);

	let gameContainer: HTMLDivElement = $state()!;
	let game: Phaser.Game | undefined;

	let loadStatus: 'loading' | 'ready' | 'error' = $state('loading');
	let loadError = $state('');
	let title = $state('');

	onMount(async () => {
		const result = await getLevelForPlay(slug);

		if (!result.success || !result.content) {
			loadStatus = 'error';
			loadError = result.error ?? 'This level could not be found.';
			return;
		}

		title = result.title ?? '';
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
	});

	onDestroy(() => {
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
			<TouchControls />
			<LandscapeGuard />
			<div class="game-container" bind:this={gameContainer}></div>
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
	}

	.game-container :global(canvas) {
		display: block;
	}
</style>