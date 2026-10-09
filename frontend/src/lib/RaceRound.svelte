<script lang="ts">
	import { onDestroy } from 'svelte';
	import { getLevelForPlay } from './api';
	import DifficultyBadge from './DifficultyBadge.svelte';
	import { countdownFace, secondsLeft, SPIN_MS, spinFrames, spinSlugAt } from './raceRound';
	import type { RaceSession } from './raceSession';
	import {
		amHost,
		CATEGORY_LABELS,
		CATEGORY_VALUES,
		me,
		voteCounts,
		type Category,
		type LobbyState
	} from './raceView';

	let { lobby, session }: { lobby: LobbyState; session: RaceSession | null } = $props();

	const room = $derived(lobby.room!);
	const round = $derived(room.round);
	const mine = $derived(me(lobby));
	const host = $derived(amHost(lobby));
	const enoughPlayers = $derived(room.players.length >= 2);

	// A 10 Hz heartbeat drives every timer on screen; it only runs while a
	// round is under way or an idle clock is ticking.
	let tick = $state(0);
	const interval = setInterval(() => (tick += 1), 100);
	onDestroy(() => clearInterval(interval));

	/** The server's clock right now, re-read every tick. */
	const serverNow = $derived.by(() => {
		void tick;
		return session ? session.serverNow() : room.serverNow;
	});

	// ---- ready-up ----------------------------------------------------
	const idleSeconds = $derived(
		mine && !mine.ready && mine.readyBy !== null ? secondsLeft(mine.readyBy, serverNow) : null
	);

	function toggleReady() {
		session?.setReady(!mine?.ready);
	}

	function pickCategory(category: Category) {
		if (room.category !== category) session?.setCategory(category);
	}

	// ---- vote ----------------------------------------------------------
	const counts = $derived(round ? voteCounts(round) : {});
	const myVote = $derived(round && lobby.you ? round.votes[lobby.you.userId] : undefined);
	const voteSeconds = $derived(round ? secondsLeft(round.deadline, serverNow) : null);

	// ---- the spin --------------------------------------------------------
	const frames = $derived(
		round && round.chosen && round.tied.length > 1 ? spinFrames(round.tied, round.chosen, SPIN_MS) : []
	);
	const spinning = $derived(!!round && frames.length > 0 && serverNow < round.revealUntil);
	const lit = $derived.by(() => {
		if (!round || frames.length === 0) return null;
		const elapsed = serverNow - (round.revealUntil - SPIN_MS);
		return spinSlugAt(frames, elapsed);
	});

	const chosenCandidate = $derived(round?.candidates.find((c) => c.slug === round.chosen) ?? null);

	// ---- loading the winner ----------------------------------------------
	let loadError = $state<string | null>(null);
	let startedLoadFor = '';

	$effect(() => {
		if (room.phase !== 'loading' || !round?.chosen || !mine || mine.loaded) return;
		const key = `${round.n}:${round.chosen}`;
		if (startedLoadFor === key) return;
		startedLoadFor = key;
		loadError = null;
		const slug = round.chosen;
		void getLevelForPlay(slug).then((result) => {
			if (result.success && result.content) {
				// Stage 3 hands this level to the game scene; for now loading
				// it successfully is the whole job.
				session?.loaded(slug);
			} else {
				loadError = result.error ?? "The level couldn't be loaded.";
			}
		});
	});

	// ---- countdown ---------------------------------------------------------
	const face = $derived(
		round && round.goAt !== null && (room.phase === 'countdown' || room.phase === 'racing')
			? countdownFace(round.goAt - serverNow)
			: null
	);
</script>

