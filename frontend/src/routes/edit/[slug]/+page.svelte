<script lang="ts">
	import { onDestroy, onMount, tick } from 'svelte';
	import { afterNavigate, goto } from '$app/navigation';
	import Phaser from 'phaser';
	import { beatLevel, getLevel, publishLevel, saveLevel } from '$lib/api';
	import { auth } from '$lib/auth.svelte';
	import { createGameConfig } from '$lib/game/gameConfig';
	import { serializeLevelContent, type LevelContent } from '$lib/game/levelContent';
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
	// A level is named exactly once, at its first publish, and locked
	// from then on - so this decides whether Publish asks for a name
	// (first time) or just publishes (every time after).
	let hasBeenPublished = $state(false);
	let visibilityState: 'draft' | 'testing' | 'published' = $state('draft');
	let hasBeenBeaten = $state(false);

	let saveStatus: 'idle' | 'saving' | 'saved' | 'error' = $state('idle');
	let saveError = $state('');

	let publishDialog: HTMLDialogElement = $state()!;
	let publishTitleInput: HTMLInputElement = $state()!;
	let publishTitle = $state('');
	let publishDialogOpen = $state(false);
	let publishStatus: 'idle' | 'publishing' | 'error' = $state('idle');
	let publishError = $state('');

	// What the server actually has stored, as of the last successful
	// save (or the initial load). Compared against the live editor
	// content to decide whether Back needs to ask about unsaved work,
	// and updated after every successful save/publish.
	let lastSavedContent: LevelContent | null = $state(null);
	let unsavedDialog: HTMLDialogElement = $state()!;
	let unsavedDialogOpen = $state(false);

	// Back goes to whatever page they were just on - EXCEPT the anonymous
	// /play sandbox, where "back" would just be a fresh, empty sandbox
	// with nothing in it (that page's own content is never the level
	// being edited here). history.back() is only trusted when SvelteKit
	// reports a real earlier in-app page that isn't the sandbox; opened
	// directly in a new tab, it would go nowhere (or off the site
	// entirely).
	let cameFromInApp = false;
	let cameFromSandbox = false;
	afterNavigate(({ from }) => {
		cameFromInApp = from !== null;
		cameFromSandbox = from?.url.pathname === '/play';
	});

	function performBack() {
		if (cameFromSandbox || !cameFromInApp) {
			goto('/profile');
		} else {
			history.back();
		}
	}

	function hasUnsavedChanges(): boolean {
		if (!game || lastSavedContent === null) return false;
		return JSON.stringify(serializeLevelContent(game.registry)) !== JSON.stringify(lastSavedContent);
	}

	function handleBackClick() {
		if (hasUnsavedChanges()) {
			setGameKeyboardEnabled(false);
			unsavedDialogOpen = true;
			unsavedDialog.showModal();
		} else {
			performBack();
		}
	}

	function handleUnsavedDialogCancel(event: Event) {
		// Same reasoning as the publish dialog's own cancel handler -
		// don't let Escape dismiss this mid-save, where the person would
		// lose track of whether it went through.
		if (saveStatus === 'saving') {
			event.preventDefault();
		}
	}

	function handleUnsavedDialogClosed() {
		unsavedDialogOpen = false;
		setGameKeyboardEnabled(true);
	}

	function leaveWithoutSaving() {
		unsavedDialog.close();
		performBack();
	}

	async function saveThenLeave() {
		await handleSave();
		if (saveStatus !== 'error') {
			unsavedDialog.close();
			performBack();
		}
		// On error, the dialog stays open and shows saveError - see the
		// markup below - rather than silently discarding the attempt.
	}

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
		hasBeenPublished = result.level.has_been_published;
		visibilityState = result.level.visibility_state;
		hasBeenBeaten = result.level.draft_beaten_at !== null;
		lastSavedContent = result.level.draft_content;
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
			lastSavedContent = content;
			saveStatus = 'saved';
		} else if (result.sessionExpired) {
			goto('/login');
		} else {
			saveStatus = 'error';
			saveError = result.error ?? 'Could not save. Please try again.';
		}
	}

	/**
	 * Phaser listens for key presses on the whole window, not on
	 * whatever element happens to have DOM focus - so without this,
	 * typing a level name would also drive the editor/game underneath
	 * (W/A/S/D and the arrow keys moving things, Space jumping), and
	 * Phaser calls preventDefault on the keys it "captures", which can
	 * swallow the space bar right out of the text field.
	 *
	 * keyboard.enabled = false makes Phaser's own key handlers return
	 * before queueing the event or calling preventDefault (checked
	 * against Phaser's KeyboardManager source), so this one flag both
	 * silences the game and lets typing behave normally.
	 *
	 * Held keys are reset in both directions: Phaser never sees the
	 * keyup for a key released while it isn't listening, so without
	 * this a key held down as the dialog opens (say, walking right in
	 * Play mode) would leave the character stuck walking.
	 */
	function setGameKeyboardEnabled(enabled: boolean) {
		if (!game) return;
		const keyboard = game.input.keyboard;
		if (!keyboard) return;

		keyboard.enabled = enabled;

		for (const scene of game.scene.getScenes(true)) {
			scene.input.keyboard?.resetKeys();
		}
	}

	function handlePublishClick() {
		if (hasBeenPublished) {
			// Already named, and the name is locked - nothing to ask.
			void runPublish();
		} else {
			openPublishDialog();
		}
	}

	function openPublishDialog() {
		// Deliberately empty rather than prefilled with the placeholder
		// title: this name is permanent, so it should be a deliberate
		// choice, not something Enter accepts by default.
		publishTitle = '';
		publishStatus = 'idle';
		publishError = '';
		publishDialogOpen = true;

		setGameKeyboardEnabled(false);
		publishDialog.showModal();
		publishTitleInput.focus();
	}

	function handlePublishDialogCancel(event: Event) {
		// Escape - but not mid-request, where closing the dialog would
		// leave the person with no feedback on whether it went through.
		if (publishStatus === 'publishing') {
			event.preventDefault();
		}
	}

	// Fires however the dialog closes (Escape, Cancel, a successful
	// publish), so the game's keyboard can't be left switched off.
	function handlePublishDialogClosed() {
		publishDialogOpen = false;
		setGameKeyboardEnabled(true);
	}

	/**
	 * Does the actual publish call and applies its result to the page.
	 * newTitle is only passed for a level's first publish - a published
	 * level's name is locked, so the server rejects one on any later
	 * publish. Returns whether it succeeded.
	 */
	async function runPublish(newTitle?: string): Promise<boolean> {
		const token = auth.accessToken;
		if (!token || !game) {
			goto('/login');
			return false;
		}

		publishStatus = 'publishing';
		publishError = '';

		// Publish always saves first, to pick up any live edits made
		// since the last explicit Save click - a win recorded against an
		// older saved draft would otherwise silently count toward
		// content that was never actually played. Safe to do
		// unconditionally: if nothing actually changed, the save is a
		// no-op on the server and the existing beat confirmation
		// survives (see save_level); if something DID change, the save
		// clears the beat and the check just below correctly stops the
		// publish rather than letting it through.
		const content = serializeLevelContent(game.registry);
		let saveResult = await saveLevel(slug, content, token);
		if (saveResult.sessionExpired) {
			const refreshed = await auth.tryRefresh();
			const refreshedToken = auth.accessToken;
			if (refreshed && refreshedToken) {
				saveResult = await saveLevel(slug, content, refreshedToken);
			}
		}

		if (!saveResult.success || !saveResult.level) {
			if (saveResult.sessionExpired) {
				publishStatus = 'idle';
				goto('/login');
				return false;
			}
			publishStatus = 'error';
			publishError = saveResult.error ?? 'Could not save your changes before publishing.';
			return false;
		}

		visibilityState = saveResult.level.visibility_state;
		hasBeenBeaten = saveResult.level.draft_beaten_at !== null;
		lastSavedContent = content;

		if (!hasBeenBeaten) {
			publishStatus = 'error';
			publishError =
				"You've changed the level since you beat it - play it through again before publishing.";
			return false;
		}

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
			hasBeenPublished = result.level.has_been_published;
			publishStatus = 'idle';
			return true;
		}

		if (result.sessionExpired) {
			publishStatus = 'idle';
			goto('/login');
			return false;
		}

		publishStatus = 'error';
		publishError = result.error ?? 'Could not publish. Please try again.';
		return false;
	}

	async function handlePublishSubmit(event: SubmitEvent) {
		event.preventDefault();

		const newTitle = publishTitle.trim();
		if (!newTitle) {
			publishError = 'Give your level a name first.';
			publishTitleInput.focus();
			return;
		}

		const published = await runPublish(newTitle);
		if (published || publishStatus !== 'error') {
			publishDialog.close();
		} else {
			publishTitleInput.focus();
		}
	}
