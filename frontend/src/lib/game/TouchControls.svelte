<script lang="ts">
	import {
		setTouchDirection,
		setTouchJump,
		setTouchDash,
		setTouchDuck,
		requestModeToggle
	} from './touchInput';
	import { currentMode } from './currentMode';

	// Defaults to true (the editor's own "test my level" flow, which
	// registers both scenes) - /play/[slug] passes false, since a public
	// play-through has no Edit Mode to switch to at all (see
	// gameConfig.ts and the matching guards in PlatformerScene).
	let { allowModeToggle = true }: { allowModeToggle?: boolean } = $props();

	function press(action: () => void) {
		return (event: PointerEvent) => {
			event.preventDefault();
			action();
		};
	}
</script>

<div class="touch-controls">
	{#if $currentMode === 'play'}
		<div class="cluster cluster-left">
			<button
                class="btn btn-round btn-left"
                aria-label="Move left"
                onpointerdown={press(() => setTouchDirection('left', true))}
                onpointerup={press(() => setTouchDirection('left', false))}
                onpointercancel={press(() => setTouchDirection('left', false))}
                onpointerleave={press(() => setTouchDirection('left', false))}
            >
                ◀︎
            </button>
			<button
				class="btn btn-round btn-duck"
				aria-label="Duck"
				onpointerdown={press(() => setTouchDuck(true))}
				onpointerup={press(() => setTouchDuck(false))}
				onpointercancel={press(() => setTouchDuck(false))}
				onpointerleave={press(() => setTouchDuck(false))}
			>
				▼
			</button>
            <button
                class="btn btn-round btn-right"
                aria-label="Move right"
                onpointerdown={press(() => setTouchDirection('right', true))}
                onpointerup={press(() => setTouchDirection('right', false))}
                onpointercancel={press(() => setTouchDirection('right', false))}
                onpointerleave={press(() => setTouchDirection('right', false))}
            >
                ▶︎
            </button>
		</div>

		<div class="cluster cluster-right">
			<button
				class="btn btn-round btn-jump"
				aria-label="Jump"
				onpointerdown={press(() => setTouchJump(true))}
				onpointerup={press(() => setTouchJump(false))}
				onpointercancel={press(() => setTouchJump(false))}
				onpointerleave={press(() => setTouchJump(false))}
			>
				▲
			</button>
			<button
				class="btn btn-round btn-dash"
				aria-label="Dash"
				onpointerdown={press(() => setTouchDash(true))}
				onpointerup={press(() => setTouchDash(false))}
				onpointercancel={press(() => setTouchDash(false))}
				onpointerleave={press(() => setTouchDash(false))}
			>
				»
			</button>
		</div>
	{/if}

	{#if allowModeToggle}
		<button
			class="btn btn-toggle"
			aria-label="Switch between Play and Edit mode"
			onpointerdown={press(() => requestModeToggle())}
		>
			⇄
		</button>
	{/if}
</div>

<style>
.touch-controls {
	display: none;
}

/* Only shown on touch-capable devices - desktop mouse users don't need
   these buttons cluttering the view. */
@media (pointer: coarse) {
	.touch-controls {
		display: contents;
	}
}

.btn {
	z-index: 500;
	touch-action: none;
	user-select: none;
	-webkit-user-select: none;
	box-sizing: border-box;
	padding: 0;
	margin: 0;
	overflow: hidden;
	line-height: 1;
	font-family: inherit;
	border: 3px solid #f4f1de;
	background: rgba(45, 27, 78, 0.7);
	color: #f4f1de;
	font-size: 1.5rem;
	display: flex;
	align-items: center;
	justify-content: center;
}

.btn-round {
	width: 56px;
	height: 56px;
	border-radius: 50%;
	flex-shrink: 0;
}

.cluster {
	position: fixed;
	bottom: calc(12px + env(safe-area-inset-bottom, 0px));
	display: flex;
	gap: 5px;
}

.cluster-left {
	left: calc(12px + env(safe-area-inset-left, 0px));
	display: grid;
	grid-template-columns: repeat(2, 25px);
	grid-template-rows: repeat(2, 40px);	
}

.cluster-right {
	right: calc(12px + env(safe-area-inset-right, 0px));
	/* Backwards-L layout: top-left cell left empty, jump top-right, dash
	   and duck along the bottom - rather than a plain row, so dash/duck
	   sit closer to the thumb's natural resting position below jump. */
	display: grid;
	grid-template-columns: repeat(2, 52px);
	grid-template-rows: repeat(2, 56px);
}

.btn-left {
	grid-column: 1;
	grid-row: 1;
}

.btn-right {
	grid-column: 3;
	grid-row: 1;
}

.btn-jump {
	grid-column: 1;
	grid-row: 2;
	background: rgba(255, 107, 107, 0.7);
}

.btn-dash {
	grid-column: 2;
	grid-row: 2;
	background: rgba(255, 210, 63, 0.7);
}

.btn-duck {
	grid-column: 2;
	grid-row: 2;
	background: rgba(107, 155, 255, 0.7);
}

.btn-toggle {
	position: fixed;
	/* allowModeToggle is only ever true on pages that also render the
	   Save/Cancel navbar above the game canvas (play/+page.svelte,
	   edit/[slug]/+page.svelte - see the allowModeToggle prop comment
	   above) - that navbar is ~56px tall (the same figure those pages'
	   own .game-page height already accounts for), and this button is
	   position: fixed to the viewport, not to .game-page's own local
	   coordinate space, so it doesn't get pushed down by the navbar's
	   normal document flow the way the canvas below it does. Cleared
	   explicitly here instead. */
	top: calc(56px + env(safe-area-inset-top, 0px) + 10px);
	right: calc(10px + env(safe-area-inset-right, 0px));
	width: 48px;
	height: 48px;
	border-radius: 8px;
	font-size: 1.2rem;
	background: rgba(0, 217, 255, 0.7);
}
</style>