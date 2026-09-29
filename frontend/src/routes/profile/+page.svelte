<script lang="ts">
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import {
		deleteAccount,
		deleteLevel,
		listMyLevels,
		resendVerificationEmail,
		updateProfile,
		type LevelListItem
	} from '$lib/api';
	import { auth } from '$lib/auth.svelte';
	import { redirectToTwitchLink } from '$lib/twitch';
	import { startNewLevel } from '$lib/startNewLevel';
	import Navbar from '$lib/Navbar.svelte';

	let newLevelStatus: 'idle' | 'creating' | 'error' = $state('idle');
	let newLevelError = $state('');

	async function handleNewLevel() {
		newLevelStatus = 'creating';
		const result = await startNewLevel();
		if (!result.success) {
			newLevelStatus = 'error';
			newLevelError = result.error ?? 'Could not create a new level. Please try again.';
		}
		// On success, startNewLevel already navigated away.
	}

	let levelsStatus: 'loading' | 'ready' | 'error' = $state('loading');
	let levelsError = $state('');
	let levels: LevelListItem[] = $state([]);

	async function loadMyLevels() {
		const token = auth.accessToken;
		if (!token) return;

		let result = await listMyLevels(token);
		if (result.sessionExpired) {
			const refreshed = await auth.tryRefresh();
			const refreshedToken = auth.accessToken;
			if (refreshed && refreshedToken) {
				result = await listMyLevels(refreshedToken);
			}
		}

		if (result.success && result.levels) {
			levels = result.levels;
			levelsStatus = 'ready';
		} else if (result.sessionExpired) {
			goto('/login');
		} else {
			levelsStatus = 'error';
			levelsError = result.error ?? 'Could not load your levels. Please try again.';
		}
	}

	// Per-level delete confirmation - only one level's confirm row is
	// ever open at a time, tracked by slug rather than a boolean per
	// level so opening one closes any other.
	let levelPendingDeleteId: string | null = $state(null);
	let deletingLevelId: string | null = $state(null);
	let levelDeleteError = $state('');

	function requestDeleteLevel(id: string) {
		levelPendingDeleteId = id;
		levelDeleteError = '';
	}

	function cancelDeleteLevel() {
		levelPendingDeleteId = null;
	}

	async function confirmDeleteLevel(id: string) {
		if (!auth.accessToken) return;

		deletingLevelId = id;
		levelDeleteError = '';

		let result = await deleteLevel(id, auth.accessToken);
		if (result.sessionExpired) {
			const refreshed = await auth.tryRefresh();
			const refreshedToken = auth.accessToken;
			if (refreshed && refreshedToken) {
				result = await deleteLevel(id, refreshedToken);
			}
		}

		deletingLevelId = null;

		if (result.success) {
			levelPendingDeleteId = null;
			await loadMyLevels();
		} else if (result.sessionExpired) {
			goto('/login');
		} else {
			levelDeleteError = result.error ?? 'Could not delete the level. Please try again.';
		}
	}

	// Level actions (create/edit/publish) require a verified email or a
	// linked Twitch account - see _verification_gate in the backend's
	// app/api/levels.py. Twitch-linked users are exempt regardless of
	// email_verified_at, matching that same rule exactly.
	let needsVerification = $derived(
		!!auth.user && !auth.user.email_verified_at && !auth.user.twitch_id
	);

	// "sent" stays true for the rest of the visit once a resend
	// succeeds - there's no reason to let it re-fire immediately after
	// a real send goes through, and the banner's copy makes clear
	// checking the inbox (not clicking again) is the next step. A
	// 429 from the backend's own rate limit gets a dedicated message
	// rather than the generic error, since "you've already asked for
	// this" is a different situation than something actually failing.
	let resendStatus: 'idle' | 'sending' | 'sent' | 'error' | 'rate-limited' = $state('idle');
	let resendError = $state('');

	async function handleResendVerification() {
		if (!auth.accessToken) return;

		resendStatus = 'sending';
		resendError = '';

		let result = await resendVerificationEmail(auth.accessToken);
		if (result.sessionExpired) {
			const refreshed = await auth.tryRefresh();
			const refreshedToken = auth.accessToken;
			if (refreshed && refreshedToken) {
				result = await resendVerificationEmail(refreshedToken);
			}
		}

		if (result.success) {
			resendStatus = 'sent';
		} else if (result.sessionExpired) {
			goto('/login');
		} else if (result.rateLimited) {
			resendStatus = 'rate-limited';
			resendError = result.error ?? 'Too many requests - please try again later.';
		} else {
			resendStatus = 'error';
			resendError = result.error ?? 'Could not send the verification email. Please try again.';
		}
	}

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
			return;
		}
		// An unverified, non-Twitch user gets a 403 from GET /api/levels
		// too (see _verification_gate) - skip the call and let the
		// verify-your-email banner explain it, rather than surfacing
		// that 403 as a generic "could not load your levels" error.
		if (needsVerification) return;
		void loadMyLevels();
	});

	async function handleSave(event: SubmitEvent) {
		event.preventDefault();
		if (!auth.user || !auth.accessToken) return;

		saveStatus = 'saving';
		saveError = '';

		let result = await updateProfile(auth.user.id, auth.accessToken, {
			username: username.trim(),
			hide_email: hideEmail,
			hide_twitch: hideTwitch
		});

		// Reactive fallback: the proactive scheduled refresh in
		// auth.svelte.ts should normally catch this before it ever
		// happens (e.g. a laptop asleep through the scheduled time) -
		// try once to silently renew and retry, rather than treating
		// every expired-access-token moment as a full logout.
		if (result.sessionExpired) {
			const refreshed = await auth.tryRefresh();
			if (refreshed && auth.user && auth.accessToken) {
				result = await updateProfile(auth.user.id, auth.accessToken, {
					username: username.trim(),
					hide_email: hideEmail,
					hide_twitch: hideTwitch
				});
			}
		}

		if (result.success && result.user) {
			auth.updateUser(result.user);
			saveStatus = 'saved';
		} else if (result.sessionExpired) {
			// auth.tryRefresh() already logged out on failure.
			goto('/login');
		} else {
			saveStatus = 'error';
			saveError = result.error ?? 'Something went wrong. Please try again.';
		}
	}

	async function handleDelete() {
		if (!auth.user || !auth.accessToken) return;

		deleteStatus = 'deleting';
		deleteError = '';

		let result = await deleteAccount(auth.user.id, auth.accessToken);

		if (result.sessionExpired) {
			const refreshed = await auth.tryRefresh();
			if (refreshed && auth.user && auth.accessToken) {
				result = await deleteAccount(auth.user.id, auth.accessToken);
			}
		}

		if (result.success) {
			auth.logout();
			goto('/');
		} else if (result.sessionExpired) {
			goto('/login');
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
		{#if needsVerification}
			<div class="card verify-banner">
				<p class="note verify-note">
					Verify your email to create, edit, or publish levels. Check your inbox for the
					verification link from signup — or link a Twitch account below for the same access
					without verifying your email.
				</p>
				{#if resendStatus === 'sent'}
					<p class="note verify-note">Verification email sent — check your inbox.</p>
				{:else}
					{#if resendStatus === 'error' || resendStatus === 'rate-limited'}
						<p class="error verify-note">{resendError}</p>
					{/if}
					<button
						class="resend-button"
						onclick={handleResendVerification}
						disabled={resendStatus === 'sending' || resendStatus === 'rate-limited'}
					>
						{resendStatus === 'sending' ? 'Sending…' : 'Resend verification email'}
					</button>
				{/if}
			</div>
		{/if}

		<div class="card">
			<h2 class="new-level-heading">Levels</h2>
			<p class="note">Start building a new level.</p>
			{#if newLevelStatus === 'error'}
				<p class="error">{newLevelError}</p>
			{/if}
			<button
				class="new-level-button"
				onclick={handleNewLevel}
				disabled={newLevelStatus === 'creating' || needsVerification}
				title={needsVerification ? 'Verify your email or link Twitch first' : undefined}
			>
				{newLevelStatus === 'creating' ? 'Creating…' : 'New Level'}
			</button>

			{#if needsVerification}
				<!-- Nothing to load - see the verify-your-email banner above. -->
			{:else if levelsStatus === 'loading'}
				<p class="note levels-status">Loading your levels…</p>
			{:else if levelsStatus === 'error'}
				<p class="error levels-status">{levelsError}</p>
			{:else if levels.length === 0}
				<p class="note levels-status">You haven't created any levels yet.</p>
			{:else}
				{#if levelDeleteError}
					<p class="error levels-status">{levelDeleteError}</p>
				{/if}
				<ul class="levels-list">
					{#each levels as level (level.id)}
						<li>
							<div class="level-row">
								{#if level.is_deleted}
									<span class="level-title deleted">{level.title}</span>
								{:else}
									<a class="level-title" href="/edit/{level.id}">{level.title}</a>
								{/if}
								<span
									class="visibility-badge"
									class:published={level.visibility_state === 'published'}
									class:deleted={level.is_deleted}
								>
									{level.is_deleted ? 'deleted' : level.visibility_state}
								</span>
								{#if !level.is_deleted}
									<button
										class="delete-level-button"
										onclick={() => requestDeleteLevel(level.id)}
										disabled={deletingLevelId === level.id}
									>
										Delete
									</button>
								{/if}
							</div>
							{#if levelPendingDeleteId === level.id}
								<div class="level-delete-confirm">
									<p class="note">
										{level.has_been_published
											? "This level has already been published - deleting it can't be undone, and it stays counted toward your published-level limit."
											: "This can't be undone."}
									</p>
									<div class="confirm-row">
										<button
											class="danger-button"
											onclick={() => confirmDeleteLevel(level.id)}
											disabled={deletingLevelId === level.id}
										>
											{deletingLevelId === level.id ? 'Deleting…' : 'Yes, delete'}
										</button>
										<button class="cancel-button" onclick={cancelDeleteLevel}>Cancel</button>
									</div>
								</div>
							{/if}
						</li>
					{/each}
				</ul>
			{/if}
		</div>

		<div class="card">
			<h1>Your account</h1>
			{#if auth.user}
				<p class="note public-profile-link">
					<a href="/u/{auth.user.username}">View your public profile</a>
				</p>
			{/if}

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

		<div class="card">
			<h2 class="twitch-heading">Twitch account</h2>

			{#if auth.user.twitch_id}
				<p class="note">
					Linked as <strong>{auth.user.twitch_display_name}</strong>.
				</p>
			{:else}
				<p class="note">Link your Twitch account to log in with it too.</p>
				<button class="twitch-button" onclick={redirectToTwitchLink}>
					Link Twitch account
				</button>
			{/if}
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

	.verify-banner {
		background: #3a301a;
		border-color: #ffd23f;
		padding: 20px 24px;
	}

	.verify-note {
		margin: 0;
		color: #ffe9a8;
	}

	.verify-note + .verify-note,
	.verify-banner .resend-button {
		margin-top: 12px;
	}

	.resend-button {
		font-size: 0.85rem;
		padding: 8px 14px;
		color: #ffe9a8;
		background: transparent;
		border: 1px solid #ffd23f;
	}

	.resend-button:hover:not(:disabled) {
		color: #3a301a;
		background: #ffd23f;
	}

	.resend-button:disabled {
		opacity: 0.6;
		cursor: not-allowed;
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

	/* Overrides the red danger-zone color above - this heading isn't a
	   warning, just this card's own title. */
	.new-level-heading {
		color: #c7cbef;
	}

	.new-level-button {
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

	.new-level-button:hover:not(:disabled) {
		transform: translateY(2px);
		box-shadow: 0 2px 0 #142013;
	}

	.new-level-button:disabled {
		opacity: 0.6;
		cursor: not-allowed;
	}

	.levels-status {
		margin: 16px 0 0;
	}

	.levels-list {
		list-style: none;
		margin: 16px 0 0;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: 10px;
	}

	.levels-list li {
		padding: 10px 12px;
		background: #1a1b3a;
		border: 2px solid #3a3d76;
		border-radius: 6px;
	}

	.level-row {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 12px;
	}

	.level-title {
		color: #f4f6ff;
		text-decoration: none;
		font-weight: 700;
		flex: 1;
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	a.level-title:hover {
		color: #4ecb71;
	}

	.level-title.deleted {
		color: #6b6f9e;
		text-decoration: line-through;
	}

	.visibility-badge {
		flex-shrink: 0;
		font-size: 0.75rem;
		text-transform: uppercase;
		letter-spacing: 0.04em;
		color: #c7cbef;
		border: 1px solid #3a3d76;
		border-radius: 999px;
		padding: 3px 10px;
	}

	.visibility-badge.published {
		color: #4ecb71;
		border-color: #4ecb71;
	}

	.visibility-badge.deleted {
		color: #ff8a7a;
		border-color: #ff8a7a;
	}

	.delete-level-button {
		flex-shrink: 0;
		font-size: 0.8rem;
		padding: 6px 12px;
		color: #ff8a7a;
		background: transparent;
		border: 1px solid #6b3838;
		box-shadow: none;
	}

	.delete-level-button:hover:not(:disabled) {
		color: #f4f6ff;
		background: #a83c3c;
		border-color: #a83c3c;
	}

	.level-delete-confirm {
		margin-top: 10px;
		padding-top: 10px;
		border-top: 1px solid #3a3d76;
	}

	.level-delete-confirm .note {
		margin: 0 0 10px;
	}

	/* Overrides the red danger-zone color above - this heading isn't a
	   warning, just this card's own title. */
	.twitch-heading {
		color: #c7cbef;
	}

	.twitch-button {
		color: #f4f6ff;
		background: #9146ff;
		border: 3px solid #5c1f99;
		box-shadow: 0 4px 0 #5c1f99;
	}

	.twitch-button:hover {
		transform: translateY(2px);
		box-shadow: 0 2px 0 #5c1f99;
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

	.public-profile-link a {
		color: #4ecb71;
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