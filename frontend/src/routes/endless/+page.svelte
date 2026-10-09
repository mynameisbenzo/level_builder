<script lang="ts">
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import { auth } from '$lib/auth.svelte';
	import Navbar from '$lib/Navbar.svelte';
	import {
		describeAnyPoints,
		ENDLESS_DIFFICULTY_CHOICES,
		ENDLESS_DIFFICULTY_LABELS,
		formatTimeUntil,
		getEndlessStatus,
		parseServerTime,
		startEndlessRun,
		type EndlessDifficulty,
		type EndlessMode,
		type EndlessStatus
	} from '$lib/endlessApi';
	import { withSession } from '$lib/endlessSession';

	let loadState: 'loading' | 'ready' | 'error' = $state('loading');
	let loadError = $state('');
	let status = $state<EndlessStatus | null>(null);

	// Endless (lives until you run out) or scoreboard (5 lives, scored for
	// the high-score board). /endless?mode=scoreboard opens on the latter.
	let mode = $state<EndlessMode>('endless');
	let difficulty: EndlessDifficulty = $state('any');
	let paidLives = $state(100);

	// True once the person has chosen "Start over" on the resume prompt -
	// what makes the next start send replace: true and forfeit the old run.
	let startingOver = $state(false);
	let starting = $state(false);
	let startError = $state('');

	const hasActiveRun = $derived(status?.active_run != null);
	const showPicker = $derived(!hasActiveRun || startingOver);
	const pool = $derived(status?.pool ?? null);
	const poolExhausted = $derived(pool !== null && pool.remaining <= 0);
	const isScoreboard = $derived(mode === 'scoreboard');
	// How many levels each choice could serve in the chosen mode (the
	// scoreboard only serves levels that already have a difficulty label).
	const counts = $derived(
		(isScoreboard ? status?.scoreboard.difficulties : status?.difficulties) ?? {}
	);
	// A scoreboard run is always the same length, so a free account needs
	// a whole run's lives left in today's pool.
	const scoreboardLives = $derived(status?.scoreboard.lives ?? 5);
	const poolTooLow = $derived(
		isScoreboard && pool !== null && pool.remaining < scoreboardLives
	);
	const cannotStart = $derived(isScoreboard ? poolTooLow : poolExhausted);

	// A free account starts with 10 lives, or whatever's left of today's
	// pool if that's less (see _starting_lives_for on the backend).
	const freeStartingLives = $derived(
		status && pool ? Math.min(status.lives.default, pool.remaining) : (status?.lives.default ?? 0)
	);

	async function loadStatus() {
		const result = await withSession((token) => getEndlessStatus(token));

		if (result === null) {
			// Session gone (or never there) - endless is accounts-only.
			goto('/signup');
			return;
		}

		if (!result.success || !result.data) {
			loadState = 'error';
			loadError = result.error ?? 'Could not load endless mode.';
			return;
		}

		status = result.data;
		paidLives = result.data.lives.default;
		preselectDifficulty();
		loadState = 'ready';
	}

	/** Pre-selects the first choice that can actually serve a level in this mode. */
	function preselectDifficulty() {
		if ((counts[difficulty] ?? 0) > 0) return;
		const firstAvailable = ENDLESS_DIFFICULTY_CHOICES.find((choice) => (counts[choice] ?? 0) > 0);
		if (firstAvailable) difficulty = firstAvailable;
	}

	function chooseMode(next: EndlessMode) {
		mode = next;
		startError = '';
		preselectDifficulty();
	}

	onMount(() => {
		if (!auth.isLoggedIn) {
			// Same "present the option, send non-users to sign up" rule as
			// the entry button on the home page - this is the real guard
			// for anyone who types the URL in directly.
			goto('/signup');
			return;
		}
		if (new URLSearchParams(window.location.search).get('mode') === 'scoreboard') {
			mode = 'scoreboard';
		}
		void loadStatus();
	});

	function levelCount(choice: EndlessDifficulty): number {
		return counts[choice] ?? 0;
	}

	function clampLives(value: number): number {
		if (!status) return value;
		if (Number.isNaN(value)) return status.lives.default;
		return Math.min(status.lives.max, Math.max(status.lives.min, Math.round(value)));
	}

	async function handleStart() {
		if (!status || starting) return;

		starting = true;
		startError = '';

		const result = await withSession((token) =>
			startEndlessRun(token, {
				mode,
				difficulty,
				// A scoreboard run's length is fixed; only an endless run lets a
				// paid account pick it.
				startingLives:
					!isScoreboard && status!.lives.adjustable ? clampLives(paidLives) : undefined,
				replace: startingOver
			})
		);

		if (result === null) {
			goto('/login');
			return;
		}

		if (result.success) {
			await goto('/endless/play');
			return;
		}

		starting = false;

		if (result.code === 'active_run_exists') {
			// Another tab started a run since this page loaded - show the
			// resume prompt for it instead of failing.
			await loadStatus();
			startingOver = false;
			return;
		}

		if (
			(result.code === 'daily_pool_exhausted' || result.code === 'daily_pool_too_low') &&
			status &&
			result.pool
		) {
			status = { ...status, pool: result.pool };
		}

		startError = result.error ?? 'Could not start a run. Please try again.';
	}
