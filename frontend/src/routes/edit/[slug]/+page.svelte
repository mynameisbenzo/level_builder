<script lang="ts">
	import { onDestroy, onMount, tick } from 'svelte';
	import { goto } from '$app/navigation';
	import Phaser from 'phaser';
	import { beatLevel, getLevel, publishLevel, saveLevel } from '$lib/api';
	import { auth } from '$lib/auth.svelte';
	import { createGameConfig } from '$lib/game/gameConfig';
	import { serializeLevelContent } from '$lib/game/levelContent';
	import { LEVEL_BEATEN_EVENT } from '$lib/game/PlatformerScene';
	import TouchControls from '$lib/game/TouchControls.svelte';
	import LandscapeGuard from '$lib/game/LandscapeGuard.svelte';
	import type { PageProps } from './$types';

	// Mirrors the backend's MAX_TITLE_LENGTH (app/api/levels.py), which
	// itself mirrors the Level.title column - kept in sync by hand, same
	// as the other cross-language constants in this project.
	const MAX_TITLE_LENGTH = 120;

	let { params }: PageProps = $props();
	const slug = $derived(params.slug);

	let gameContainer: HTMLDivElement = $state()!;
	let game: Phaser.Game | undefined;

	let loadStatus: 'loading' | 'ready' | 'error' = $state('loading');
	let loadError = $state('');

	// The level's current name, shown read-only in the toolbar. It's only
	// ever changed by the publish dialog below - naming a level happens
	// at publish time, not as a free-floating field while editing.
	let title = $state('');
	let visibilityState: 'draft' | 'testing' | 'published' = $state('draft');
	let hasBeenBeaten = $state(false);

	let saveStatus: 'idle' | 'saving' | 'saved' | 'error' = $state('idle');
	let saveError = $state('');

	let publishDialog: HTMLDialogElement = $state()!;
	let publishTitleInput: HTMLInputElement = $state()!;
	let publishTitle = $state('');
	let publishStatus: 'idle' | 'publishing' | 'error' = $state('idle');
	let publishError = $state('');

	async function handleLevelBeaten() {
		const token = auth.accessToken;
		if (!token) return;

		let result = await beatLevel(slug, token);
		if (result.sessionExpired) {
			const refreshed = await auth.tryRefresh();
			const refreshedToken = auth.accessToken;
			if (refreshed && refreshedToken) {
				result = await beatLevel(slug, refreshedToken);
			}
		}

		if (result.success && result.level) {
			hasBeenBeaten = result.level.draft_beaten_at !== null;
		} else if (result.sessionExpired) {
			goto('/login');
		}
		// A failed beat call otherwise just means the Publish button
		// stays disabled - not worth interrupting the "Level Cleared!"
		// moment with an error message for this.
	}

	onMount(async () => {
		if (!auth.isLoggedIn) {
			goto('/login');
			return;
		}
		const token = auth.accessToken;
		if (!token) return;

		let result = await getLevel(slug, token);
		if (result.sessionExpired) {
			const refreshed = await auth.tryRefresh();
			const refreshedToken = auth.accessToken;
			if (refreshed && refreshedToken) {
				result = await getLevel(slug, refreshedToken);
			}
		}

		if (!result.success || !result.level) {
			if (result.sessionExpired) {
				goto('/login');
				return;
			}
			loadStatus = 'error';
			loadError = result.error ?? 'Could not load this level.';
			return;
		}

		title = result.level.title;
		visibilityState = result.level.visibility_state;
		hasBeenBeaten = result.level.draft_beaten_at !== null;
		loadStatus = 'ready';

		const content = result.level.draft_content ?? undefined;

		// loadStatus just flipped to 'ready' above, which is what makes
		// the {#if loadStatus === 'ready'} block - and gameContainer,
		// the bind:this target inside it - actually exist in the DOM.
		// Svelte batches that DOM update rather than applying it
		// synchronously here, so tick() (Svelte's own documented way to
		// await the next completed update) is needed before
		// gameContainer is safe to use.
		await tick();
		if (!gameContainer) return;

		game = new Phaser.Game(createGameConfig(gameContainer, { startMode: 'edit', content }));
		game.events.on(LEVEL_BEATEN_EVENT, handleLevelBeaten);
	});

	onDestroy(() => {
		game?.destroy(true);
	});

	async function handleSave() {
		const token = auth.accessToken;
		if (!token || !game) return;

		saveStatus = 'saving';
		saveError = '';

		// Content only - the title isn't part of a save anymore, it's
		// set by the publish dialog.
		const content = serializeLevelContent(game.registry);
		let result = await saveLevel(slug, content, token);

		if (result.sessionExpired) {
			const refreshed = await auth.tryRefresh();
			const refreshedToken = auth.accessToken;
			if (refreshed && refreshedToken) {
				result = await saveLevel(slug, content, refreshedToken);
			}
		}

		if (result.success && result.level) {
			visibilityState = result.level.visibility_state;
			hasBeenBeaten = result.level.draft_beaten_at !== null;
			saveStatus = 'saved';
		} else if (result.sessionExpired) {
			goto('/login');
		} else {
			saveStatus = 'error';
			saveError = result.error ?? 'Could not save. Please try again.';
		}
	}

	function openPublishDialog() {
		publishTitle = title;
		publishStatus = 'idle';
		publishError = '';

		publishDialog.showModal();
		publishTitleInput.focus();
		publishTitleInput.select();
	}

	function handlePublishDialogCancel(event: Event) {
		// Escape - but not mid-request, where closing the dialog would
		// leave the person with no feedback on whether it went through.
		if (publishStatus === 'publishing') {
			event.preventDefault();
		}
	}

	async function handlePublishSubmit(event: SubmitEvent) {
		event.preventDefault();
		const token = auth.accessToken;
		if (!token) return;

		const newTitle = publishTitle.trim();
		if (!newTitle) {
			publishError = 'Give your level a name first.';
			publishTitleInput.focus();
			return;
		}

		publishStatus = 'publishing';
		publishError = '';

		let result = await publishLevel(slug, token, newTitle);
		if (result.sessionExpired) {
			const refreshed = await auth.tryRefresh();
			const refreshedToken = auth.accessToken;
			if (refreshed && refreshedToken) {
				result = await publishLevel(slug, refreshedToken, newTitle);
			}
		}

		if (result.success && result.level) {
			visibilityState = result.level.visibility_state;
			title = result.level.title;
			publishStatus = 'idle';
			publishDialog.close();
		} else if (result.sessionExpired) {
			publishStatus = 'idle';
			publishDialog.close();
			goto('/login');
		} else {
			publishStatus = 'error';
			publishError = result.error ?? 'Could not publish. Please try again.';
			publishTitleInput.focus();
		}
	}
