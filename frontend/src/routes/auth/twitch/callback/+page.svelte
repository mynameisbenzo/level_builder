<script lang="ts">
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import { exchangeTwitchCode, finishTwitchSignup } from '$lib/api';
	import { auth } from '$lib/auth.svelte';
	import { getTwitchRedirectUri, verifyTwitchState } from '$lib/twitch';
	import Navbar from '$lib/Navbar.svelte';

	// Unlike /auth/callback and /verify-email, this auto-fires on mount
	// rather than waiting for an explicit click - deliberately: those
	// two are reached via emailed links, which an email security
	// scanner can visit before the person ever opens the email (see
	// their own history in this project). This page is only ever
	// reached by a direct browser redirect immediately following a
	// real, explicit click on Twitch's own "Authorize" screen - there's
	// no email involved, so that risk doesn't apply here, and
	// auto-processing on load is the standard, expected shape for an
	// OAuth callback.
	let status: 'exchanging' | 'needs_username' | 'creating_account' | 'success' | 'error' =
		$state('exchanging');
	let errorMessage = $state('');

	let signupToken = $state('');
	let username = $state('');
	let usernameError = $state('');

	onMount(async () => {
		const code = page.url.searchParams.get('code');
		const returnedState = page.url.searchParams.get('state');

		if (!code) {
			status = 'error';
			errorMessage = 'No authorization code found in this link.';
			return;
		}

		if (!verifyTwitchState(returnedState)) {
			status = 'error';
			errorMessage = 'This login request could not be verified. Please try again.';
			return;
		}

		const result = await exchangeTwitchCode(code, getTwitchRedirectUri());

		if (!result.success) {
			status = 'error';
			errorMessage = result.error ?? 'Twitch login failed. Please try again.';
			return;
		}

		if (result.needsUsername && result.signupToken) {
			signupToken = result.signupToken;
			username = result.suggestedUsername ?? '';
			status = 'needs_username';
			return;
		}

		if (result.accessToken && result.refreshToken && result.user) {
			auth.login(result.accessToken, result.refreshToken, result.user);
			status = 'success';
			setTimeout(() => goto('/'), 1200);
			return;
		}

		status = 'error';
		errorMessage = 'Twitch login failed. Please try again.';
	});

	async function handleFinishSignup(event: SubmitEvent) {
		event.preventDefault();
		usernameError = '';
		status = 'creating_account';

		const result = await finishTwitchSignup(signupToken, username.trim());

		if (result.success && result.accessToken && result.refreshToken && result.user) {
			auth.login(result.accessToken, result.refreshToken, result.user);
			status = 'success';
			setTimeout(() => goto('/'), 1200);
		} else {
			status = 'needs_username';
			usernameError = result.error ?? 'Could not create your account. Please try again.';
		}
	}
</script>

<svelte:head>
	<title>Log In with Twitch — Pixel Maker</title>
</svelte:head>

<Navbar />

<main>
	<div class="card">
		{#if status === 'needs_username'}
			<h1>Choose a username</h1>
			<p class="note">
				This is separate from your Twitch handle and is what everyone will see on Pixel
				Maker.
			</p>

			<form onsubmit={handleFinishSignup}>
				<label>
					Username
					<input type="text" bind:value={username} required minlength="1" />
				</label>

				{#if usernameError}
					<p class="error">{usernameError}</p>
				{/if}

				<button type="submit">Create account</button>
			</form>
		{:else}
			<h1>Log in with Twitch</h1>

			{#if status === 'exchanging'}
				<p class="note">One moment…</p>
			{:else if status === 'creating_account'}
				<p class="note">Creating your account…</p>
			{:else if status === 'success'}
				<p class="success">You're logged in — redirecting…</p>
			{:else}
				<p class="error">{errorMessage}</p>
				<p class="note secondary">
					<a href="/login">Try again</a>
				</p>
			{/if}
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
		font-size: 0.85rem;
		color: #ff8a7a;
		margin: 0;
	}

	form {
		display: flex;
		flex-direction: column;
		gap: 18px;
	}

	label {
		display: flex;
		flex-direction: column;
		gap: 6px;
		font-family: 'Baloo 2', sans-serif;
		font-weight: 700;
		font-size: 0.85rem;
		color: #c7cbef;
	}

	input {
		font-family: 'Manrope', sans-serif;
		font-size: 1rem;
		color: #f4f6ff;
		background: #1a1b3a;
		border: 2px solid #3a3d76;
		border-radius: 6px;
		padding: 10px 12px;
	}

	input:focus-visible {
		outline: none;
		border-color: #4ecb71;
	}

	button {
		font-family: 'Baloo 2', sans-serif;
		font-weight: 700;
		font-size: 1rem;
		color: #142013;
		background: #4ecb71;
		border: 3px solid #142013;
		border-radius: 10px;
		padding: 12px;
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