</script>

<svelte:head>
	<title>Endless Mode · Pixel Maker</title>
</svelte:head>

<Navbar />

<main>
	<h1>{isScoreboard ? 'Scoreboard Mode' : 'Endless Mode'}</h1>
	<p class="subhead">
		{#if isScoreboard}
			A run is {scoreboardLives} lives. Clear as many levels as you can: each clear scores points,
			and every death (or skip) costs a life. When the run ends, your score goes on the board.
		{:else}
			Play random levels back to back until you run out of lives. Clear a level to move on; every
			death (or skip) costs a life.
		{/if}
		<a class="board-link" href="/scoreboard">View the high scores</a>
	</p>

	{#if loadState === 'loading'}
		<p class="muted">Loading…</p>
	{:else if loadState === 'error'}
		<p class="error">{loadError}</p>
		<button class="secondary" onclick={() => { loadState = 'loading'; void loadStatus(); }}>
			Try again
		</button>
	{:else if status}
		{#if hasActiveRun && !startingOver && status.active_run}
			<section class="card">
				<h2>You have {status.active_run.mode === 'scoreboard' ? 'a scoreboard' : 'a'} run in progress</h2>
				<p class="muted">
					{#if status.active_run.mode === 'scoreboard'}
						Score {status.active_run.score} ·
					{/if}
					{status.active_run.lives_remaining}
					{status.active_run.lives_remaining === 1 ? 'life' : 'lives'} left ·
					{status.active_run.levels_cleared}
					{status.active_run.levels_cleared === 1 ? 'level' : 'levels'} cleared
				</p>
				<p class="note">
					If you left in the middle of a level, picking it back up may cost you a life.
				</p>
				<div class="actions">
					<button class="primary" onclick={() => goto('/endless/play')}>Resume</button>
					<button class="secondary" onclick={() => (startingOver = true)}>Start over</button>
				</div>
			</section>
		{/if}

		{#if showPicker}
			<section class="card">
				{#if startingOver}
					<p class="warning">
						Starting a new run ends your current one. The lives you've already used stay used.
					</p>
				{/if}

				<div class="mode-toggle" role="group" aria-label="Mode">
					<button
						class="mode"
						class:selected={!isScoreboard}
						aria-pressed={!isScoreboard}
						onclick={() => chooseMode('endless')}
					>
						Endless
					</button>
					<button
						class="mode"
						class:selected={isScoreboard}
						aria-pressed={isScoreboard}
						onclick={() => chooseMode('scoreboard')}
					>
						Scoreboard
					</button>
				</div>

				<h2>Difficulty</h2>
				<div class="difficulty-grid">
					{#each ENDLESS_DIFFICULTY_CHOICES as choice (choice)}
						<button
							class="difficulty"
							class:selected={difficulty === choice}
							disabled={levelCount(choice) === 0}
							onclick={() => (difficulty = choice)}
						>
							<span class="difficulty-name">{ENDLESS_DIFFICULTY_LABELS[choice]}</span>
							<span class="difficulty-count">
								{levelCount(choice) === 0 ? 'no levels yet' : `${levelCount(choice)} levels`}
							</span>
						</button>
					{/each}
				</div>

				{#if isScoreboard && difficulty === 'any'}
					<p class="muted points-note">
						In Any, a clear is worth the level's difficulty: {describeAnyPoints(status.scoreboard.points)}.
					</p>
				{:else if isScoreboard}
					<p class="muted points-note">Every clear is worth 1 point.</p>
				{/if}

				<h2>Lives</h2>
				{#if isScoreboard}
					<p class="lives-fixed">
						{scoreboardLives} lives this run
					</p>
				{:else if status.lives.adjustable}
					<label class="lives-field">
						<span>Start with</span>
						<input
							type="number"
							min={status.lives.min}
							max={status.lives.max}
							bind:value={paidLives}
							onblur={() => (paidLives = clampLives(paidLives))}
						/>
						<span class="muted">({status.lives.min}–{status.lives.max})</span>
					</label>
				{:else}
					<p class="lives-fixed">
						{poolExhausted ? 0 : freeStartingLives}
						{freeStartingLives === 1 ? 'life' : 'lives'} this run
					</p>
				{/if}

				{#if pool}
					<p class="muted pool">
						Daily lives: {pool.remaining} of {pool.daily_limit} left · refreshes in
						{formatTimeUntil(parseServerTime(pool.resets_at))}
					</p>
				{/if}

				{#if poolExhausted}
					<p class="warning">
						You've used all your endless lives for today. They refresh in
						{formatTimeUntil(parseServerTime(pool!.resets_at))}.
					</p>
				{:else if poolTooLow}
					<p class="warning">
						A scoreboard run needs {scoreboardLives} lives and you have {pool!.remaining} left
						today. They refresh in {formatTimeUntil(parseServerTime(pool!.resets_at))}.
					</p>
				{/if}

				{#if startError}
					<p class="error">{startError}</p>
				{/if}

				<div class="actions">
					<button
						class="primary"
						onclick={handleStart}
						disabled={starting || cannotStart || levelCount(difficulty) === 0}
					>
						{starting ? 'Starting…' : isScoreboard ? 'Start scoreboard run' : 'Start run'}
					</button>
					{#if startingOver}
						<button class="secondary" onclick={() => (startingOver = false)}>Cancel</button>
					{/if}
				</div>
			</section>
		{/if}
	{/if}
</main>

<style>
	:global(body) {
		background: #1a1b3a;
		color: #f4f6ff;
	}

	main {
		max-width: 640px;
		margin: 0 auto;
		padding: 40px 24px;
	}

	h1 {
		font-family: 'Baloo 2', sans-serif;
		font-weight: 800;
		font-size: clamp(2rem, 5vw, 2.8rem);
		margin: 0 0 12px;
	}

	h2 {
		font-family: 'Baloo 2', sans-serif;
		font-weight: 700;
		font-size: 1.2rem;
		margin: 0 0 12px;
	}

	.subhead {
		color: #c7cbef;
		line-height: 1.6;
		margin: 0 0 28px;
	}

	.card {
		background: #252650;
		border: 2px solid #3a3d76;
		border-radius: 8px;
		padding: 24px;
		margin-bottom: 20px;
	}

	.muted {
		color: #8b8fc7;
		font-size: 0.9rem;
	}

	.note {
		color: #c7cbef;
		font-size: 0.85rem;
	}

	.pool {
		margin: 16px 0 0;
	}

	.board-link {
		display: inline-block;
		margin-left: 6px;
		color: #ffd23f;
	}

	.mode-toggle {
		display: flex;
		gap: 10px;
		margin-bottom: 20px;
	}

	.mode {
		flex: 1;
		font-family: 'Baloo 2', sans-serif;
		font-weight: 700;
		font-size: 1rem;
		padding: 8px 12px;
		color: #f4f6ff;
		background: transparent;
		border: 3px solid #3a3d76;
		border-radius: 10px;
		cursor: pointer;
	}

	.mode.selected {
		color: #142013;
		background: #ffd23f;
		border-color: #142013;
	}

	.points-note {
		margin: -12px 0 20px;
		line-height: 1.5;
	}

	.error {
		color: #ff8a7a;
		font-size: 0.9rem;
	}

	.warning {
		color: #ffd23f;
		font-size: 0.9rem;
		line-height: 1.5;
	}

	.difficulty-grid {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(140px, 1fr));
		gap: 10px;
		margin-bottom: 24px;
	}

	.difficulty {
		display: flex;
		flex-direction: column;
		gap: 2px;
		text-align: left;
		color: #f4f6ff;
		background: transparent;
		border: 3px solid #3a3d76;
		border-radius: 10px;
		padding: 10px 12px;
		cursor: pointer;
		font-family: 'Baloo 2', sans-serif;
		transition:
			border-color 0.15s ease,
			background 0.15s ease;
	}

	.difficulty:hover:not(:disabled) {
		border-color: #6b6f9e;
	}

	.difficulty.selected {
		color: #142013;
		background: #ffd23f;
		border-color: #142013;
	}

	.difficulty:disabled {
		opacity: 0.4;
		cursor: not-allowed;
	}

	.difficulty-name {
		font-weight: 700;
		font-size: 1rem;
	}

	.difficulty-count {
		font-size: 0.75rem;
		font-family: 'Manrope', sans-serif;
	}

	.lives-field {
		display: flex;
		align-items: center;
		gap: 10px;
	}

	.lives-field input {
		width: 80px;
		font-size: 1rem;
		padding: 6px 8px;
		color: #f4f6ff;
		background: #1a1b3a;
		border: 2px solid #3a3d76;
		border-radius: 6px;
	}

	.lives-fixed {
		margin: 0;
		font-size: 1.05rem;
	}

	.actions {
		display: flex;
		gap: 12px;
		margin-top: 24px;
	}

	button.primary,
	button.secondary {
		font-family: 'Baloo 2', sans-serif;
		font-weight: 700;
		font-size: 1rem;
		padding: 10px 24px;
		border-radius: 8px;
		cursor: pointer;
	}

	button.primary {
		color: #142013;
		background: #4ecb71;
		border: 2px solid #4ecb71;
	}

	button.secondary {
		color: #c7cbef;
		background: transparent;
		border: 2px solid #3a3d76;
	}

	button:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}
</style>