<script lang="ts">
	import { onDestroy, onMount } from 'svelte';

	// Exact frame coordinates pulled from the game's own asset atlases
	// (spritesheet-tiles-default.xml / spritesheet-characters-default.xml
	// / the standalone editor cursor icons) - this is the same grass
	// tile, the same green character, and the same select/eraser cursors
	// the actual Editor uses, not separate illustrations.
	const TILES_SHEET = '/assets/kenney/platformer-pack/Spritesheets/spritesheet-tiles-default.png';
	const CHARACTERS_SHEET =
		'/assets/kenney/platformer-pack/Spritesheets/spritesheet-characters-default.png';
	const SELECT_CURSOR = '/assets/icons/select-cursor.png';
	const ERASER_CURSOR = '/assets/icons/eraser.png';

	const TILE_SIZE = 64;
	// Character sprite frames (all 128x128, from spritesheet-characters-default.xml)
	const CHAR_FRAME = {
		idle: '0px -258px',
		walkA: '-258px -258px',
		walkB: '-387px -258px',
		jump: '-129px -258px'
	};

	type Phase = 'walk-in' | 'walk-to-edge' | 'jump' | 'walk-to-exit' | 'paused';
	let phase: Phase = $state('walk-in');
	let walkFrameToggle: 'a' | 'b' = $state('a');
	let editorModeActive = $state(false);
	// Which of the 3 landing-spot tiles (columns 6, 7, 8) are currently
	// placed - built during the jump, erased after the character exits.
	let landingTiles = $state([false, false, false]);
	let cursorVisible = $state(false);
	let cursorTool: 'select' | 'eraser' = $state('select');
	let cursorCol = $state(6);
	let reducedMotion = $state(false);

	// The whole animation is choreographed in this fixed pixel "world" -
	// matches .world's own width/height in the styles below. Rather
	// than rewrite every hardcoded position/keyframe to be relative
	// (a much bigger, riskier change), .world is scaled down as a
	// whole via a CSS transform when the actual stage is narrower than
	// this, so every position/timing value stays exactly as designed.
	const REFERENCE_WIDTH = 576;
	const REFERENCE_HEIGHT = 200;
	let stageEl: HTMLDivElement;
	let scale = $state(1);

	function updateScale() {
		if (!stageEl) return;
		// Capped at 1 so this never scales UP past the design size on
		// wide screens - redundant given .stage's own max-width already
		// prevents clientWidth from exceeding REFERENCE_WIDTH, but
		// cheap insurance against a transient measurement during resize.
		scale = Math.min(stageEl.clientWidth / REFERENCE_WIDTH, 1);
	}

	const characterBackgroundPosition = $derived.by(() => {
		if (phase === 'jump') {
			return CHAR_FRAME.jump;
		}
		// Walk-cycle only while actually moving forward - walk-in,
		// walk-to-edge, walk-to-exit. Any other moment (including
		// 'paused', off-screen between exiting and the erase sequence)
		// shows the idle pose instead, never a frozen mid-stride frame.
		if (phase === 'walk-in' || phase === 'walk-to-edge' || phase === 'walk-to-exit') {
			return walkFrameToggle === 'a' ? CHAR_FRAME.walkA : CHAR_FRAME.walkB;
		}
		return CHAR_FRAME.idle;
	});

	let walkInterval: ReturnType<typeof setInterval> | undefined;
	let sequenceTimeouts: ReturnType<typeof setTimeout>[] = [];
	let resizeObserver: ResizeObserver | undefined;

	function schedule(fn: () => void, delayMs: number) {
		sequenceTimeouts.push(setTimeout(fn, delayMs));
	}

	// The full loop, expressed as one chain of scheduled state changes -
	// each call to schedule() is one beat of the choreography described
	// in the design (walk to the edge, jump while the Editor builds a
	// landing spot, walk off, then the Editor erases what it built).
	function runLoop() {
		phase = 'walk-in';
		landingTiles = [false, false, false];
		cursorVisible = false;
		editorModeActive = false;

		schedule(() => {
			phase = 'walk-to-edge';
		}, 1000);

		schedule(() => {
			phase = 'jump';
			editorModeActive = true;
			cursorTool = 'select';
			cursorVisible = true;
			cursorCol = 6;
		}, 3000);

		schedule(() => {
			landingTiles = [true, false, false];
			cursorCol = 7;
		}, 3500);

		schedule(() => {
			landingTiles = [true, true, false];
			cursorCol = 8;
		}, 3750);

		schedule(() => {
			landingTiles = [true, true, true];
			cursorVisible = false;
		}, 4000);

		schedule(() => {
			phase = 'walk-to-exit';
			editorModeActive = false;
		}, 4400);

		schedule(() => {
			phase = 'paused';
		}, 5500);

		schedule(() => {
			editorModeActive = true;
			cursorTool = 'eraser';
			cursorVisible = true;
			cursorCol = 6;
		}, 5700);

		schedule(() => {
			landingTiles = [false, true, true];
			cursorCol = 7;
		}, 6200);

		schedule(() => {
			landingTiles = [false, false, true];
			cursorCol = 8;
		}, 6500);

		schedule(() => {
			landingTiles = [false, false, false];
			cursorVisible = false;
		}, 6800);

		schedule(() => {
			editorModeActive = false;
		}, 7200);

		schedule(runLoop, 7500);
	}

	onMount(() => {
		updateScale();
		resizeObserver = new ResizeObserver(updateScale);
		resizeObserver.observe(stageEl);

		reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
		if (reducedMotion) {
			// A single, still, representative frame instead of the
			// animated sequence - the character standing on the built
			// landing platform, having already crossed the gap.
			landingTiles = [true, true, true];
			return;
		}
		walkInterval = setInterval(() => {
			walkFrameToggle = walkFrameToggle === 'a' ? 'b' : 'a';
		}, 250);
		runLoop();
	});

	onDestroy(() => {
		if (walkInterval) clearInterval(walkInterval);
		for (const id of sequenceTimeouts) clearTimeout(id);
		resizeObserver?.disconnect();
	});
