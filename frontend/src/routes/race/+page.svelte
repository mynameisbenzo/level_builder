<script lang="ts">
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import { auth } from '$lib/auth.svelte';
	import { withSession } from '$lib/endlessSession';
	import Navbar from '$lib/Navbar.svelte';
	import {
		createRoom,
		fetchRaceTicket,
		formatResetTime,
		getBudget,
		parseRoomCode,
		type BudgetStatus
	} from '$lib/raceApi';

	let budget = $state<BudgetStatus | null>(null);
	let budgetFailed = $state(false);
	// null = not known yet (or logged out); true/false once the ticket says so.
	let canHost = $state<boolean | null>(null);
	let hosting = $state(false);
	let hostError = $state('');
	let codeInput = $state('');
	let joinError = $state('');

	onMount(async () => {
		const result = await getBudget();
		if (result.success && result.data) budget = result.data;
		else budgetFailed = true;

		if (auth.isLoggedIn) {
			const ticket = await withSession(fetchRaceTicket);
			canHost = ticket?.success && ticket.data ? ticket.data.claims.paid : null;
		}
	});

	async function hostRace() {
		hosting = true;
		hostError = '';
		const ticket = await withSession(fetchRaceTicket);
		if (!ticket || !ticket.success || !ticket.data) {
			hosting = false;
			hostError = ticket?.error ?? 'Please log in again.';
			return;
		}
		const created = await createRoom(ticket.data.ticket);
		if (!created.success || !created.data) {
			hosting = false;
			hostError = created.error ?? 'Could not create a room.';
			return;
		}
		goto(`/race/${created.data.code}`);
	}

	function joinByCode(event: SubmitEvent) {
		event.preventDefault();
		const code = parseRoomCode(codeInput);
		if (!code) {
			joinError = 'That is not a room code. Codes are 6 letters and numbers, like K7M2PX.';
			return;
		}
		goto(`/race/${code}`);
	}
</script>

<svelte:head>
	<title>Race · Pixel Maker</title>
</svelte:head>

<Navbar />

<main>
	<h1>Race</h1>
	<p class="subhead">
		Race friends on the same level at once and watch their ghosts. Up to 4 players per room.
	</p>

	<section class="card status">
		{#if budget}
			<p class="counter">Races today: <strong>{budget.racesToday}/{budget.racesPerDayEstimate}</strong></p>
			{#if budget.atCapacity}
				<p class="capacity">
					Races are at capacity today. They reset at {formatResetTime(budget.resetsAt)}.
				</p>
			{/if}
		{:else if budgetFailed}
			<p class="muted">Race availability could not be loaded.</p>
		{:else}
			<p class="muted">Checking race availability…</p>
		{/if}
	</section>

	{#if !auth.isLoggedIn}
		<section class="card">
			<h2>Log in to race</h2>
			<p>You need an account to host or join a race.</p>
			<div class="row">
				<a class="primary" href="/login">Log in</a>
				<a class="secondary" href="/signup">Sign up</a>
			</div>
		</section>
	{:else}
		<section class="card">
			<h2>Host a race</h2>
			{#if canHost === false}
				<p>
					Hosting a race needs a paid account. You can still join any room you are invited to: open
					the invite link, or enter its code below.
				</p>
			{:else}
				<p>You get a room code and invite link to share. You choose who can join.</p>
				<button class="primary" onclick={hostRace} disabled={hosting || canHost === null}>
					{hosting ? 'Creating room…' : 'Host a race'}
				</button>
			{/if}
			{#if hostError}<p class="error">{hostError}</p>{/if}
		</section>

		<section class="card">
			<h2>Join a race</h2>
			<form onsubmit={joinByCode}>
				<label>
					Room code or invite link
					<input type="text" bind:value={codeInput} placeholder="K7M2PX" autocomplete="off" />
				</label>
				<button class="secondary" type="submit">Join</button>
			</form>
			{#if joinError}<p class="error">{joinError}</p>{/if}
		</section>
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

	h2 {
		font-family: 'Baloo 2', sans-serif;
		font-weight: 800;
		font-size: 1.3rem;
		margin: 0 0 8px;
	}

	.subhead {
		color: #c7cbef;
		line-height: 1.6;
		margin: 0 0 24px;
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

	.counter strong {
		color: #ffd23f;
	}

	.capacity {
		color: #ffb86b;
	}

	.muted {
		color: #8b8fc7;
	}

	.error {
		color: #ff8a7a;
		font-size: 0.9rem;
	}

	.row {
		display: flex;
		gap: 12px;
	}

	form {
		display: flex;
		align-items: flex-end;
		gap: 12px;
		flex-wrap: wrap;
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
		text-transform: uppercase;
	}

	button.primary,
	button.secondary,
	a.primary,
	a.secondary {
		font-family: 'Baloo 2', sans-serif;
		font-weight: 700;
		font-size: 1rem;
		padding: 10px 24px;
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

	button:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}
</style>