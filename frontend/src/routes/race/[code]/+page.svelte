<script lang="ts">
	import { onDestroy, onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import { auth } from '$lib/auth.svelte';
	import { withSession } from '$lib/endlessSession';
	import Navbar from '$lib/Navbar.svelte';
	import RaceRound from '$lib/RaceRound.svelte';
	import { fetchRaceTicket, ROOM_CODE_PATTERN, type RaceResult } from '$lib/raceApi';
	import { defaultDeps, RaceSession } from '$lib/raceSession';
	import {
		amHost,
		canInvite,
		describeClosed,
		describeDenied,
		describeRemoved,
		initialLobby,
		JOIN_MODE_LABELS,
		type JoinMode,
		type LobbyState
	} from '$lib/raceView';
	import type { PageProps } from './$types';

	let { params }: PageProps = $props();
	const code = $derived(params.code.toUpperCase());
	const validCode = $derived(ROOM_CODE_PATTERN.test(code));

	let lobby = $state<LobbyState>(initialLobby());
	let session = $state.raw<RaceSession | null>(null);
	let inviteName = $state('');
	let copied = $state(false);

	const host = $derived(amHost(lobby));
	const mayInvite = $derived(canInvite(lobby));
	// An invite stays on the list after the person joins; only show the ones still waiting.
	const pendingInvites = $derived(
		lobby.room
			? lobby.room.invites.filter(
					(name) => !lobby.room!.players.some((p) => p.username.toLowerCase() === name)
				)
			: []
	);
	const emptySlots = $derived(
		lobby.room ? Math.max(0, lobby.room.maxPlayers - lobby.room.players.length) : 0
	);

	async function getTicket(): Promise<RaceResult<{ ticket: string }>> {
		const result = await withSession(fetchRaceTicket);
		return result ?? { success: false, error: 'Please log in again.' };
	}

	onMount(() => {
		if (!auth.isLoggedIn || !validCode) return;
		session = new RaceSession(code, defaultDeps(getTicket), (next) => (lobby = next));
		session.start();
	});

	onDestroy(() => session?.stop());

	function setMode(mode: JoinMode) {
		if (lobby.room?.joinMode !== mode) session?.send({ t: 'setMode', mode });
	}

	function sendInvite(event: SubmitEvent) {
		event.preventDefault();
		const username = inviteName.trim();
		if (!username) return;
		session?.send({ t: 'invite', username });
		inviteName = '';
	}

	function kick(userId: string, username: string) {
		if (confirm(`Remove ${username} from the room? They will not be able to rejoin.`)) {
			session?.send({ t: 'kick', userId });
		}
	}

	function closeRoom() {
		if (confirm('Close this room for everyone?')) session?.send({ t: 'closeRoom' });
	}

	function leave() {
		session?.leave();
		goto('/race');
	}

	async function copyLink() {
		try {
			await navigator.clipboard.writeText(`${window.location.origin}/race/${code}`);
			copied = true;
			setTimeout(() => (copied = false), 2000);
		} catch {
			// Clipboard blocked: the link is shown on screen to copy by hand.
		}
	}
</script>

<svelte:head>
	<title>Race {code} · Pixel Maker</title>
</svelte:head>

<Navbar />

<main>
	{#if !validCode}
		<section class="card">
			<h1>Room not found</h1>
			<p>That is not a valid room code.</p>
			<a class="secondary" href="/race">Back to Race</a>
		</section>
	{:else if !auth.isLoggedIn}
		<section class="card">
			<h1>Log in to join</h1>
			<p>You need an account to join race room <strong>{code}</strong>.</p>
			<div class="row">
				<a class="primary" href="/login">Log in</a>
				<a class="secondary" href="/signup">Sign up</a>
			</div>
		</section>
	{:else if lobby.status === 'denied'}
		<section class="card">
			<h1>Can't join this room</h1>
			<p>{describeDenied(lobby.deniedCode)}</p>
			<a class="secondary" href="/race">Back to Race</a>
		</section>
	{:else if lobby.status === 'kicked'}
		<section class="card">
			<h1>You were removed</h1>
			<p>The host removed you from this room.</p>
			<a class="secondary" href="/race">Back to Race</a>
		</section>
	{:else if lobby.status === 'removed'}
		<section class="card">
			<h1>You were removed</h1>
			<p>{describeRemoved(lobby.removedReason)}</p>
			<a class="secondary" href="/race">Back to Race</a>
		</section>
	{:else if lobby.status === 'closed'}
		<section class="card">
			<h1>Room closed</h1>
			<p>{describeClosed(lobby.closedReason)}</p>
			<div class="row">
				<a class="primary" href="/race">Back to Race</a>
				<a class="secondary" href="/profile">My profile</a>
			</div>
		</section>
	{:else if lobby.status === 'replaced'}
		<section class="card">
			<h1>Opened somewhere else</h1>
			<p>You joined this room from another tab or device, so this one was disconnected.</p>
			<a class="secondary" href="/race">Back to Race</a>
		</section>
	{:else if lobby.status === 'disconnected'}
		<section class="card">
			<h1>Connection lost</h1>
			<p>{lobby.lastError ?? 'We could not reconnect to the room.'}</p>
			<button class="primary" onclick={() => window.location.reload()}>Try again</button>
		</section>
	{:else if lobby.status === 'left'}
		<section class="card"><p class="muted">Leaving…</p></section>
	{:else if !lobby.room}
		<section class="card"><p class="muted">Joining room {code}…</p></section>
	{:else}
		<header class="top">
			<div>
				<p class="eyebrow">Race room</p>
				<h1>{lobby.room.code}</h1>
			</div>
			<button class="secondary" onclick={copyLink}>{copied ? 'Link copied' : 'Copy invite link'}</button>
		</header>

		{#if lobby.status === 'reconnecting'}
			<p class="banner">Connection dropped. Reconnecting…</p>
		{/if}
		{#if lobby.limited}
			<p class="banner">You are sending too fast. Some actions were ignored.</p>
		{/if}
		{#if lobby.room.closing}
			<p class="banner">The host left. This room closes when the current race ends.</p>
		{/if}

		<section class="card">
			<h2>Players <span class="count">{lobby.room.players.length}/{lobby.room.maxPlayers}</span></h2>
			<ul class="players">
				{#each lobby.room.players as player (player.userId)}
					<li class:away={player.away}>
						<span class="name">
							{player.username}
							{#if player.isHost}<span class="tag host-tag">host</span>{/if}
							{#if player.userId === lobby.you?.userId}<span class="tag you-tag">you</span>{/if}
							{#if player.away}<span class="tag away-tag">reconnecting</span>{/if}
							{#if player.ready && lobby.room.phase === 'lobby'}<span class="tag ready-tag">ready</span>{/if}
						</span>
						{#if host && player.userId !== lobby.you?.userId}
							<button class="danger" onclick={() => kick(player.userId, player.username)}>Remove</button>
						{/if}
					</li>
				{/each}
				{#each Array(emptySlots) as _, slot (slot)}
					<li class="open"><span class="name">Open slot</span></li>
				{/each}
			</ul>

			{#if lobby.notices.length > 0}
				<ul class="notices" aria-live="polite">
					{#each lobby.notices as notice (notice.id)}
						<li>{notice.text}</li>
					{/each}
				</ul>
			{/if}
		</section>

		<RaceRound {lobby} {session} />

		<section class="card">
			<h2>Who can join</h2>
			{#if host}
				<div class="modes" role="radiogroup" aria-label="Who can join">
					{#each Object.entries(JOIN_MODE_LABELS) as [mode, label] (mode)}
						<button
							class="mode"
							class:selected={lobby.room.joinMode === mode}
							role="radio"
							aria-checked={lobby.room.joinMode === mode}
							onclick={() => setMode(mode as JoinMode)}
						>
							<strong>{label.title}</strong>
							<span>{label.hint}</span>
						</button>
					{/each}
				</div>
			{:else}
				<p>
					<strong>{JOIN_MODE_LABELS[lobby.room.joinMode].title}.</strong>
					{JOIN_MODE_LABELS[lobby.room.joinMode].hint}
				</p>
			{/if}

			{#if lobby.room.joinMode === 'public'}
				<p class="muted">Share the invite link. Anyone who opens it can join while there is a free slot.</p>
			{:else if mayInvite}
				<form class="invite" onsubmit={sendInvite}>
					<label>
						Invite by username
						<input type="text" bind:value={inviteName} maxlength="40" autocomplete="off" />
					</label>
					<button class="secondary" type="submit" disabled={!inviteName.trim()}>Invite</button>
				</form>
				<p class="muted">
					Invited players can open the invite link and join. Others who open it are turned away.
				</p>
			{/if}

			{#if lobby.room.joinMode !== 'public' && pendingInvites.length > 0}
				<ul class="invited">
					{#each pendingInvites as name (name)}
						<li>
							<span>{name}</span>
							{#if host}
								<button class="link" onclick={() => session?.send({ t: 'uninvite', username: name })}>
									Remove
								</button>
							{/if}
						</li>
					{/each}
				</ul>
			{/if}

			{#if lobby.lastError}<p class="error">{lobby.lastError}</p>{/if}
		</section>

		<div class="row actions">
			<button class="secondary" onclick={leave}>Leave race</button>
			{#if host}
				<button class="danger" onclick={closeRoom}>Close room</button>
			{/if}
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
		margin: 0;
		letter-spacing: 0.08em;
	}

	h2 {
		font-family: 'Baloo 2', sans-serif;
		font-weight: 800;
		font-size: 1.3rem;
		margin: 0 0 12px;
	}

	.count {
		color: #8b8fc7;
		font-weight: 700;
		margin-left: 6px;
	}

	.eyebrow {
		margin: 0;
		color: #8b8fc7;
		font-size: 0.85rem;
		text-transform: uppercase;
		letter-spacing: 0.08em;
	}

	.top {
		display: flex;
		align-items: flex-end;
		justify-content: space-between;
		gap: 12px;
		margin-bottom: 20px;
		flex-wrap: wrap;
	}

	.card {
		background: #252650;
		border: 2px solid #3a3d76;
		border-radius: 8px;
		padding: 20px 24px;
		margin-bottom: 16px;
	}

	.card p {
		margin: 0 0 12px;
		line-height: 1.5;
	}

	.muted {
		color: #8b8fc7;
	}

	.error {
		color: #ff8a7a;
		font-size: 0.9rem;
	}

	.banner {
		background: rgba(255, 184, 107, 0.12);
		border: 2px solid #ffb86b;
		color: #ffb86b;
		border-radius: 8px;
		padding: 10px 16px;
		margin: 0 0 16px;
	}

	.row {
		display: flex;
		gap: 12px;
		flex-wrap: wrap;
	}

	.actions {
		margin-top: 8px;
	}

	.players,
	.invited,
	.notices {
		list-style: none;
		margin: 0;
		padding: 0;
	}

	.players li {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 12px;
		padding: 10px 12px;
		border: 2px solid #3a3d76;
		border-radius: 8px;
		margin-bottom: 8px;
	}

	.players li.away {
		opacity: 0.6;
	}

	.players li.open {
		border-style: dashed;
		color: #8b8fc7;
	}

	.name {
		font-weight: 700;
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.tag {
		margin-left: 8px;
		font-size: 0.7rem;
		font-weight: 700;
		text-transform: uppercase;
		border-radius: 4px;
		padding: 1px 6px;
		color: #142013;
	}

	.host-tag {
		background: #ffd23f;
	}

	.you-tag {
		background: #4ecb71;
	}

	.ready-tag {
		background: #4ecb71;
	}

	.away-tag {
		background: #ffb86b;
	}

	.notices {
		margin-top: 12px;
		font-size: 0.85rem;
		color: #8b8fc7;
	}

	.notices li {
		padding: 2px 0;
	}

	.modes {
		display: grid;
		gap: 8px;
		margin-bottom: 16px;
	}

	.mode {
		display: flex;
		flex-direction: column;
		gap: 2px;
		text-align: left;
		font: inherit;
		color: #f4f6ff;
		background: transparent;
		border: 3px solid #3a3d76;
		border-radius: 10px;
		padding: 10px 14px;
		cursor: pointer;
	}

	.mode span {
		color: #8b8fc7;
		font-size: 0.85rem;
	}

	.mode:hover:not(.selected) {
		border-color: #6b6f9e;
	}

	.mode.selected {
		border-color: #ffd23f;
		background: rgba(255, 210, 63, 0.1);
	}

	.invite {
		display: flex;
		align-items: flex-end;
		gap: 12px;
		flex-wrap: wrap;
		margin-bottom: 12px;
	}

	label {
		display: flex;
		flex-direction: column;
		gap: 6px;
		font-size: 0.9rem;
		color: #c7cbef;
		flex: 1;
		min-width: 200px;
	}

	input {
		font: inherit;
		padding: 10px 12px;
		color: #f4f6ff;
		background: #1a1b3a;
		border: 2px solid #3a3d76;
		border-radius: 8px;
	}

	.invited li {
		display: flex;
		justify-content: space-between;
		padding: 4px 0;
		color: #c7cbef;
	}

	button.link {
		background: none;
		border: none;
		color: #8b8fc7;
		text-decoration: underline;
		cursor: pointer;
		font: inherit;
	}

	button.primary,
	button.secondary,
	button.danger,
	a.primary,
	a.secondary {
		font-family: 'Baloo 2', sans-serif;
		font-weight: 700;
		font-size: 1rem;
		padding: 8px 20px;
		border-radius: 8px;
		cursor: pointer;
		text-decoration: none;
		display: inline-block;
	}

	.primary {
		color: #142013;
		background: #4ecb71;
		border: 2px solid #4ecb71;
	}

	.secondary {
		color: #c7cbef;
		background: transparent;
		border: 2px solid #3a3d76;
	}

	.danger {
		color: #ff8a7a;
		background: transparent;
		border: 2px solid #7a3d4a;
	}

	button:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}
</style>