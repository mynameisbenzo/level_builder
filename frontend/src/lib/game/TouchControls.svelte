<script lang="ts">
	import { setTouchDirection, setTouchJump, requestModeToggle } from './touchInput';
	import { currentMode } from './currentMode';

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
                class="btn btn-round"
                aria-label="Move left"
                onpointerdown={press(() => setTouchDirection('left', true))}
                onpointerup={press(() => setTouchDirection('left', false))}
                onpointercancel={press(() => setTouchDirection('left', false))}
                onpointerleave={press(() => setTouchDirection('left', false))}
            >
                ◀︎
            </button>
            <button
                class="btn btn-round"
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
		</div>
	{/if}

	<button
		class="btn btn-toggle"
		aria-label="Switch between Play and Edit mode"
		onpointerdown={press(() => requestModeToggle())}
	>
		⇄
	</button>
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
}

.cluster-right {
	right: calc(12px + env(safe-area-inset-right, 0px));
}

.btn-jump {
	background: rgba(255, 107, 107, 0.7);
}

.btn-toggle {
	position: fixed;
	top: calc(16px + env(safe-area-inset-top, 0px));
	right: calc(16px + env(safe-area-inset-right, 0px));
	width: 48px;
	height: 48px;
	border-radius: 8px;
	font-size: 1.2rem;
	background: rgba(0, 217, 255, 0.7);
}
</style>