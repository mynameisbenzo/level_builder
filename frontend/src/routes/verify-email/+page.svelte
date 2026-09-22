<script lang="ts">
	import { onMount } from 'svelte';
	import { page } from '$app/state';
	import { verifyEmail } from '$lib/api';
	import Navbar from '$lib/Navbar.svelte';

	let status: 'verifying' | 'success' | 'error' = $state('verifying');
	let errorMessage = $state('');

	onMount(async () => {
		const token = page.url.searchParams.get('token');

		if (!token) {
			status = 'error';
			errorMessage = 'No verification token found in this link.';
			return;
		}

		const result = await verifyEmail(token);
		if (result.success) {
			status = 'success';
		} else {
			status = 'error';
			errorMessage = result.error ?? 'Verification failed. Please try again.';
		}
	});
</script>

<svelte:head>
	<title>Verify Email — Pixel Maker</title>
</svelte:head>

<Navbar />

<main>
	<div class="card">
		<h1>Email verification</h1>

		{#if status === 'verifying'}
			<p class="note">Verifying…</p>
		{:else if status === 'success'}
			<p class="success">Your email is verified.</p>
		{:else}
			<p class="error">{errorMessage}</p>
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