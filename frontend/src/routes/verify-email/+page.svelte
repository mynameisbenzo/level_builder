<script lang="ts">
	import { onMount } from 'svelte';
	import { page } from '$app/state';
	import { verifyEmail } from '$lib/api';
	import Navbar from '$lib/Navbar.svelte';

	// Starts at 'ready', not an auto-firing 'verifying' - the token is
	// only consumed once the person actually clicks the button below.
	// Auto-consuming on page load meant email security scanners
	// (Microsoft Safe Links, Proofpoint, Mimecast, Gmail's link
	// checker) would burn the single-use token themselves seconds
	// after delivery, since they visit every link in an email to scan
	// it before the recipient ever opens it - a scanner renders a
	// page, but it doesn't click a button on it. This is a well-known,
	// common failure mode for exactly this kind of auto-verify-on-load
	// design, not something specific to this token/timing logic.
	let status: 'ready' | 'verifying' | 'success' | 'error' = $state('ready');
	let errorMessage = $state('');
	let token = $state('');

	onMount(() => {
		const urlToken = page.url.searchParams.get('token');
		if (!urlToken) {
			status = 'error';
			errorMessage = 'No verification token found in this link.';
			return;
		}
		token = urlToken;
	});

	async function handleVerify() {
		status = 'verifying';
		const result = await verifyEmail(token);
		if (result.success) {
			status = 'success';
		} else {
			status = 'error';
			errorMessage = result.error ?? 'Verification failed. Please try again.';
		}
	}
</script>

<svelte:head>
	<title>Verify Email — Pixel Maker</title>
</svelte:head>

<Navbar />

<main>
	<div class="card">
		<h1>Email verification</h1>

		{#if status === 'ready'}
			<p class="note">Click below to verify your email address.</p>
			<button onclick={handleVerify}>Verify my email</button>
		{:else if status === 'verifying'}
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
		margin: 0 0 20px;
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