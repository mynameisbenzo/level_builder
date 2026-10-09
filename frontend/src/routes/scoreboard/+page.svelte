<script lang="ts">
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import { auth } from '$lib/auth.svelte';
	import Navbar from '$lib/Navbar.svelte';
	import {
		ENDLESS_DIFFICULTY_CHOICES,
		ENDLESS_DIFFICULTY_LABELS,
		getScoreboard,
		parseServerTime,
		SCOREBOARD_PAGE_SIZE,
		type EndlessDifficulty,
		type ScoreboardEntry
	} from '$lib/endlessApi';

	// Anyone can look at the board; signing in only marks your own runs.
	let difficulty = $state<EndlessDifficulty>('any');
	let loadState: 'loading' | 'ready' | 'error' = $state('loading');
	let loadError = $state('');
	let entries = $state<ScoreboardEntry[]>([]);
	let total = $state(0);
	let loadingMore = $state(false);

	// Switching tabs while an earlier request is still in flight must not
	// let the slower one overwrite the newer board.
	let requestId = 0;

	async function load(reset: boolean) {
		const mine = ++requestId;
		if (reset) {
			loadState = 'loading';
			entries = [];
			total = 0;
		} else {
			loadingMore = true;
		}

		const result = await getScoreboard(difficulty, {
			offset: reset ? 0 : entries.length,
			accessToken: auth.accessToken
		});
		if (mine !== requestId) return;
		loadingMore = false;

		if (!result.success || !result.board) {
			loadState = 'error';
			loadError = result.error ?? 'Could not load the scoreboard.';
			return;
		}

		entries = reset ? result.board.entries : [...entries, ...result.board.entries];
		total = result.board.total;
		loadState = 'ready';
	}

	function chooseDifficulty(choice: EndlessDifficulty) {
		if (choice === difficulty) return;
		difficulty = choice;
		void load(true);
	}

	onMount(() => {
		const requested = new URLSearchParams(window.location.search).get('difficulty');
		if (requested && (ENDLESS_DIFFICULTY_CHOICES as readonly string[]).includes(requested)) {
			difficulty = requested as EndlessDifficulty;
		}
		void load(true);
	});

	function playScoreboard() {
		goto(auth.isLoggedIn ? '/endless?mode=scoreboard' : '/signup');
	}

	function formatDate(iso: string | null): string {
		return iso ? parseServerTime(iso).toLocaleDateString() : '';
	}

	const hasMore = $derived(entries.length < total);
</script>

<svelte:head>
	<title>High Scores · Pixel Maker</title>
</svelte:head>

<Navbar />

