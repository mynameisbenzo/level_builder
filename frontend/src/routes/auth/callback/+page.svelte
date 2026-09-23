<script lang="ts">
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import { loginWithToken } from '$lib/api';
	import { auth } from '$lib/auth.svelte';
	import Navbar from '$lib/Navbar.svelte';

	// Same fix as /verify-email, same reason - starts at 'ready', not
	// an auto-firing 'verifying'. Auto-consuming a single-use login
	// token the instant this page loads means an email security
	// scanner visiting the link to check it's safe (before the human
	// ever opens the email) would log the scanner in and burn the
	// token, not the actual person.
	let status: 'ready' | 'verifying' | 'success' | 'error' = $state('ready');
	let errorMessage = $state('');
	let token = $state('');

	onMount(() => {
		const urlToken = page.url.searchParams.get('token');
		if (!urlToken) {
			status = 'error';
			errorMessage = 'No login token found in this link.';
			return;
		}
		token = urlToken;
	});

	async function handleLogin() {
		status = 'verifying';
		const result = await loginWithToken(token);

		if (result.success && result.accessToken && result.user) {
			auth.login(result.accessToken, result.user);
			status = 'success';
			// Brief pause so the success message is actually visible,
			// rather than an instant, jarring redirect.
			setTimeout(() => goto('/'), 1200);
		} else {
			status = 'error';
			errorMessage = result.error ?? 'Login failed. Please try again.';
		}
	}
</script>

<svelte:head>
	<title>Log In — Pixel Maker</title>
</svelte:head>

<Navbar />

<main>
	<div class="card">
		<h1>Log in</h1>

		{#if status === 'ready'}
			<p class="note">Click below to complete logging in.</p>
			<button onclick={handleLogin}>Log in</button>
		{:else if status === 'verifying'}
			<p class="note">One moment…</p>
		{:else if status === 'success'}
			<p class="success">You're logged in — redirecting…</p>
		{:else}
			<p class="error">{errorMessage}</p>
			<p class="note secondary">
				Login links expire quickly and only work once. <a href="/login">Request a new one</a>.
			</p>
		{/if}
	</div>
</main>

<style>
	:global(body) {
		background: #1a1b3a;
		color: #f4f6ff;
	}

	main {
		max-width: 480px;
		margin: 0 auto;
		padding: 48px 24px;
	}

	.card {
		background: #252650;
		border: 2px solid #3a3d76;
		border-radius: 6px;
		padding: 32px;
	}

	h1 {
		font-family: 'Baloo 2', sans-serif;
		font-weight: 700;
		font-size: 1.6rem;
		margin: 0 0 16px;
	}

	.note {
		font-size: 0.95rem;
		line-height: 1.6;
		color: #b6baec;
		margin: 0 0 20px;
	}

	.note.secondary {
		margin: 12px 0 0;
	}

	.note a {
		color: #4ecb71;
	}

	.success {
		font-size: 1rem;
		line-height: 1.6;
		color: #4ecb71;
		margin: 0;
	}

	.error {
		font-size: 0.95rem;
		line-height: 1.6;
		color: #ff8a7a;
		margin: 0;
	}

	button {
		font-family: 'Baloo 2', sans-serif;
		font-weight: 700;
		font-size: 1rem;
		color: #142013;
		background: #4ecb71;
		border: 3px solid #142013;
		border-radius: 10px;
		padding: 12px 24px;
		box-shadow: 0 4px 0 #142013;
		cursor: pointer;
		transition:
			transform 0.15s ease,
			box-shadow 0.15s ease;
	}

	button:hover {
		transform: translateY(2px);
		box-shadow: 0 2px 0 #142013;
	}

	button:focus-visible {
		outline: 3px solid #ffd23f;
		outline-offset: 3px;
	}
</style>