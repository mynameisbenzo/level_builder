<script lang="ts">
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import { linkTwitchAccount } from '$lib/api';
	import { auth } from '$lib/auth.svelte';
	import { getTwitchLinkRedirectUri, verifyTwitchLinkState } from '$lib/twitch';
	import Navbar from '$lib/Navbar.svelte';

	// Same reasoning as /auth/twitch/callback for auto-firing on mount -
	// this is only ever reached via a direct redirect right after a
	// real click on Twitch's own consent screen, not an emailed link.
	let status: 'exchanging' | 'success' | 'error' = $state('exchanging');
	let errorMessage = $state('');

	onMount(async () => {
		if (!auth.isLoggedIn) {
			goto('/login');
			return;
		}

		const code = page.url.searchParams.get('code');
		const returnedState = page.url.searchParams.get('state');

		if (!code) {
			status = 'error';
			errorMessage = 'No authorization code found in this link.';
			return;
		}

		if (!verifyTwitchLinkState(returnedState)) {
			status = 'error';
			errorMessage = 'This request could not be verified. Please try again.';
			return;
		}

		if (!auth.accessToken) return;

		let result = await linkTwitchAccount(code, getTwitchLinkRedirectUri(), auth.accessToken);

		// The Twitch consent screen can take a while - the proactive
		// scheduled refresh in auth.svelte.ts should normally keep the
		// access token fresh regardless, but this is a real enough gap
		// to cover with the same reactive-fallback pattern /profile uses.
		if (result.sessionExpired) {
			const refreshed = await auth.tryRefresh();
			if (refreshed && auth.accessToken) {
				result = await linkTwitchAccount(code, getTwitchLinkRedirectUri(), auth.accessToken);
			}
		}

		if (result.success && result.user) {
			auth.updateUser(result.user);
			status = 'success';
			setTimeout(() => goto('/profile'), 1200);
		} else if (result.sessionExpired) {
			goto('/login');
		} else {
			status = 'error';
			errorMessage = result.error ?? 'Could not link your Twitch account. Please try again.';
		}
	});
</script>

<svelte:head>
	<title>Link Twitch — Pixel Maker</title>
</svelte:head>

<Navbar />

<main>
	<div class="card">
		<h1>Link Twitch account</h1>

		{#if status === 'exchanging'}
			<p class="note">One moment…</p>
		{:else if status === 'success'}
			<p class="success">Your Twitch account is linked — returning to your account…</p>
		{:else}
			<p class="error">{errorMessage}</p>
			<p class="note secondary">
				<a href="/profile">Back to your account</a>
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