</script>

<div
	class="stage"
	class:editor-mode={editorModeActive}
	bind:this={stageEl}
	style:height="{REFERENCE_HEIGHT * scale}px"
	role="img"
	aria-label="An animated demonstration: a green platformer character walks onto a starting platform, walks across it, jumps a gap, the level editor builds a new platform mid-air for it to land on, the character continues off-screen, and the editor then erases what it built, looping."
>
	<div class="world" style:transform="scale({scale})">
		<div class="grid-overlay" class:visible={editorModeActive}></div>

		<div class="strip">
			{#each [0, 1, 2] as i (i)}
				<div
					class="tile"
					class:left={i === 0}
					class:right={i === 2}
					style:background-image="url({TILES_SHEET})"
				></div>
			{/each}
		</div>

		<div class="strip landing" style:left="{6 * TILE_SIZE}px">
			{#each [0, 1, 2] as i (i)}
				{#if landingTiles[i]}
					<div
						class="tile pop"
						class:left={i === 0}
						class:right={i === 2}
						style:background-image="url({TILES_SHEET})"
					></div>
				{:else}
					<div class="tile-spacer"></div>
				{/if}
			{/each}
		</div>

		{#if cursorVisible}
			<div
				class="cursor"
				style:left="{cursorCol * TILE_SIZE + TILE_SIZE / 2 - 16}px"
				style:background-image="url({cursorTool === 'select' ? SELECT_CURSOR : ERASER_CURSOR})"
			></div>
		{/if}

		<div
			class="character"
			class:reduced-motion={reducedMotion}
			class:phase-walk-in={phase === 'walk-in'}
			class:phase-walk-1={phase === 'walk-to-edge'}
			class:phase-jump={phase === 'jump'}
			class:phase-walk-2={phase === 'walk-to-exit'}
			style:background-image="url({CHARACTERS_SHEET})"
			style:background-position={characterBackgroundPosition}
		></div>
	</div>
</div>

<style>
	.stage {
		position: relative;
		width: 100%;
		max-width: 576px;
		margin-inline: auto;
		overflow: hidden;
	}

	/* Fixed at the animation's actual design size - every existing
	   position/keyframe value below is written against this exact
	   576x200 coordinate space and stays completely untouched. .stage
	   scales this down as a whole via `transform: scale()` (set inline,
	   computed in the script from the stage's real rendered width) when
	   the actual viewport is narrower, rather than rewriting any of the
	   choreography to be relative. transform-origin: top left so the
	   scaled content stays anchored to .stage's own top-left corner,
	   matching how .stage's own height already shrinks in lockstep
	   (see the inline height style above) - without that, .stage's
	   box would still be full-height while the scaled content sits
	   inside a shorter visual area, leaving empty space below it. */
	.world {
		position: relative;
		width: 576px;
		height: 200px;
		transform-origin: top left;
	}

	.grid-overlay {
		position: absolute;
		inset: 0;
		opacity: 0;
		transition: opacity 0.25s ease;
		background-image:
			linear-gradient(to right, rgba(107, 111, 158, 0.35) 1px, transparent 1px),
			linear-gradient(to bottom, rgba(107, 111, 158, 0.35) 1px, transparent 1px);
		background-size: 64px 64px;
		pointer-events: none;
	}

	.grid-overlay.visible {
		opacity: 1;
	}

	.strip {
		position: absolute;
		bottom: 0;
		left: 0;
		display: flex;
		image-rendering: pixelated;
	}

	.tile {
		flex: 0 0 64px;
		width: 64px;
		height: 64px;
		/* terrain_grass_horizontal_middle: x=130 y=650 */
		background-position: -130px -650px;
		background-repeat: no-repeat;
	}

	.tile.left {
		/* terrain_grass_horizontal_left: x=65 y=650 */
		background-position: -65px -650px;
	}

	.tile.right {
		/* terrain_grass_horizontal_right: x=325 y=650 */
		background-position: -325px -650px;
	}

	.tile.pop {
		animation: tile-pop 0.25s ease-out;
	}

	.tile-spacer {
		flex: 0 0 64px;
		width: 64px;
		height: 64px;
	}

	@keyframes tile-pop {
		0% {
			transform: scale(0.3);
			opacity: 0;
		}
		70% {
			transform: scale(1.15);
			opacity: 1;
		}
		100% {
			transform: scale(1);
		}
	}

	.cursor {
		position: absolute;
		top: 24px;
		width: 32px;
		height: 32px;
		background-repeat: no-repeat;
		image-rendering: pixelated;
		transition: left 0.3s ease;
		filter: drop-shadow(0 2px 3px rgba(0, 0, 0, 0.4));
	}

	.character {
		position: absolute;
		/* Default/off-screen position - matches where phase-walk-2 ends,
		   so the character sits safely out of view during the 'paused'
		   phase (between walking off and the erase sequence starting),
		   when no phase-specific animation is currently active to
		   override this. */
		left: 608px;
		bottom: 64px;
		width: 128px;
		height: 128px;
		background-repeat: no-repeat;
		image-rendering: pixelated;
	}

	.character.phase-walk-in {
		animation: walk-in 1s linear forwards;
	}

	.character.phase-walk-1 {
		animation: walk-1 1s linear forwards;
	}

	.character.phase-jump {
		animation: jump-arc 0.7s ease-in-out forwards;
	}

	.character.phase-walk-2 {
		animation: walk-2 1.75s linear forwards;
	}

	@keyframes walk-in {
		0% {
			left: -128px;
		}
		100% {
			left: 0px;
		}
	}

	@keyframes walk-1 {
		0% {
			left: 0px;
		}
		100% {
			left: 128px;
		}
	}

	@keyframes jump-arc {
		0% {
			left: 128px;
			bottom: 64px;
		}
		50% {
			left: 256px;
			bottom: 132px;
		}
		100% {
			left: 384px;
			bottom: 64px;
		}
	}

	@keyframes walk-2 {
		0% {
			left: 384px;
		}
		100% {
			left: 608px;
		}
	}

	.character.reduced-motion {
		animation: none !important;
		left: 384px;
	}

	@media (prefers-reduced-motion: reduce) {
		.tile.pop {
			animation: none;
		}
		.cursor {
			transition: none;
		}
	}
</style>