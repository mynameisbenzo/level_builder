<script lang="ts">
	import { onDestroy, onMount } from 'svelte';
	import { getUserByUsername, listLevelsByUser, type LevelListItem, type PublicUser } from '$lib/api';
	import Navbar from '$lib/Navbar.svelte';
	import type { PageProps } from './$types';

	let { params }: PageProps = $props();
	const username = $derived(params.username);

	let status: 'loading' | 'ready' | 'not_found' | 'error' = $state('loading');
	let errorMessage = $state('');
	let user: PublicUser | undefined = $state();
	let levels: LevelListItem[] = $state([]);

	// Same copy-link pattern as the Share buttons elsewhere (see
	// /profile) - lets anyone looking at this page, owner or visitor,
	// copy a link straight to it rather than needing to grab the
	// browser's own address bar.
	let shareStatus: 'idle' | 'copied' | 'error' = $state('idle');
	let shareStatusResetTimeout: ReturnType<typeof setTimeout> | undefined;

	async function handleShareClick() {
		const url = `${window.location.origin}/u/${username}`;

		try {
			await navigator.clipboard.writeText(url);
			shareStatus = 'copied';
		} catch {
			window.prompt('Copy this link:', url);
			shareStatus = 'error';
		}

		clearTimeout(shareStatusResetTimeout);
		shareStatusResetTimeout = setTimeout(() => {
			shareStatus = 'idle';
		}, 2000);
	}

	// Per-level Share button feedback - same keyed-by-id pattern as
	// /profile's own level list, copying the public /play link instead
	// of the /edit one since there's no edit access from here.
	let levelShareStatusById: Record<string, 'idle' | 'copied' | 'error'> = $state({});
	const levelShareStatusResetTimeouts: Record<string, ReturnType<typeof setTimeout>> = {};

	async function handleShareLevelClick(id: string) {
		const url = `${window.location.origin}/play/${id}`;

		try {
			await navigator.clipboard.writeText(url);
			levelShareStatusById[id] = 'copied';
		} catch {
			window.prompt('Copy this link:', url);
			levelShareStatusById[id] = 'error';
		}

		clearTimeout(levelShareStatusResetTimeouts[id]);
		levelShareStatusResetTimeouts[id] = setTimeout(() => {
			levelShareStatusById[id] = 'idle';
		}, 2000);
	}

	onMount(async () => {
		const [userResult, levelsResult] = await Promise.all([
			getUserByUsername(username),
			listLevelsByUser(username)
		]);

		if (!userResult.success || !userResult.user) {
			// A missing user is the common, expected case here (a typo'd
			// or never-registered username), not really an "error" -
			// shown with its own message rather than the generic one.
			status = 'not_found';
			return;
		}

		user = userResult.user;
		levels = levelsResult.levels ?? [];
		status = 'ready';

		if (!levelsResult.success) {
			// The user themselves still loaded fine - just note the
			// levels list specifically didn't, rather than failing the
			// whole page over it.
			errorMessage = levelsResult.error ?? 'Could not load this user\u2019s levels.';
		}
	});

	onDestroy(() => {
		clearTimeout(shareStatusResetTimeout);
		for (const timeout of Object.values(levelShareStatusResetTimeouts)) {
			clearTimeout(timeout);
		}
	});
</script>

<svelte:head>
	<title>{user ? `${user.username}` : 'Profile'} — Pixel Maker</title>
</svelte:head>

<Navbar />