{#if room.phase === 'lobby'}
	<section class="card">
		<h2>Ready up</h2>

		<div class="category">
			<span class="label">Level difficulty</span>
			{#if host}
				<div class="chips" role="radiogroup" aria-label="Level difficulty">
					{#each CATEGORY_VALUES as value (value)}
						<button
							class="chip"
							class:selected={room.category === value}
							role="radio"
							aria-checked={room.category === value}
							onclick={() => pickCategory(value)}>{CATEGORY_LABELS[value]}</button
						>
					{/each}
				</div>
			{:else}
				<strong>{CATEGORY_LABELS[room.category]}</strong>
			{/if}
			<p class="muted small">Every published level can be drawn, labeled or not. Any includes all of them.</p>
		</div>

		{#if !enoughPlayers}
			<p class="muted">Waiting for at least one more player. Share the invite link.</p>
		{:else}
			<p class="muted">
				The vote starts as soon as everyone is ready ({room.players.filter((p) => p.ready).length}/{room
					.players.length} ready).
			</p>
		{/if}

		<button class="primary big" onclick={toggleReady} disabled={!enoughPlayers && !mine?.ready}>
			{mine?.ready ? 'Not ready' : "I'm ready"}
		</button>

		{#if idleSeconds !== null}
			<p class="idle" class:urgent={idleSeconds <= 10}>
				Ready up within {idleSeconds}s or you'll be removed from the room.
			</p>
		{/if}
	</section>
{:else if room.phase === 'drawing'}
	<section class="card center">
		<h2>Picking levels…</h2>
		<p class="muted">Everyone is ready. Drawing {CATEGORY_LABELS[room.category]} levels.</p>
	</section>
{:else if round}
	<section class="card">
		{#if room.phase === 'voting'}
			<h2>
				Vote for a level
				{#if voteSeconds !== null}<span class="timer" class:urgent={voteSeconds <= 5}>{voteSeconds}s</span>{/if}
			</h2>
		{:else if room.phase === 'loading'}
			<h2>{spinning ? 'A tie! Spinning…' : 'Level chosen'}</h2>
		{:else if room.phase === 'countdown'}
			<h2>Get ready</h2>
		{:else}
			<h2>Race</h2>
		{/if}

		<ul class="levels" class:locked={room.phase !== 'voting'}>
			{#each round.candidates as c (c.slug)}
				<li
					class:voted={myVote === c.slug}
					class:lit={room.phase === 'loading' && spinning && lit === c.slug}
					class:winner={room.phase !== 'voting' && !spinning && round.chosen === c.slug}
					class:dim={room.phase !== 'voting' &&
						(spinning ? !round.tied.includes(c.slug) : round.chosen !== c.slug)}
				>
					<button
						class="level"
						disabled={room.phase !== 'voting'}
						aria-pressed={myVote === c.slug}
						onclick={() => session?.vote(c.slug)}
					>
						{#if c.thumbnailUrl}
							<img src={c.thumbnailUrl} alt="" loading="lazy" />
						{:else}
							<span class="noimg" aria-hidden="true">?</span>
						{/if}
						<span class="meta">
							<strong>{c.title}</strong>
							<span class="by">by {c.owner}</span>
							<DifficultyBadge label={c.difficulty} />
						</span>
						<span class="votes" aria-label="{counts[c.slug] ?? 0} votes">{counts[c.slug] ?? 0}</span>
					</button>
				</li>
			{/each}
		</ul>

		{#if room.phase === 'voting'}
			<p class="muted small">
				{room.players.filter((p) => round.votes[p.userId]).length}/{room.players.length} voted. A tie is settled by a spin; if nobody
				votes, a level is picked at random.
			</p>
		{:else if room.phase === 'loading'}
			{#if !spinning && chosenCandidate}
				<p class="chosen">Racing <strong>{chosenCandidate.title}</strong></p>
			{/if}
			<ul class="loadstate">
				{#each room.players as p (p.userId)}
					<li class:done={p.loaded}>{p.username}: {p.loaded ? 'ready' : 'loading…'}</li>
				{/each}
			</ul>
			{#if loadError}<p class="error">{loadError} You'll be dropped from the race if it can't load.</p>{/if}
		{/if}
	</section>

	{#if room.phase === 'countdown' || room.phase === 'racing'}
		{#if face !== null || room.phase === 'countdown'}
			<div class="overlay" aria-live="assertive">
				{#if face === null}
					<p class="getready">Get ready…</p>
				{:else}
					<p class="face" class:go={face === 'go'}>{face === 'go' ? 'GO!' : face}</p>
				{/if}
				{#if chosenCandidate}<p class="title">{chosenCandidate.title}</p>{/if}
			</div>
		{/if}
		{#if room.phase === 'racing'}
			<p class="muted note">
				The race itself arrives in the next update. This room returns to ready-up in a few seconds.
			</p>
		{/if}
	{/if}
{/if}

<style>
	.card {
		background: #252650;
		border: 2px solid #3a3d76;
		border-radius: 8px;
		padding: 20px 24px;
		margin-bottom: 16px;
	}

	.center {
		text-align: center;
	}

	h2 {
		font-family: 'Baloo 2', sans-serif;
		font-weight: 800;
		font-size: 1.3rem;
		margin: 0 0 12px;
		display: flex;
		align-items: center;
		gap: 12px;
	}

	p {
		margin: 0 0 12px;
	}

	.muted {
		color: #8b8fc7;
	}

	.small {
		font-size: 0.85rem;
	}

	.error {
		color: #ff8a7a;
	}

	.label {
		display: block;
		color: #8b8fc7;
		font-size: 0.85rem;
		text-transform: uppercase;
		letter-spacing: 0.06em;
		margin-bottom: 6px;
	}

	.category {
		margin-bottom: 8px;
	}

	.chips {
		display: flex;
		flex-wrap: wrap;
		gap: 8px;
		margin-bottom: 8px;
	}

	.chip {
		font: inherit;
		font-weight: 700;
		color: #f4f6ff;
		background: transparent;
		border: 3px solid #3a3d76;
		border-radius: 6px;
		padding: 6px 12px;
		cursor: pointer;
	}

	.chip.selected {
		border-color: #ffd23f;
		background: rgba(255, 210, 63, 0.12);
	}

	.primary {
		font: inherit;
		font-weight: 800;
		color: #142013;
		background: #4ecb71;
		border: 3px solid #2f8f4c;
		border-radius: 6px;
		padding: 10px 20px;
		cursor: pointer;
	}

	.primary:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}

	.big {
		font-size: 1.2rem;
		padding: 12px 28px;
	}

	.idle {
		margin: 12px 0 0;
		color: #ffb86b;
	}

	.idle.urgent,
	.timer.urgent {
		color: #ff8a7a;
	}

	.timer {
		font-size: 1.1rem;
		color: #ffd23f;
		font-variant-numeric: tabular-nums;
	}

	.levels {
		list-style: none;
		margin: 0 0 12px;
		padding: 0;
		display: grid;
		gap: 10px;
		grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
	}

	.levels li {
		border: 3px solid #3a3d76;
		border-radius: 8px;
		overflow: hidden;
		transition: opacity 0.2s;
	}

	.levels li.voted {
		border-color: #ffd23f;
	}

	.levels li.lit {
		border-color: #4ecb71;
		box-shadow: 0 0 0 3px rgba(78, 203, 113, 0.35);
	}

	.levels li.winner {
		border-color: #4ecb71;
		box-shadow: 0 0 0 3px rgba(78, 203, 113, 0.35);
	}

	.levels li.dim {
		opacity: 0.4;
	}

	.level {
		display: grid;
		grid-template-columns: 1fr auto;
		grid-template-areas:
			'img img'
			'meta votes';
		width: 100%;
		font: inherit;
		color: inherit;
		background: transparent;
		border: 0;
		padding: 0;
		text-align: left;
		cursor: pointer;
	}

	.level:disabled {
		cursor: default;
	}

	img,
	.noimg {
		grid-area: img;
		width: 100%;
		aspect-ratio: 16 / 9;
		object-fit: cover;
		background: #1a1b3a;
		image-rendering: pixelated;
	}

	.noimg {
		display: grid;
		place-items: center;
		font-size: 2rem;
		color: #3a3d76;
	}

	.meta {
		grid-area: meta;
		display: flex;
		flex-direction: column;
		gap: 2px;
		padding: 8px 10px;
		min-width: 0;
	}

	.meta strong {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.by {
		color: #8b8fc7;
		font-size: 0.85rem;
	}

	.votes {
		grid-area: votes;
		align-self: center;
		font-family: 'Baloo 2', sans-serif;
		font-weight: 800;
		font-size: 1.6rem;
		padding: 0 14px;
		color: #ffd23f;
	}

	.chosen {
		font-size: 1.1rem;
	}

	.loadstate {
		list-style: none;
		margin: 0;
		padding: 0;
		color: #8b8fc7;
		font-size: 0.9rem;
	}

	.loadstate li.done {
		color: #4ecb71;
	}

	.overlay {
		position: fixed;
		inset: 0;
		display: grid;
		place-content: center;
		text-align: center;
		background: rgba(26, 27, 58, 0.88);
		z-index: 50;
		pointer-events: none;
	}

	.face {
		font-family: 'Baloo 2', sans-serif;
		font-weight: 800;
		font-size: clamp(6rem, 24vw, 12rem);
		line-height: 1;
		margin: 0;
		color: #ffd23f;
	}

	.face.go {
		color: #4ecb71;
	}

	.getready {
		font-family: 'Baloo 2', sans-serif;
		font-weight: 800;
		font-size: 2rem;
		color: #8b8fc7;
	}

	.title {
		color: #f4f6ff;
		font-size: 1.2rem;
		margin: 8px 0 0;
	}

	.note {
		margin: 8px 0 16px;
	}
</style>