</script>

<svelte:head>
	<title>{hasBeenPublished ? `Editing ${title}` : 'Editing a new level'} — Pixel Maker</title>
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
		<div class="toolbar-left">
			<button class="back-button" onclick={handleBackClick}>
				<span aria-hidden="true">←</span> Back
			</button>
		</div>

		<span class="level-title" class:unnamed={!hasBeenPublished} title={hasBeenPublished ? title : ''}>
            {hasBeenPublished ? title : 'Unnamed level'}
		</span>

		<div class="toolbar-right">
			<span class="visibility-badge" class:published={visibilityState === 'published'}>
				{visibilityState}
			</span>

			{#if saveStatus === 'error'}
				<span class="inline-error">{saveError}</span>
			{/if}
			{#if publishError && !publishDialogOpen}
				<span class="inline-error">{publishError}</span>
			{/if}

			<button onclick={handleSave} disabled={saveStatus === 'saving'}>
				{saveStatus === 'saving' ? 'Saving…' : 'Save'}
			</button>
			<button
				class="publish-button"
				onclick={handlePublishClick}
				disabled={!hasBeenBeaten || publishStatus === 'publishing'}
				title={hasBeenBeaten ? '' : 'Test and beat your level first'}
			>
				{publishStatus === 'publishing' && !publishDialogOpen ? 'Publishing…' : 'Publish'}
			</button>
		</div>
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
		onclose={handlePublishDialogClosed}
		oncancel={handlePublishDialogCancel}
		aria-labelledby="publish-dialog-heading"
	>
		<form onsubmit={handlePublishSubmit}>
			<h2 id="publish-dialog-heading">Name your level</h2>
			<p class="dialog-note">
				Choose carefully - once a level is published, its name can't be changed.
			</p>

			<input
				class="dialog-input"
				type="text"
				bind:this={publishTitleInput}
				bind:value={publishTitle}
				required
				maxlength={MAX_TITLE_LENGTH}
				readonly={publishStatus === 'publishing'}
				placeholder="Level name"
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

	<dialog
		class="publish-dialog"
		bind:this={unsavedDialog}
		onclose={handleUnsavedDialogClosed}
		oncancel={handleUnsavedDialogCancel}
		aria-labelledby="unsaved-dialog-heading"
	>
		<h2 id="unsaved-dialog-heading">You have unsaved changes</h2>
		<p class="dialog-note">Leave without saving, or save your progress first?</p>

		{#if unsavedDialogOpen && saveStatus === 'error'}
			<p class="dialog-error">{saveError}</p>
		{/if}

		<div class="dialog-actions">
			<button
				type="button"
				class="leave-button"
				onclick={leaveWithoutSaving}
				disabled={saveStatus === 'saving'}
			>
				Leave without saving
			</button>
			<button
				type="button"
				class="publish-button"
				onclick={saveThenLeave}
				disabled={saveStatus === 'saving'}
			>
				{saveStatus === 'saving' ? 'Saving…' : 'Save and leave'}
			</button>
		</div>
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

	/* Three columns so the name sits in the true center regardless of
	   how wide the back button and the action buttons happen to be. */
	.toolbar {
		display: grid;
		grid-template-columns: minmax(0, 1fr) auto minmax(0, 1fr);
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

	.toolbar-left {
		justify-self: start;
	}

	.toolbar-right {
		justify-self: end;
		display: flex;
		align-items: center;
		gap: 12px;
	}

	.level-title {
		max-width: 40vw;
		font-family: 'Baloo 2', sans-serif;
		font-weight: 700;
		font-size: 0.95rem;
		text-align: center;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.level-title.unnamed {
		font-weight: 500;
		font-style: italic;
		color: #8f94c9;
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

	.cancel-button,
	.back-button {
		color: #c7cbef;
		background: transparent;
		border: 1px solid #3a3d76;
	}

	.leave-button {
		color: #f4f6ff;
		background: #a83c3c;
	}

	.back-button:hover {
		color: #f4f6ff;
		border-color: #6b6f9e;
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