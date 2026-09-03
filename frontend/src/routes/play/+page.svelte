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
	}

	.game-container {
		width: 100%;
		height: 100%;
	}

	.game-container :global(canvas) {
		display: block;
	}
</style>