<main>
	<h1>High Scores</h1>
	<p class="subhead">
		Every finished scoreboard run, best first. Each run is 5 lives; every level cleared scores points.
	</p>

	<div class="tabs" role="tablist" aria-label="Difficulty">
		{#each ENDLESS_DIFFICULTY_CHOICES as choice (choice)}
			<button
				class="tab"
				class:selected={difficulty === choice}
				role="tab"
				aria-selected={difficulty === choice}
				onclick={() => chooseDifficulty(choice)}
			>
				{ENDLESS_DIFFICULTY_LABELS[choice]}
			</button>
		{/each}
	</div>

	{#if loadState === 'loading'}
		<p class="muted">Loading…</p>
	{:else if loadState === 'error'}
		<p class="error">{loadError}</p>
		<button class="secondary" onclick={() => load(true)}>Try again</button>
	{:else if entries.length === 0}
		<section class="card empty">
			<p>No scores on the {ENDLESS_DIFFICULTY_LABELS[difficulty]} board yet. Be the first!</p>
			<button class="primary" onclick={playScoreboard}>Play scoreboard mode</button>
		</section>
	{:else}
		<ol class="board">
			{#each entries as entry, index (`${index}-${entry.username}-${entry.ended_at}`)}
				<li class="row" class:you={entry.is_you}>
					<span class="rank">{entry.rank}</span>
					<span class="name">
						<a href={`/u/${entry.username}`}>{entry.username}</a>
						{#if entry.is_you}<span class="you-tag">you</span>{/if}
					</span>
					<span class="levels">
						{entry.levels_cleared}
						{entry.levels_cleared === 1 ? 'level' : 'levels'}
					</span>
					<span class="date">{formatDate(entry.ended_at)}</span>
					<span class="score">{entry.score}</span>
				</li>
			{/each}
		</ol>

		{#if hasMore}
			<button class="secondary more" onclick={() => load(false)} disabled={loadingMore}>
				{loadingMore ? 'Loading…' : `Show ${Math.min(SCOREBOARD_PAGE_SIZE, total - entries.length)} more`}
			</button>
		{/if}

		<div class="play">
			<button class="primary" onclick={playScoreboard}>Play scoreboard mode</button>
		</div>
	{/if}
</main>

<style>
	:global(body) {
		background: #1a1b3a;
		color: #f4f6ff;
	}

	main {
		max-width: 720px;
		margin: 0 auto;
		padding: 40px 24px;
	}

	h1 {
		font-family: 'Baloo 2', sans-serif;
		font-weight: 800;
		font-size: clamp(2rem, 5vw, 2.8rem);
		margin: 0 0 12px;
	}

	.subhead {
		color: #c7cbef;
		line-height: 1.6;
		margin: 0 0 24px;
	}

	.muted {
		color: #8b8fc7;
	}

	.error {
		color: #ff8a7a;
		font-size: 0.9rem;
	}

	.tabs {
		display: flex;
		flex-wrap: wrap;
		gap: 8px;
		margin-bottom: 24px;
	}

	.tab {
		font-family: 'Baloo 2', sans-serif;
		font-weight: 700;
		font-size: 0.95rem;
		padding: 6px 14px;
		color: #f4f6ff;
		background: transparent;
		border: 3px solid #3a3d76;
		border-radius: 10px;
		cursor: pointer;
	}

	.tab:hover:not(.selected) {
		border-color: #6b6f9e;
	}

	.tab.selected {
		color: #142013;
		background: #ffd23f;
		border-color: #142013;
	}

	.card {
		background: #252650;
		border: 2px solid #3a3d76;
		border-radius: 8px;
		padding: 24px;
	}

	.empty p {
		margin: 0 0 16px;
	}

	.board {
		list-style: none;
		margin: 0;
		padding: 0;
		background: #252650;
		border: 2px solid #3a3d76;
		border-radius: 8px;
		overflow: hidden;
	}

	.row {
		display: grid;
		grid-template-columns: 2.5rem 1fr auto auto 4rem;
		align-items: center;
		gap: 12px;
		padding: 10px 16px;
		border-bottom: 1px solid #3a3d76;
	}

	.row:last-child {
		border-bottom: none;
	}

	.row.you {
		background: rgba(255, 210, 63, 0.12);
	}

	.rank {
		font-family: 'Baloo 2', sans-serif;
		font-weight: 800;
		color: #ffd23f;
	}

	.name {
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.name a {
		color: #f4f6ff;
		text-decoration: none;
		font-weight: 700;
	}

	.name a:hover {
		text-decoration: underline;
	}

	.you-tag {
		margin-left: 8px;
		font-size: 0.7rem;
		font-weight: 700;
		text-transform: uppercase;
		color: #142013;
		background: #ffd23f;
		border-radius: 4px;
		padding: 1px 6px;
	}

	.levels,
	.date {
		color: #8b8fc7;
		font-size: 0.85rem;
		white-space: nowrap;
	}

	.score {
		font-family: 'Baloo 2', sans-serif;
		font-weight: 800;
		font-size: 1.3rem;
		text-align: right;
	}

	.more {
		margin-top: 16px;
	}

	.play {
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

	/* On a phone the date and level count don't fit beside the score. */
	@media (max-width: 520px) {
		main {
			padding: 28px 16px;
		}

		.row {
			grid-template-columns: 2rem 1fr 3.5rem;
		}

		.levels,
		.date {
			display: none;
		}
	}
</style>