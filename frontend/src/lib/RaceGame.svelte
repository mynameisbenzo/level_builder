<script lang="ts">
	import Phaser from 'phaser';
	import { onDestroy, onMount } from 'svelte';
	import { getLevelForPlay } from './api';
	import { clearCheckpointProgress } from './game/checkpoints';
	import { createGameConfig } from './game/gameConfig';
	import LandscapeGuard from './game/LandscapeGuard.svelte';
	import { LEVEL_DIED_EVENT, type PlatformerScene } from './game/PlatformerScene';
	import {
		POSITION_SEND_MS,
		RACE_FINISHED_EVENT,
		RACE_LOCKED_KEY,
		RACE_OPPONENTS_KEY,
		RACE_READY_EVENT,
		RACE_ROSTER_KEY,
		SLOT_CSS,
		type OpponentBuffer,
		type RosterEntry
	} from './game/raceOpponents';
	import TouchControls from './game/TouchControls.svelte';
	import { secondsLeft } from './raceRound';
	import type { RaceSession } from './raceSession';
	import { formatRaceTime, me, ordinal, resultsOrder, type LobbyState } from './raceView';

	let {
		lobby,
		session,
		loadError = $bindable(null),
		onLeave
	}: {
		lobby: LobbyState;
		session: RaceSession | null;
		/** Set when the level couldn't be fetched; the lobby card shows it. */
		loadError: string | null;
		onLeave: () => void;
	} = $props();

	const room = $derived(lobby.room!);
	const round = $derived(room.round);
	const phase = $derived(room.phase);
	const race = $derived(round?.race ?? null);
	const goAt = $derived(round?.goAt ?? null);
	const mine = $derived(me(lobby));
	const myRacer = $derived(race?.racers.find((r) => r.userId === lobby.you?.userId) ?? null);
	const standings = $derived(race ? resultsOrder(race.racers) : []);

	// A 10 Hz heartbeat drives the clocks on screen.
	let beat = $state(0);
	const heartbeat = setInterval(() => (beat += 1), 100);
	const serverNow = $derived.by(() => {
		void beat;
		return session ? session.serverNow() : room.serverNow;
	});

	// ---- the game ---------------------------------------------------------
	let container: HTMLDivElement | undefined = $state();
	let game = $state.raw<Phaser.Game | null>(null);
	let destroyed = false;

	function scene(): PlatformerScene | undefined {
		return game?.scene.getScene('PlatformerScene') as PlatformerScene | undefined;
	}

	async function startGame(slug: string) {
		const result = await getLevelForPlay(slug);
		if (destroyed) return;
		if (!result.success || !result.content) {
			loadError = result.error ?? "The level couldn't be loaded.";
			return;
		}
		if (!container) return;
		const g = new Phaser.Game(
			createGameConfig(container, { startMode: 'play', content: result.content, race: true })
		);
		// The scene's first frame is "loaded": the level is built and playable.
		g.events.once(RACE_READY_EVENT, () => session?.loaded(slug));
		g.events.on(RACE_FINISHED_EVENT, handleFinished);
		g.events.on(LEVEL_DIED_EVENT, handleDied);
		game = g;
	}

	function handleFinished() {
		session?.finish();
	}

	/** Death costs nothing but a tally: back to the start and keep racing. */
	function handleDied() {
		session?.death();
		const g = game;
		if (!g) return;
		// A checkpoint touched earlier in the level must not carry over;
		// a shared race checkpoint is a later addition.
		clearCheckpointProgress(g.registry);
		g.scene.getScene('PlatformerScene')?.scene.restart();
	}

	onMount(() => {
		loadError = null;
		// Rejoining after the race is over needs no game, just the results.
		const slug = round?.chosen;
		if (slug && (phase === 'loading' || phase === 'countdown' || phase === 'racing')) {
			void startGame(slug);
		}
	});

	onDestroy(() => {
		destroyed = true;
		clearInterval(heartbeat);
		clearInterval(sender);
		game?.events.off(RACE_FINISHED_EVENT, handleFinished);
		game?.events.off(LEVEL_DIED_EVENT, handleDied);
		game?.destroy(true);
		game = null;
	});

	// GO: the server's start time, on the server's clock. Everything stays
	// locked until then, however early the level finished loading.
	$effect(() => {
		const g = game;
		const at = goAt;
		if (!g || at === null) return;
		const wait = Math.max(0, at - (session ? session.serverNow() : room.serverNow));
		const handle = setTimeout(() => g.registry.set(RACE_LOCKED_KEY, false), wait);
		return () => clearTimeout(handle);
	});

	// Who is in the race, for the name tags and for hiding finished racers.
	$effect(() => {
		const g = game;
		if (!g || !race) return;
		const roster: RosterEntry[] = race.racers.map((r) => ({
			slot: r.slot,
			username: r.username,
			status: r.status
		}));
		g.registry.set(RACE_ROSTER_KEY, roster);
	});

	// Opponents' positions go straight into the game's buffer.
	$effect(() => {
		const g = game;
		const s = session;
		if (!g || !s) return;
		// Looked up per message: the game fills its registry a moment after it boots.
		s.onPosition = (p) =>
			(g.registry.get(RACE_OPPONENTS_KEY) as OpponentBuffer | undefined)?.push(
				p.slot,
				p.x,
				p.y,
				p.state,
				performance.now()
			);
		return () => {
			s.onPosition = null;
		};
	});

	// Our own position goes out 20 times a second while we are racing, and
	// only when it changed (or every half second as a heartbeat).
	let lastSent = { x: NaN, y: NaN, state: -1, at: 0 };
	const sender = setInterval(() => {
		if (!game || !session || phase !== 'racing' || myRacer?.status !== 'racing') return;
		const snap = scene()?.getRaceSnapshot();
		if (!snap) return;
		const now = performance.now();
		const same =
			Math.round(snap.x) === lastSent.x &&
			Math.round(snap.y) === lastSent.y &&
			snap.state === lastSent.state;
		if (same && now - lastSent.at < 500) return;
		lastSent = { x: Math.round(snap.x), y: Math.round(snap.y), state: snap.state, at: now };
		session.sendPosition(snap.x, snap.y, snap.state);
	}, POSITION_SEND_MS);

	// ---- the HUD ------------------------------------------------------------
	const clockMs = $derived(
		race && phase === 'racing'
			? myRacer?.status === 'finished' && myRacer.finishMs !== null
				? myRacer.finishMs
				: Math.max(0, serverNow - race.startedAt)
			: 0
	);
	const dnfSeconds = $derived(
		race && phase === 'racing' && race.firstFinishAt !== null && myRacer?.status === 'racing'
			? secondsLeft(race.endsAt, serverNow)
			: null
	);
	const nextSeconds = $derived(round ? secondsLeft(round.deadline, serverNow) : null);
	const readyCount = $derived(room.players.filter((p) => p.ready).length);
	const levelTitle = $derived(round?.candidates.find((c) => c.slug === round.chosen)?.title ?? '');