{#key username}
	<main>
		{#if status === 'loading'}
			<div class="card">
				<p class="note">Loading…</p>
			</div>
		{:else if status === 'not_found'}
			<div class="card">
				<p class="note">No user found with that username.</p>
			</div>
		{:else if user}
			<div class="card">
				<div class="profile-header">
					<h1>{user.username}</h1>
					<button class="share-profile-button" onclick={handleShareClick}>
						{#if shareStatus === 'copied'}
							Copied!
						{:else if shareStatus === 'error'}
							Couldn't copy
						{:else}
							Share
						{/if}
					</button>
				</div>
				{#if user.twitch_display_name}
					<p class="note secondary">Twitch: {user.twitch_display_name}</p>
				{/if}
			</div>

			<div class="card">
				<h2>Levels</h2>

				{#if errorMessage}
					<p class="error">{errorMessage}</p>
				{:else if levels.length === 0}
					<p class="note">{user.username} hasn't published any levels yet.</p>
				{:else}
					<ul class="levels-list">
						{#each levels as level (level.id)}
							<li>
								<div class="level-item">
									{#if level.thumbnail_url}
										<img class="level-thumbnail" src={level.thumbnail_url} alt="" loading="lazy" />
									{:else}
										<div class="level-thumbnail level-thumbnail-placeholder" aria-hidden="true"></div>
									{/if}
									<div class="level-main">
										<div class="level-row">
											<a class="level-title" href="/play/{level.id}">{level.title}</a>
											<button
												class="share-level-button"
												onclick={() => handleShareLevelClick(level.id)}
												title="Copy a link to this level"
											>
												{#if levelShareStatusById[level.id] === 'copied'}
													Copied!
												{:else if levelShareStatusById[level.id] === 'error'}
													Couldn't copy
												{:else}
													Share
												{/if}
											</button>
										</div>
										<div class="level-metrics">
											<span class="metric"
												>{level.play_count} {level.play_count === 1 ? 'play' : 'plays'}</span
											>
											<span class="metric"
												>{level.completion_count}
												{level.completion_count === 1 ? 'completion' : 'completions'}</span
											>
											<span class="metric">
												{level.completion_rate === null
													? 'no completion rate yet'
													: `${Math.round(level.completion_rate * 100)}% completion rate`}
											</span>
											<span class="metric metric-likes">👍 {level.like_count}</span>
											<span class="metric metric-dislikes">👎 {level.dislike_count}</span>
										</div>
									</div>
								</div>
							</li>
						{/each}
					</ul>
				{/if}
			</div>
		{/if}
	</main>
{/key}

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

	.profile-header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 12px;
		flex-wrap: wrap;
	}

	h1 {
		font-family: 'Baloo 2', sans-serif;
		font-weight: 700;
		font-size: 1.6rem;
		margin: 0;
	}

	.share-profile-button {
		flex-shrink: 0;
		font-family: 'Baloo 2', sans-serif;
		font-weight: 700;
		font-size: 0.8rem;
		padding: 6px 12px;
		color: #c7cbef;
		background: transparent;
		border: 1px solid #3a3d76;
		border-radius: 10px;
		cursor: pointer;
	}

	.share-profile-button:hover {
		color: #f4f6ff;
		border-color: #6b6f9e;
	}

	h2 {
		font-family: 'Baloo 2', sans-serif;
		font-weight: 700;
		font-size: 1.15rem;
		margin: 0 0 16px;
		color: #c7cbef;
	}

	.note {
		font-size: 0.95rem;
		line-height: 1.6;
		color: #b6baec;
		margin: 0;
	}

	.note.secondary {
		margin-top: 8px;
		font-size: 0.85rem;
	}

	.error {
		font-size: 0.9rem;
		color: #ff8a7a;
		margin: 0;
	}

	.levels-list {
		list-style: none;
		margin: 0;
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

	.level-item {
		display: flex;
		gap: 12px;
		align-items: flex-start;
	}

	.level-thumbnail {
		flex-shrink: 0;
		width: 84px;
		height: 63px;
		border-radius: 4px;
		border: 1px solid #3a3d76;
		background: #14152c;
		object-fit: cover;
	}

	.level-thumbnail-placeholder {
		/* No capture for this level (the best-effort screenshot just
		   didn't come through) - a plain blank tile rather than leaving
		   a gap where the image would be. */
		background: repeating-linear-gradient(
			135deg,
			#14152c,
			#14152c 8px,
			#1a1b3a 8px,
			#1a1b3a 16px
		);
	}

	.level-main {
		flex: 1;
		min-width: 0;
	}

	.level-row {
		display: flex;
		align-items: center;
		flex-wrap: wrap;
		gap: 8px 12px;
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

	.level-title:hover {
		color: #4ecb71;
	}

	.share-level-button {
		flex-shrink: 0;
		font-family: 'Baloo 2', sans-serif;
		font-weight: 700;
		font-size: 0.8rem;
		padding: 6px 12px;
		color: #c7cbef;
		background: transparent;
		border: 1px solid #3a3d76;
		border-radius: 10px;
		cursor: pointer;
	}

	.share-level-button:hover {
		color: #f4f6ff;
		border-color: #6b6f9e;
	}

	.level-metrics {
		display: flex;
		flex-wrap: wrap;
		gap: 4px 14px;
		margin-top: 8px;
		padding-top: 8px;
		border-top: 1px solid #3a3d76;
	}

	.metric {
		font-size: 0.78rem;
		color: #9498d1;
	}

	.metric-likes {
		color: #4ecb71;
	}

	.metric-dislikes {
		color: #ff8a7a;
	}
</style>