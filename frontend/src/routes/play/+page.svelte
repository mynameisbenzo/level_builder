<script lang="ts">
	import { onDestroy, onMount } from 'svelte';
	import Phaser from 'phaser';
	import { createGameConfig } from '$lib/game/gameConfig';
	import TouchControls from '$lib/game/TouchControls.svelte';
	import LandscapeGuard from '$lib/game/LandscapeGuard.svelte';

	let gameContainer: HTMLDivElement;
	let game: Phaser.Game | undefined;

	onMount(() => {
		game = new Phaser.Game(createGameConfig(gameContainer));
	});

	onDestroy(() => {
		game?.destroy(true);
	});
</script>

<div class="game-page">
	<TouchControls />
	<LandscapeGuard />
	<div class="game-container" bind:this={gameContainer}></div>
</div>

<style>
	.game-page {
		width: 100vw;
		height: 100dvh;
		overflow: hidden;
		background: #000;
		/* Without these, a real touchscreen intercepts touch-and-drag
		   gestures for its own native scroll/pan behavior before they
		   ever reach Phaser as pointer events - this is what breaks
		   touch-drag placement in the Editor. touch-action: none stops
		   that; the rest stop a tap-and-hold from triggering text
		   selection or (on iOS specifically) the long-press context
		   menu. Applied at the page level, not just the canvas, so the
		   on-screen touch controls get the same protection - holding the
		   jump button shouldn't trigger selection either. */
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