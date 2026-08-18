<script lang="ts">
	import { onDestroy, onMount } from 'svelte';
	import Phaser from 'phaser';
	import { createGameConfig } from '$lib/game/gameConfig';

	let gameContainer: HTMLDivElement;
	let game: Phaser.Game | undefined;

	onMount(() => {
		game = new Phaser.Game(createGameConfig(gameContainer));
	});

	onDestroy(() => {
		game?.destroy(true);
	});
</script>

<h1>Level Builder — Playtest</h1>
<p>WASD or Arrow Keys to move. W or Up to jump. Tab to toggle Play/Edit mode.</p>

<div bind:this={gameContainer}></div>