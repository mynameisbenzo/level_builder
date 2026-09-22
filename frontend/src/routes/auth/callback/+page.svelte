<script lang="ts">
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import { loginWithToken } from '$lib/api';
	import { auth } from '$lib/auth.svelte';
	import Navbar from '$lib/Navbar.svelte';

	let status: 'verifying' | 'success' | 'error' = $state('verifying');
	let errorMessage = $state('');

	onMount(async () => {
		const token = page.url.searchParams.get('token');

		if (!token) {
			status = 'error';
			errorMessage = 'No login token found in this link.';
			return;
		}

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
	});
</script>

<svelte:head>
	<title>Logging In — Pixel Maker</title>
</svelte:head>

<Navbar />

<main>
	<div class="card">
		<h1>Logging in</h1>

		{#if status === 'verifying'}
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
		margin: 0;
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
</style>