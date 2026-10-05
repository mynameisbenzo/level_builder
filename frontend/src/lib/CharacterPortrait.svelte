<script lang="ts">
	/**
	 * A character's HUD portrait (the "helmet" frames from the tiles
	 * spritesheet - the same ones the in-game HUD shows, see
	 * getPlayerHudFrame), drawn with plain CSS so Svelte screens like the
	 * endless interstitial don't need a Phaser canvas just for one icon.
	 * Frame coordinates come straight from spritesheet-tiles-default.xml.
	 */
	const FRAMES: Record<string, { x: number; y: number }> = {
		beige: { x: 1105, y: 260 },
		green: { x: 0, y: 325 },
		pink: { x: 65, y: 325 },
		purple: { x: 130, y: 325 },
		yellow: { x: 195, y: 325 }
	};

	const FRAME_SIZE = 64;
	const SHEET_SIZE = 1169;

	let { color, size = 64 }: { color: string; size?: number } = $props();

	const frame = $derived(FRAMES[color] ?? FRAMES.green);
	const scale = $derived(size / FRAME_SIZE);
</script>

<div
	class="portrait"
	role="img"
	aria-label="{color} character"
	style:width="{size}px"
	style:height="{size}px"
	style:background-size="{SHEET_SIZE * scale}px {SHEET_SIZE * scale}px"
	style:background-position="-{frame.x * scale}px -{frame.y * scale}px"
></div>

<style>
	.portrait {
		background-image: url('/assets/kenney/platformer-pack/Spritesheets/spritesheet-tiles-default.png');
		background-repeat: no-repeat;
		image-rendering: pixelated;
		flex-shrink: 0;
	}
</style>