</script>

<svelte:head>
	<title>{title ? `Editing ${title}` : 'Editing…'} — Pixel Maker</title>
</svelte:head>

{#key params.slug}
{#if loadStatus === 'loading'}
	<div class="status-page">
		<p>Loading…</p>
	</div>
{:else if loadStatus === 'error'}
	<div class="status-page">
		<p class="error">{loadError}</p>
		<a href="/profile">Back to your account</a>
	</div>
{:else}
	<div class="toolbar">
		<span class="level-title" title={title}>{title}</span>

		<span class="visibility-badge" class:published={visibilityState === 'published'}>
			{visibilityState}
		</span>

		{#if saveStatus === 'error'}
			<span class="inline-error">{saveError}</span>
		{/if}
		<button onclick={handleSave} disabled={saveStatus === 'saving'}>
			{saveStatus === 'saving' ? 'Saving…' : 'Save'}
		</button>

		<button
			class="publish-button"
			onclick={openPublishDialog}
			disabled={!hasBeenBeaten}
			title={hasBeenBeaten ? '' : 'Test and beat your level first'}
		>
			Publish
		</button>
	</div>

	<div class="game-page">
		<TouchControls />
		<LandscapeGuard />
		<div class="game-container" bind:this={gameContainer}></div>
	</div>

	<!--
		Deliberately a sibling of .game-page, not inside it: that
		container sets user-select: none (and friends) for the sake of
		touch play, which inherits down into anything nested in it - and
		iOS Safari refuses to let you type into an input with
		-webkit-user-select: none.
	-->
	<dialog
		class="publish-dialog"
		bind:this={publishDialog}
		oncancel={handlePublishDialogCancel}
		aria-labelledby="publish-dialog-heading"
	>
		<form onsubmit={handlePublishSubmit}>
			<h2 id="publish-dialog-heading">Name your level</h2>
			<p class="dialog-note">This is the name people will see once it's published.</p>

			<input
				class="dialog-input"
				type="text"
				bind:this={publishTitleInput}
				bind:value={publishTitle}
				required
				maxlength={MAX_TITLE_LENGTH}
				readonly={publishStatus === 'publishing'}
				aria-label="Level name"
			/>

			{#if publishError}
				<p class="dialog-error">{publishError}</p>
			{/if}

			<div class="dialog-actions">
				<button
					type="button"
					class="cancel-button"
					onclick={() => publishDialog.close()}
					disabled={publishStatus === 'publishing'}
				>
					Cancel
				</button>
				<button type="submit" class="publish-button" disabled={publishStatus === 'publishing'}>
					{publishStatus === 'publishing' ? 'Publishing…' : 'Publish'}
				</button>
			</div>
		</form>
	</dialog>
{/if}
{/key}

<style>
	.status-page {
		min-height: 100dvh;
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		gap: 16px;
		background: #1a1b3a;
		color: #f4f6ff;
	}

	.status-page a {
		color: #4ecb71;
	}

	.error {
		color: #ff8a7a;
	}

	.toolbar {
		display: flex;
		align-items: center;
		gap: 12px;
		padding: 10px 16px;
		padding-top: calc(10px + env(safe-area-inset-top, 0px));
		background: #252650;
		border-bottom: 2px solid #3a3d76;
		color: #f4f6ff;
		font-family: 'Manrope', sans-serif;
		position: relative;
		z-index: 10;
	}

	.level-title {
		flex: 1;
		min-width: 0;
		font-family: 'Baloo 2', sans-serif;
		font-weight: 700;
		font-size: 0.95rem;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
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

	.inline-error {
		flex-shrink: 0;
		font-size: 0.8rem;
		color: #ff8a7a;
	}

	button {
		flex-shrink: 0;
		font-family: 'Baloo 2', sans-serif;
		font-weight: 700;
		font-size: 0.85rem;
		color: #142013;
		background: #4ecb71;
		border: none;
		border-radius: 8px;
		padding: 8px 14px;
		cursor: pointer;
	}

	button:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}

	.publish-button {
		color: #f4f6ff;
		background: #9146ff;
	}

	.cancel-button {
		color: #c7cbef;
		background: transparent;
		border: 1px solid #3a3d76;
	}

	.publish-dialog {
		width: min(420px, calc(100vw - 32px));
		padding: 24px;
		background: #252650;
		color: #f4f6ff;
		border: 2px solid #3a3d76;
		border-radius: 10px;
		font-family: 'Manrope', sans-serif;
	}

	.publish-dialog::backdrop {
		background: rgba(10, 10, 30, 0.75);
	}

	.publish-dialog h2 {
		margin: 0 0 6px;
		font-family: 'Baloo 2', sans-serif;
		font-weight: 700;
		font-size: 1.2rem;
	}

	.dialog-note {
		margin: 0 0 16px;
		font-size: 0.85rem;
		line-height: 1.5;
		color: #b6baec;
	}

	.dialog-input {
		width: 100%;
		box-sizing: border-box;
		font-family: 'Manrope', sans-serif;
		font-size: 1rem;
		color: #f4f6ff;
		background: #1a1b3a;
		border: 2px solid #3a3d76;
		border-radius: 6px;
		padding: 10px 12px;
	}

	.dialog-input:focus-visible {
		outline: none;
		border-color: #4ecb71;
	}

	.dialog-error {
		margin: 10px 0 0;
		font-size: 0.85rem;
		color: #ff8a7a;
	}

	.dialog-actions {
		display: flex;
		justify-content: flex-end;
		gap: 10px;
		margin-top: 18px;
	}

	.game-page {
		width: 100vw;
		height: calc(100dvh - 56px);
		overflow: hidden;
		background: #000;
		touch-action: none;
		user-select: none;
		-webkit-user-select: none;
		-webkit-touch-callout: none;
	}

	.game-container {
		width: 100%;
		height: 100%;
	}

	.game-container :global(canvas) {
		display: block;
	}
</style>