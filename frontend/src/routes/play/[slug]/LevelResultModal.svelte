<script lang="ts">
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import { getLevelRating, rateLevel } from '$lib/api';
	import { auth } from '$lib/auth.svelte';
	import { formatRunTime } from '$lib/game/ghost';

	/**
	 * Shown over the game canvas whenever a public playthrough ends,
	 * either way (win or death) - see LEVEL_BEATEN_EVENT/LEVEL_DIED_EVENT
	 * in PlatformerScene.ts and the listeners in +page.svelte. Doesn't
	 * appear at all in the editor's own test-play flow (dying or winning
	 * there still uses the old "bounce back to Edit Mode" behavior),
	 * only here.
	 */
	let {
		outcome,
		slug,
		ownerUsername,
		onReplay,
		timeMs = null,
		totalMs = null,
		record = null
	}: {
		outcome: 'won' | 'died';
		slug: string;
		ownerUsername: string;
		onReplay: () => void;
		/** This last attempt's clear time - only passed for a win. */
		timeMs?: number | null;
		/** The player's total playtime across every try - a logged-in win only. */
		totalMs?: number | null;
		/** The level's playtime record (isNew when this clear just set it). */
		record?: { username: string; totalMs: number; isNew: boolean } | null;
	} = $props();

	// null until a rating is known one way or the other - either loaded
	// from a previous session (see onMount below) or set the moment a
	// rating actually goes through - then holds whichever one is
	// currently in effect, so clicking the other button reads as
	// "switch my rating" rather than a fresh, unrelated click. Both
	// buttons stay clickable the whole time (see rateLevel's own
	// switchable-by-design backend) - there's no "sent" lock-out the
	// way a plain like-only button would have.
	let myRating: 'like' | 'dislike' | null = $state(null);
	let ratingStatus: 'idle' | 'sending' | 'error' = $state('idle');
	let ratingError = $state('');

	// The modal doesn't render at all until this flips true - otherwise
	// a returning rater would see both buttons flash as unselected for
	// a beat before the existing rating loads and disables one of them.
	// Nothing (not even the backdrop) shows during that gap; the player
	// just stays on the frozen win/death screen a little longer, same
	// as the wait they already get from the win/death delay itself.
	let ready = $state(false);

	// Loads whatever rating this account already left on this level, if
	// any, so this opens with that choice already disabled/highlighted
	// instead of ever showing a moment where it looks unset. Silently
	// gives up on failure (including a session that couldn't be
	// refreshed) rather than blocking the modal forever on a network
	// hiccup - worst case both buttons just open enabled, same as the
	// never-rated-before case.
	onMount(async () => {
		if (!auth.accessToken) {
			ready = true;
			return;
		}

		let result = await getLevelRating(slug, auth.accessToken);
		if (result.sessionExpired) {
			const refreshed = await auth.tryRefresh();
			const refreshedToken = auth.accessToken;
			if (refreshed && refreshedToken) {
				result = await getLevelRating(slug, refreshedToken);
			}
		}

		if (result.success && result.isLike !== null && result.isLike !== undefined) {
			myRating = result.isLike ? 'like' : 'dislike';
		}

		ready = true;
	});

	async function handleRate(isLike: boolean) {
		if (!auth.accessToken || ratingStatus === 'sending') return;

		const requested = isLike ? 'like' : 'dislike';
		// Re-sending the same value the backend already has is harmless
		// (it's idempotent), but there's no reason to make the network
		// call for a button that's already selected.
		if (myRating === requested) return;

		ratingStatus = 'sending';
		ratingError = '';

		let result = await rateLevel(slug, isLike, auth.accessToken);
		if (result.sessionExpired) {
			const refreshed = await auth.tryRefresh();
			const refreshedToken = auth.accessToken;
			if (refreshed && refreshedToken) {
				result = await rateLevel(slug, isLike, refreshedToken);
			}
		}

		if (result.success) {
			myRating = requested;
			ratingStatus = 'idle';
		} else {
			ratingStatus = 'error';
			ratingError = result.error ?? 'Could not send your rating. Please try again.';
		}
	}

	function handleLeave() {
		goto(`/u/${ownerUsername}`);
	}
</script>

