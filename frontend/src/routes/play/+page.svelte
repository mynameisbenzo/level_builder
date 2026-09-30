<script lang="ts">
	import { onDestroy, onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import Phaser from 'phaser';
	import { createLevel, saveLevel } from '$lib/api';
	import { auth, STORAGE_KEY as AUTH_STORAGE_KEY } from '$lib/auth.svelte';
	import { createGameConfig } from '$lib/game/gameConfig';
	import { serializeLevelContent, type LevelContent } from '$lib/game/levelContent';
	import {
		clearPendingLevelContent,
		getPendingLevelContent,
		storePendingLevelContent
	} from '$lib/pendingLevelContent';
	import TouchControls from '$lib/game/TouchControls.svelte';
	import LandscapeGuard from '$lib/game/LandscapeGuard.svelte';

	let gameContainer: HTMLDivElement;
	let game: Phaser.Game | undefined;

	let saveStatus: 'idle' | 'waiting-for-signup' | 'creating' | 'error' = $state('idle');
	let saveError = $state('');

	let signupWindow: Window | null = null;
	let signupWindowWatcher: ReturnType<typeof setInterval> | null = null;

	onMount(() => {
		// Plain sandbox session - no level identity to start. Saving
		// (see handleSaveClick below) is what actually gives it one, by
		// creating a real level and handing off to /edit/[slug].
		game = new Phaser.Game(createGameConfig(gameContainer, { startMode: 'edit' }));

		// Covers two cases at once: this exact tab had Save clicked on
		// it earlier and is only now noticing login completed (also
		// handled live by the storage listener below - this just also
		// catches it right on load); or this tab was fully discarded
		// and reloaded by the browser while backgrounded, so its live
		// game state is gone, but the content survived in localStorage
		// regardless (see pendingLevelContent.ts).
		void checkForPendingSave();
	});

	onDestroy(() => {
		game?.destroy(true);
		window.removeEventListener('storage', handleStorageEvent);
		stopWatchingSignupWindow();
	});

	async function checkForPendingSave() {
		const pending = getPendingLevelContent();
		if (!pending) return;

		auth.syncFromStorage();
		if (auth.isLoggedIn) {
			await finishPendingSave(pending);
		} else {
			saveStatus = 'waiting-for-signup';
			window.addEventListener('storage', handleStorageEvent);
		}
	}

	/**
	 * Creates the level and saves the given content into it, then hands
	 * off to the real editor. Always uses the content it's explicitly
	 * given - when resuming after a signup detour, that's whatever was
	 * persisted to localStorage at the moment Save was clicked, never a
	 * fresh re-serialization of whatever this tab's live game happens
	 * to hold right now. That live state may no longer exist at all (a
	 * fresh reload after the tab was discarded starts an entirely new,
	 * empty game), so the persisted copy is the one reliable source of
	 * truth for what was actually built.
	 */
	async function finishPendingSave(content: LevelContent) {
		const token = auth.accessToken;
		if (!token) {
			saveStatus = 'error';
			saveError = 'Something went wrong. Please try again.';
			return;
		}

		saveStatus = 'creating';

		const createResult = await createLevel('Untitled Level', token);
		if (!createResult.success || !createResult.level) {
			saveStatus = 'error';
			saveError = createResult.error ?? 'Could not create your level. Please try again.';
			return;
		}

		// Whether or not the save just below succeeds, the level now
		// exists and owns this content's fate - clear the pending copy
		// either way, rather than risk it resurfacing in some later,
		// unrelated sandbox session.
		clearPendingLevelContent();

		console.log('Saving content into new level:', createResult.level.id, content);
		const saveResult = await saveLevel(createResult.level.id, content, token);
		if (!saveResult.success) {
			// The level itself was created, but the content failed to
			// save into it - don't silently redirect into what would
			// look like an empty level with no explanation. Surface the
			// real error so it's actually visible what went wrong
			// (most likely a validation problem - there's still no
			// client-side enforcement of the object budgets in the
			// anonymous sandbox, only the backend's).
			console.error('Pending level content failed to save:', saveResult.error, content);
			saveStatus = 'error';
			saveError = saveResult.error ?? 'Could not save your level. Please try again.';
			return;
		}

		await goto(`/edit/${createResult.level.id}`);
	}

	function handleStorageEvent(event: StorageEvent) {
		if (event.key !== AUTH_STORAGE_KEY || !event.newValue) return;
		window.removeEventListener('storage', handleStorageEvent);
		stopWatchingSignupWindow();

		const pending = getPendingLevelContent();
		if (auth.syncFromStorage() && pending) {
			void finishPendingSave(pending);
		} else {
			saveStatus = 'idle';
		}
	}

	function stopWatchingSignupWindow() {
		if (signupWindowWatcher !== null) {
			clearInterval(signupWindowWatcher);
			signupWindowWatcher = null;
		}
		signupWindow?.close();
		signupWindow = null;
	}

	function handleSaveClick() {
		// Covers the person having already signed up in some other tab
		// (or even this one, earlier) since the sandbox loaded, without
		// needing an actual storage event to have fired in between.
		auth.syncFromStorage();

		if (auth.isLoggedIn) {
			if (!game) return;
			void finishPendingSave(serializeLevelContent(game.registry));
			return;
		}

		// Persisted now, before opening anything - so the work survives
		// regardless of what the browser does to this tab while it's
		// backgrounded during signup (see pendingLevelContent.ts).
		if (game) {
			const content = serializeLevelContent(game.registry);
			console.log('Storing pending level content:', content);
			storePendingLevelContent(content);
		}

		// A real popup window (width/height plus the no-menubar/toolbar/
		// status features, which is what actually gets most browsers to
		// render this as a distinct window rather than folding it into
		// a tab of the current one - width/height alone often isn't
		// enough signal on their own). location stays visible
		// deliberately, even in a popup - /signup can lead into the
		// Twitch OAuth flow, which genuinely navigates to Twitch's own
		// domain mid-flow, and hiding the address bar there would
		// remove the one visual cue that lets someone confirm they're
		// actually on Twitch's real site. Opened synchronously, directly
		// inside this click handler - popup blockers reliably allow
		// this, but would likely block a window opened after an
		// intervening await.
		signupWindow = window.open(
			'/signup',
			'pixelmaker-signup',
			'width=480,height=720,menubar=no,toolbar=no,status=no,location=yes,resizable=yes,scrollbars=yes'
		);

		saveStatus = 'waiting-for-signup';
		window.addEventListener('storage', handleStorageEvent);

		// Best-effort, not needed for correctness (the storage listener
		// and the on-load check both still work regardless of this) -
		// just drops the UI back to idle promptly if the person closes
		// the popup themselves without finishing, rather than leaving
		// an unexplained "waiting" state sitting there.
		signupWindowWatcher = setInterval(() => {
			if (signupWindow?.closed) {
				stopWatchingSignupWindow();
				if (saveStatus === 'waiting-for-signup') {
					saveStatus = 'idle';
				}
			}
		}, 1000);
	}

	function cancelWaitingForSignup() {
		window.removeEventListener('storage', handleStorageEvent);
		stopWatchingSignupWindow();
		saveStatus = 'idle';
	}
</script>

<div class="toolbar">
	{#if saveStatus === 'waiting-for-signup'}
		<p class="waiting-text">
			Waiting for you to finish signing up in the window that just opened. Your work is saved
			and won't be lost.
		</p>
		<button class="cancel-button" onclick={cancelWaitingForSignup}>Cancel</button>
	{:else}
		{#if saveStatus === 'error'}
			<span class="inline-error">{saveError}</span>
		{/if}
		<button onclick={handleSaveClick} disabled={saveStatus === 'creating'}>
			{saveStatus === 'creating' ? 'Saving…' : 'Save'}
		</button>
	{/if}
</div>

<div class="game-page">
	<TouchControls />
	<LandscapeGuard />
	<div class="game-container" bind:this={gameContainer}></div>
</div>

<style>
	.toolbar {
		display: flex;
		align-items: center;
		justify-content: flex-end;
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

	.waiting-text {
		flex: 1;
		margin: 0;
		font-size: 0.85rem;
		color: #c7cbef;
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

	.cancel-button {
		color: #c7cbef;
		background: transparent;
		border: 1px solid #3a3d76;
	}

	.game-page {
		width: 100vw;
		height: calc(100dvh - 56px);
		overflow: hidden;
		background: #000;
		/* Without these, a real touchscreen intercepts touch-and-drag
		   gestures for its own native scroll/pan behavior before they
		   ever reach Phaser as pointer events - this is what breaks
		   touch-drag placement in the Editor. touch-action: none stops
		   that; the rest stop a tap-and-hold from triggering text
		   selection or (on iOS specifically) the long-press context
		   menu. Applied at the page level, not just the canvas, so the
		   on-screen touch controls get the same protection - holding the
		   jump button shouldn't trigger selection either. */
		touch-action: none;
		user-select: none;
		-webkit-user-select: none;
		-webkit-touch-callout: none;
	}

	.game-container {
		width: 100%;
		height: 100%;
		/* touch-action isn't inherited from .game-page above - measured
		   directly in a real browser, the computed touch-action on this
		   element and the canvas inside it was still "auto" despite
		   .game-page's "none", which is exactly what let a touch-drag on
		   the canvas fall through to the browser's own text-selection
		   gesture. Repeated here and on the canvas itself (below) rather
		   than trusted to cascade down. */
		touch-action: none;
		user-select: none;
		-webkit-user-select: none;
		-webkit-touch-callout: none;
	}

	.game-container :global(canvas) {
		display: block;
		touch-action: none;
		user-select: none;
		-webkit-user-select: none;
		-webkit-touch-callout: none;
	}
</style>