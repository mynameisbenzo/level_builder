<script lang="ts">
	import { difficultyDisplay } from './difficulty';

	/**
	 * A level's difficulty label as a small coloured badge - or, while the
	 * level hasn't had enough registered attempts for a label, a muted
	 * "Not enough plays yet". `label` is whatever the API sent (the label
	 * string or null).
	 */
	let { label = null }: { label?: string | null } = $props();

	const display = $derived(difficultyDisplay(label));
</script>

<span class="difficulty difficulty-{display.label ?? 'none'}" title="Difficulty">
	{display.text}
</span>

<style>
	.difficulty {
		font-size: 0.78rem;
		font-weight: 700;
		white-space: nowrap;
	}

	.difficulty-none {
		color: #8b8fc7;
		font-weight: 400;
	}

	.difficulty-easy {
		color: #4ecb71;
	}

	.difficulty-normal {
		color: #ffd23f;
	}

	.difficulty-hard {
		color: #ff9f43;
	}

	.difficulty-very_hard {
		color: #ff6b6b;
	}

	.difficulty-tas {
		color: #c78bff;
	}
</style>