{#if ready}
	<div class="modal-backdrop">
		<div class="modal-card">
			<h2>{outcome === 'won' ? 'Level Cleared!' : 'You Died'}</h2>

			{#if outcome === 'won'}
				{#if totalMs !== null}
					<p class="time">Total time: <strong>{formatRunTime(totalMs)}</strong></p>
				{:else if timeMs !== null}
					<p class="time">Your time: <strong>{formatRunTime(timeMs)}</strong></p>
				{/if}
				{#if record?.isNew}
					<p class="record record-new">New record!</p>
				{:else if record}
					<p class="record">Record: {formatRunTime(record.totalMs)} by {record.username}</p>
				{/if}
			{/if}

			{#if auth.isLoggedIn}
				{#if ratingStatus === 'error'}
					<p class="error">{ratingError}</p>
				{/if}
				<div class="rating-row">
					<button
						class="rating-button"
						class:selected={myRating === 'like'}
						onclick={() => handleRate(true)}
						disabled={ratingStatus === 'sending' || myRating === 'like'}
					>
						👍 Like
					</button>
					<button
						class="rating-button"
						class:selected={myRating === 'dislike'}
						onclick={() => handleRate(false)}
						disabled={ratingStatus === 'sending' || myRating === 'dislike'}
					>
						👎 Dislike
					</button>
				</div>
			{/if}

			<div class="modal-actions">
				<button class="replay-button" onclick={onReplay}>Replay</button>
				<button class="leave-button" onclick={handleLeave}>Leave</button>
			</div>
		</div>
	</div>
{/if}

<style>
	.modal-backdrop {
		position: fixed;
		inset: 0;
		z-index: 1000;
		display: flex;
		align-items: center;
		justify-content: center;
		background: rgba(10, 10, 26, 0.75);
		padding: 20px;
	}

	.modal-card {
		width: 100%;
		max-width: 360px;
		background: #1a1b3a;
		border: 2px solid #3a3d76;
		border-radius: 10px;
		padding: 28px 24px;
		text-align: center;
		color: #f4f6ff;
	}

	h2 {
		font-family: 'Baloo 2', sans-serif;
		font-weight: 700;
		font-size: 1.4rem;
		margin: 0 0 20px;
		color: #ffd23f;
	}

	.time {
		margin: 0 0 6px;
		font-size: 1rem;
	}

	.record {
		margin: 0 0 18px;
		font-size: 0.85rem;
		color: #c7cbef;
	}

	.record-new {
		font-family: 'Baloo 2', sans-serif;
		font-weight: 700;
		font-size: 1.05rem;
		color: #4ecb71;
	}

	.error {
		color: #ff8a7a;
		font-size: 0.85rem;
		margin: 0 0 12px;
	}

	.rating-row {
		display: flex;
		gap: 10px;
		margin-bottom: 20px;
	}

	.rating-button {
		flex: 1;
		font-family: 'Baloo 2', sans-serif;
		font-weight: 700;
		font-size: 0.9rem;
		color: #f4f6ff;
		background: transparent;
		border: 3px solid #3a3d76;
		border-radius: 10px;
		padding: 10px;
		cursor: pointer;
		transition:
			background 0.15s ease,
			border-color 0.15s ease,
			color 0.15s ease;
	}

	.rating-button:hover:not(:disabled) {
		border-color: #6b6f9e;
	}

	.rating-button.selected {
		color: #142013;
		background: #ffd23f;
		border-color: #142013;
	}

	.rating-button:disabled {
		opacity: 0.6;
		cursor: not-allowed;
	}

	.modal-actions {
		display: flex;
		gap: 12px;
	}

	.replay-button,
	.leave-button {
		flex: 1;
		font-family: 'Baloo 2', sans-serif;
		font-weight: 700;
		font-size: 0.9rem;
		padding: 10px;
		border-radius: 8px;
		cursor: pointer;
	}

	.replay-button {
		color: #142013;
		background: #4ecb71;
		border: 2px solid #4ecb71;
	}

	.replay-button:hover {
		background: #5fdb81;
		border-color: #5fdb81;
	}

	.leave-button {
		color: #c7cbef;
		background: transparent;
		border: 2px solid #3a3d76;
	}

	.leave-button:hover {
		border-color: #6b6f9e;
		color: #f4f6ff;
	}
</style>