</script>

<div class="race-root" class:hidden={phase === 'loading'}>
	<div class="game-container" bind:this={container}></div>

	{#if phase === 'countdown' || phase === 'racing'}
		<TouchControls allowModeToggle={false} />
		<LandscapeGuard />
	{/if}

	{#if phase === 'racing' && race}
		<div class="hud">
			<div class="left">
				<span class="clock">{formatRaceTime(clockMs)}</span>
				{#if myRacer}<span class="deaths">Deaths {myRacer.deaths}</span>{/if}
			</div>
			<div class="center">
				{#if myRacer?.status === 'finished'}
					<span class="banner done">
						You finished {ordinal(myRacer.place ?? 1)}. Waiting for the others…
					</span>
				{:else if dnfSeconds !== null}
					<span class="banner warn" class:urgent={dnfSeconds <= 10}>
						Finish in {dnfSeconds}s or it's a DNF
					</span>
				{/if}
			</div>
			<ul class="chips">
				{#each race.racers as r (r.userId)}
					<li class:me={r.userId === lobby.you?.userId} class:out={r.status !== 'racing'}>
						<span class="dot" style="background:{SLOT_CSS[r.slot % SLOT_CSS.length]}"></span>
						<span class="who">{r.username}</span>
						<span class="state">
							{#if r.status === 'finished'}{ordinal(r.place ?? 1)}{:else if r.status === 'dnf'}DNF{:else}☠ {r.deaths}{/if}
						</span>
					</li>
				{/each}
			</ul>
		</div>
	{/if}

	{#if phase === 'results' && race}
		<div class="results">
			<div class="panel">
				<h2>Results{levelTitle ? ` · ${levelTitle}` : ''}</h2>
				<table>
					<thead>
						<tr><th>#</th><th>Player</th><th>Time</th><th>Deaths</th><th>Points</th></tr>
					</thead>
					<tbody>
						{#each standings as r, i (r.userId)}
							<tr class:me={r.userId === lobby.you?.userId}>
								<td>{r.status === 'finished' ? ordinal(r.place ?? i + 1) : 'DNF'}</td>
								<td>
									<span class="dot" style="background:{SLOT_CSS[r.slot % SLOT_CSS.length]}"></span>
									{r.username}
								</td>
								<td>{r.finishMs !== null ? formatRaceTime(r.finishMs) : '—'}</td>
								<td>{r.deaths}</td>
								<td class="pts">+{r.points ?? 0}</td>
							</tr>
						{/each}
					</tbody>
				</table>

				<h3>Room leaderboard</h3>
				<ol class="board">
					{#each room.scores as s (s.userId)}
						<li class:me={s.userId === lobby.you?.userId}>
							<span class="who">{s.username}</span>
							<span class="meta">{s.wins} {s.wins === 1 ? 'win' : 'wins'} · {s.races} {s.races === 1 ? 'race' : 'races'}</span>
							<strong>{s.points}</strong>
						</li>
					{/each}
				</ol>

				<div class="actions">
					<button class="primary" onclick={() => session?.setReady(true)} disabled={!mine || mine.ready}>
						{mine?.ready ? `Waiting for the others (${readyCount}/${room.players.length})` : 'Next Race'}
					</button>
					<button class="secondary" onclick={onLeave}>Leave</button>
				</div>
				{#if mine && !mine.ready && nextSeconds !== null}
					<p class="idle" class:urgent={nextSeconds <= 10}>
						Click Next Race within {nextSeconds}s or you'll be removed from the room.
					</p>
				{/if}
				{#if room.closing}
					<p class="idle">The host left. This room closes after this screen.</p>
				{/if}
			</div>
		</div>
	{/if}

	{#if phase === 'racing'}
		<button class="leave" onclick={onLeave}>Leave</button>
	{/if}
</div>

<style>
	.race-root {
		position: fixed;
		inset: 0;
		z-index: 40;
		background: #000;
		touch-action: none;
		user-select: none;
		-webkit-user-select: none;
		-webkit-touch-callout: none;
	}

	.race-root.hidden {
		visibility: hidden;
	}

	.game-container {
		width: 100%;
		height: 100%;
		touch-action: none;
	}

	.game-container :global(canvas) {
		display: block;
		touch-action: none;
	}

	.hud {
		position: absolute;
		top: 8px;
		/* clear of the scene's own character badge in the top-left corner */
		left: 100px;
		right: 8px;
		display: flex;
		justify-content: space-between;
		align-items: flex-start;
		gap: 8px;
		pointer-events: none;
		font-family: monospace;
		color: #f4f6ff;
		text-shadow: 0 1px 2px #000;
	}

	.left {
		display: flex;
		flex-direction: column;
		gap: 2px;
	}

	.clock {
		font-size: 1.6rem;
		font-weight: 700;
		font-variant-numeric: tabular-nums;
	}

	.deaths {
		font-size: 0.85rem;
		color: #c9cdf5;
	}

	.center {
		flex: 1;
		display: flex;
		justify-content: center;
	}

	.banner {
		padding: 4px 10px;
		border-radius: 6px;
		background: rgba(26, 27, 58, 0.8);
		font-size: 0.95rem;
	}

	.banner.done {
		color: #4ecb71;
	}

	.banner.warn {
		color: #ffd23f;
	}

	.banner.urgent {
		color: #ff8a7a;
	}

	.chips {
		list-style: none;
		margin: 0;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: 2px;
		font-size: 0.8rem;
	}

	.chips li {
		display: flex;
		align-items: center;
		gap: 6px;
		padding: 2px 8px;
		border-radius: 4px;
		background: rgba(26, 27, 58, 0.7);
	}

	.chips li.me {
		outline: 1px solid #ffd23f;
	}

	.chips li.out {
		opacity: 0.6;
	}

	.dot {
		display: inline-block;
		width: 10px;
		height: 10px;
		border-radius: 50%;
	}

	.who {
		max-width: 9ch;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.state {
		margin-left: auto;
		padding-left: 6px;
		font-variant-numeric: tabular-nums;
	}

	.leave {
		position: absolute;
		bottom: 8px;
		right: 8px;
		z-index: 5;
		font: inherit;
		font-size: 0.8rem;
		color: #f4f6ff;
		background: rgba(26, 27, 58, 0.7);
		border: 1px solid #3a3d76;
		border-radius: 4px;
		padding: 4px 10px;
		cursor: pointer;
	}

	.results {
		position: absolute;
		inset: 0;
		display: grid;
		place-items: center;
		background: rgba(26, 27, 58, 0.93);
		overflow-y: auto;
		padding: 16px;
		z-index: 10;
	}

	.panel {
		width: min(560px, 100%);
		background: #252650;
		border: 2px solid #3a3d76;
		border-radius: 8px;
		padding: 20px 24px;
		color: #f4f6ff;
	}

	h2 {
		font-family: 'Baloo 2', sans-serif;
		font-weight: 800;
		font-size: 1.4rem;
		margin: 0 0 12px;
	}

	h3 {
		font-family: 'Baloo 2', sans-serif;
		font-size: 1rem;
		margin: 16px 0 6px;
		color: #8b8fc7;
		text-transform: uppercase;
		letter-spacing: 0.06em;
	}

	table {
		width: 100%;
		border-collapse: collapse;
		font-variant-numeric: tabular-nums;
	}

	th {
		text-align: left;
		color: #8b8fc7;
		font-size: 0.8rem;
		font-weight: 600;
		padding: 2px 6px;
	}

	td {
		padding: 6px;
		border-top: 1px solid #3a3d76;
	}

	tr.me td {
		background: rgba(255, 210, 63, 0.08);
	}

	.pts {
		color: #4ecb71;
		font-weight: 700;
	}

	.board {
		list-style: none;
		margin: 0;
		padding: 0;
	}

	.board li {
		display: flex;
		gap: 10px;
		align-items: baseline;
		padding: 4px 6px;
	}

	.board li.me {
		background: rgba(255, 210, 63, 0.08);
	}

	.board .meta {
		color: #8b8fc7;
		font-size: 0.85rem;
		margin-left: auto;
	}

	.board strong {
		min-width: 2.5ch;
		text-align: right;
		color: #ffd23f;
	}

	.actions {
		display: flex;
		gap: 10px;
		margin-top: 16px;
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
		opacity: 0.6;
		cursor: default;
	}

	.secondary {
		font: inherit;
		font-weight: 700;
		color: #f4f6ff;
		background: transparent;
		border: 3px solid #3a3d76;
		border-radius: 6px;
		padding: 10px 16px;
		cursor: pointer;
	}

	.idle {
		margin: 12px 0 0;
		color: #ffb86b;
	}

	.idle.urgent {
		color: #ff8a7a;
	}
</style>