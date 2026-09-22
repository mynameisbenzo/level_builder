<script lang="ts">
	import { createUser } from '$lib/api';
	import Navbar from '$lib/Navbar.svelte';

	let username = $state('');
	let email = $state('');
	let status: 'idle' | 'submitting' | 'success' | 'error' = $state('idle');
	let errorMessage = $state('');
	let createdUsername = $state('');

	async function handleSubmit(event: SubmitEvent) {
		event.preventDefault();
		status = 'submitting';
		errorMessage = '';

		const result = await createUser({ username: username.trim(), email: email.trim() });

		if (result.success && result.user) {
			status = 'success';
			createdUsername = result.user.username;
		} else {
			status = 'error';
			errorMessage = result.error ?? 'Something went wrong. Please try again.';
		}
	}
</script>

<svelte:head>
	<title>Sign Up — Level Builder</title>
</svelte:head>

<Navbar />

<main>
	<div class="card">
		<h1>Create your account</h1>

		{#if status === 'success'}
			<p class="success">
				Account created — welcome, <strong>{createdUsername}</strong>. Check your email for a
				verification link, or <a href="/login">log in</a> any time with a magic link.
			</p>
		{:else}
			<p class="note">
				This creates a real account and sends a real verification email. Twitch sign-up
				isn't wired up yet — email, verification, and login (via a magic link, no password)
				all work today.
			</p>

			<form onsubmit={handleSubmit}>
				<label>
					Username
					<input type="text" bind:value={username} required minlength="1" autocomplete="username" />
				</label>
				<label>
					Email
					<input type="email" bind:value={email} required autocomplete="email" />
				</label>

				{#if status === 'error'}
					<p class="error">{errorMessage}</p>
				{/if}

				<button type="submit" disabled={status === 'submitting'}>
					{status === 'submitting' ? 'Creating…' : 'Create account'}
				</button>
			</form>
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
		font-size: 0.9rem;
		line-height: 1.6;
		color: #b6baec;
		margin: 0 0 24px;
	}

	.success {
		font-size: 1rem;
		line-height: 1.6;
		color: #c7cbef;
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

	.error {
		font-size: 0.85rem;
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
		padding: 12px;
		box-shadow: 0 4px 0 #142013;
		cursor: pointer;
		transition:
			transform 0.15s ease,
			box-shadow 0.15s ease;
	}

	button:hover:not(:disabled) {
		transform: translateY(2px);
		box-shadow: 0 2px 0 #142013;
	}

	button:disabled {
		opacity: 0.6;
		cursor: not-allowed;
	}

	button:focus-visible {
		outline: 3px solid #ffd23f;
		outline-offset: 3px;
	}
</style>