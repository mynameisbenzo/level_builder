<script lang="ts">
	import { requestLoginLink } from '$lib/api';
	import Navbar from '$lib/Navbar.svelte';

	let identifier = $state('');
	let status: 'idle' | 'submitting' | 'sent' | 'error' = $state('idle');
	let errorMessage = $state('');
	let sentMessage = $state('');
	let devLoginToken = $state('');

	async function handleSubmit(event: SubmitEvent) {
		event.preventDefault();
		status = 'submitting';
		errorMessage = '';

		const result = await requestLoginLink(identifier.trim());

		if (result.success) {
			status = 'sent';
			sentMessage = result.message ?? 'If an account exists, a login link has been sent.';
			devLoginToken = result.devLoginToken ?? '';
		} else {
			status = 'error';
			errorMessage = result.error ?? 'Something went wrong. Please try again.';
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

		{#if status === 'sent'}
			<p class="success">{sentMessage}</p>
			{#if devLoginToken}
				<p class="dev-note">
					Dev mode: <a href="/auth/callback?token={devLoginToken}">use this login link directly</a>
					instead of checking email.
				</p>
			{/if}
		{:else}
			<p class="note">
				Enter your username or email. No password - we'll send a login link instead.
			</p>

			<form onsubmit={handleSubmit}>
				<label>
					Username or email
					<input
						type="text"
						bind:value={identifier}
						required
						minlength="1"
						autocomplete="username"
					/>
				</label>

				{#if status === 'error'}
					<p class="error">{errorMessage}</p>
				{/if}

				<button type="submit" disabled={status === 'submitting'}>
					{status === 'submitting' ? 'Sending…' : 'Send login link'}
				</button>
			</form>

			<p class="note secondary">
				Don't have an account yet? <a href="/signup">Sign up</a>.
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
		font-size: 0.9rem;
		line-height: 1.6;
		color: #b6baec;
		margin: 0 0 24px;
	}

	.note.secondary {
		margin: 20px 0 0;
	}

	.note a {
		color: #4ecb71;
	}

	.success {
		font-size: 1rem;
		line-height: 1.6;
		color: #4ecb71;
		margin: 0 0 12px;
	}

	.dev-note {
		font-size: 0.85rem;
		line-height: 1.6;
		color: #ffd23f;
		margin: 0;
	}

	.dev-note a {
		color: #ffd23f;
		text-decoration: underline;
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