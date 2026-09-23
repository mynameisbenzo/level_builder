<script lang="ts">
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import { deleteAccount, updateProfile } from '$lib/api';
	import { auth } from '$lib/auth.svelte';
	import Navbar from '$lib/Navbar.svelte';

	let username = $state(auth.user?.username ?? '');
	let hideEmail = $state(auth.user?.hide_email ?? false);
	let hideTwitch = $state(auth.user?.hide_twitch ?? false);

	let saveStatus: 'idle' | 'saving' | 'saved' | 'error' = $state('idle');
	let saveError = $state('');

	let showDeleteConfirm = $state(false);
	let deleteStatus: 'idle' | 'deleting' | 'error' = $state('idle');
	let deleteError = $state('');

	onMount(() => {
		if (!auth.isLoggedIn) {
			goto('/login');
		}
	});

	function handleSessionExpired() {
		auth.logout();
		goto('/login');
	}

	async function handleSave(event: SubmitEvent) {
		event.preventDefault();
		if (!auth.user || !auth.accessToken) return;

		saveStatus = 'saving';
		saveError = '';

		const result = await updateProfile(auth.user.id, auth.accessToken, {
			username: username.trim(),
			hide_email: hideEmail,
			hide_twitch: hideTwitch
		});

		if (result.success && result.user) {
			auth.updateUser(result.user);
			saveStatus = 'saved';
		} else if (result.sessionExpired) {
			handleSessionExpired();
		} else {
			saveStatus = 'error';
			saveError = result.error ?? 'Something went wrong. Please try again.';
		}
	}

	async function handleDelete() {
		if (!auth.user || !auth.accessToken) return;

		deleteStatus = 'deleting';
		deleteError = '';

		const result = await deleteAccount(auth.user.id, auth.accessToken);

		if (result.success) {
			auth.logout();
			goto('/');
		} else if (result.sessionExpired) {
			handleSessionExpired();
		} else {
			deleteStatus = 'error';
			deleteError = result.error ?? 'Something went wrong. Please try again.';
		}
	}
</script>

<svelte:head>
	<title>Your Account — Pixel Maker</title>
</svelte:head>

<Navbar />

{#if auth.user}
	<main>
		<div class="card">
			<h1>Your account</h1>

			<form onsubmit={handleSave}>
				<label>
					Username
					<input type="text" bind:value={username} required minlength="1" />
				</label>

				<div class="field-static">
					<span class="field-label">Email</span>
					<span class="field-value">
						{auth.user.email}
						{#if auth.user.email_verified_at}
							<span class="verified">verified</span>
						{:else}
							<span class="unverified">not verified</span>
						{/if}
					</span>
				</div>

				<label class="checkbox">
					<input type="checkbox" bind:checked={hideEmail} />
					Hide my email from other users
				</label>

				{#if auth.user.twitch_id}
					<label class="checkbox">
						<input type="checkbox" bind:checked={hideTwitch} />
						Hide my Twitch account from other users
					</label>
				{/if}

				{#if saveStatus === 'error'}
					<p class="error">{saveError}</p>
				{/if}
				{#if saveStatus === 'saved'}
					<p class="success">Saved.</p>
				{/if}

				<button type="submit" disabled={saveStatus === 'saving'}>
					{saveStatus === 'saving' ? 'Saving…' : 'Save changes'}
				</button>
			</form>
		</div>

		<div class="card danger-zone">
			<h2>Danger zone</h2>

			{#if !showDeleteConfirm}
				<p class="note">Deleting your account can't be undone.</p>
				<button class="danger-button" onclick={() => (showDeleteConfirm = true)}>
					Delete my account
				</button>
			{:else}
				<p class="note">
					Are you sure? This permanently removes your email and Twitch link and can't be
					undone.
				</p>
				{#if deleteStatus === 'error'}
					<p class="error">{deleteError}</p>
				{/if}
				<div class="confirm-row">
					<button
						class="danger-button"
						onclick={handleDelete}
						disabled={deleteStatus === 'deleting'}
					>
						{deleteStatus === 'deleting' ? 'Deleting…' : 'Yes, delete my account'}
					</button>
					<button class="cancel-button" onclick={() => (showDeleteConfirm = false)}>
						Cancel
					</button>
				</div>
			{/if}
		</div>
	</main>
{/if}

<style>
	:global(body) {
		background: #1a1b3a;
		color: #f4f6ff;
	}

	main {
		max-width: 480px;
		margin: 0 auto;
		padding: 48px 24px;
		display: flex;
		flex-direction: column;
		gap: 24px;
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
		margin: 0 0 24px;
	}

	h2 {
		font-family: 'Baloo 2', sans-serif;
		font-weight: 700;
		font-size: 1.15rem;
		margin: 0 0 12px;
		color: #ff8a7a;
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

	label.checkbox {
		flex-direction: row;
		align-items: center;
		gap: 10px;
	}

	input[type='text'] {
		font-family: 'Manrope', sans-serif;
		font-size: 1rem;
		color: #f4f6ff;
		background: #1a1b3a;
		border: 2px solid #3a3d76;
		border-radius: 6px;
		padding: 10px 12px;
	}

	input[type='text']:focus-visible {
		outline: none;
		border-color: #4ecb71;
	}

	.field-static {
		display: flex;
		flex-direction: column;
		gap: 6px;
	}

	.field-label {
		font-family: 'Baloo 2', sans-serif;
		font-weight: 700;
		font-size: 0.85rem;
		color: #c7cbef;
	}

	.field-value {
		font-size: 0.95rem;
		color: #b6baec;
		display: flex;
		align-items: center;
		gap: 8px;
	}

	.verified {
		font-size: 0.75rem;
		color: #4ecb71;
	}

	.unverified {
		font-size: 0.75rem;
		color: #ffd23f;
	}

	.error {
		font-size: 0.85rem;
		color: #ff8a7a;
		margin: 0;
	}

	.success {
		font-size: 0.85rem;
		color: #4ecb71;
		margin: 0;
	}

	.note {
		font-size: 0.9rem;
		line-height: 1.6;
		color: #b6baec;
		margin: 0 0 16px;
	}

	button {
		font-family: 'Baloo 2', sans-serif;
		font-weight: 700;
		font-size: 1rem;
		border-radius: 10px;
		padding: 12px;
		cursor: pointer;
		transition:
			transform 0.15s ease,
			box-shadow 0.15s ease;
	}

	button:focus-visible {
		outline: 3px solid #ffd23f;
		outline-offset: 3px;
	}

	button:disabled {
		opacity: 0.6;
		cursor: not-allowed;
	}

	form > button[type='submit'] {
		color: #142013;
		background: #4ecb71;
		border: 3px solid #142013;
		box-shadow: 0 4px 0 #142013;
	}

	form > button[type='submit']:hover:not(:disabled) {
		transform: translateY(2px);
		box-shadow: 0 2px 0 #142013;
	}

	.danger-button {
		color: #f4f6ff;
		background: #a83c3c;
		border: 3px solid #5c1f1f;
		box-shadow: 0 4px 0 #5c1f1f;
	}

	.danger-button:hover:not(:disabled) {
		transform: translateY(2px);
		box-shadow: 0 2px 0 #5c1f1f;
	}

	.confirm-row {
		display: flex;
		gap: 12px;
	}

	.cancel-button {
		color: #c7cbef;
		background: transparent;
		border: 2px solid #3a3d76;
		box-shadow: none;
	}

	.cancel-button:hover {
		border-color: #6b6f9e;
		color: #f4f6ff;
	}
</style>