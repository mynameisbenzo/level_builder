<script lang="ts">
	import { onMount } from 'svelte';

	const DISMISSED_STORAGE_KEY = 'pixelmaker_ios_install_banner_dismissed';

	let visible = $state(false);

	onMount(() => {
		const userAgent = navigator.userAgent;

		// iPadOS 13+ can report as "Macintosh" with touch support - the
		// maxTouchPoints check catches that case too, not just the
		// classic "iPad"/"iPhone"/"iPod" substrings.
		const isIOS =
			/iPad|iPhone|iPod/.test(userAgent) ||
			(userAgent.includes('Macintosh') && navigator.maxTouchPoints > 1);

		// Chrome/Firefox/Edge/Opera on iOS are all still WebKit under the
		// hood, but none of them expose "Add to Home Screen" the way
		// Safari itself does - showing these instructions there would
		// just be confusing, since there's nothing matching to tap.
		const isOtherIOSBrowser = /CriOS|FxIOS|EdgiOS|OPiOS/.test(userAgent);

		const isAlreadyInstalled =
			window.matchMedia('(display-mode: standalone)').matches ||
			(window.navigator as Navigator & { standalone?: boolean }).standalone === true;

		let alreadyDismissed = false;
		try {
			alreadyDismissed = localStorage.getItem(DISMISSED_STORAGE_KEY) === 'true';
		} catch {
			// Storage unavailable - default to showing the banner rather
			// than silently never offering it.
		}

		visible = isIOS && !isOtherIOSBrowser && !isAlreadyInstalled && !alreadyDismissed;
	});

	function dismiss() {
		visible = false;
		try {
			localStorage.setItem(DISMISSED_STORAGE_KEY, 'true');
		} catch {
			// Nothing meaningful to do if this fails - it just means the
			// banner may show again on a future visit.
		}
	}
</script>

{#if visible}
	<div class="banner" role="note">
		<p>
			Install Pixel Maker: tap <strong>Share</strong>, then
			<strong>Add to Home Screen</strong>.
		</p>
		<button class="dismiss" onclick={dismiss} aria-label="Dismiss">×</button>
	</div>
{/if}

<style>
	.banner {
		display: flex;
		align-items: center;
		justify-content: center;
		gap: 12px;
		background: #252650;
		border-bottom: 2px solid #3a3d76;
		padding: 10px 16px;
		padding-top: calc(10px + env(safe-area-inset-top, 0px));
	}

	p {
		margin: 0;
		font-size: 0.85rem;
		color: #c7cbef;
		text-align: center;
	}

	strong {
		color: #4ecb71;
	}

	.dismiss {
		flex-shrink: 0;
		width: 24px;
		height: 24px;
		display: flex;
		align-items: center;
		justify-content: center;
		background: none;
		border: none;
		color: #6b6f9e;
		font-size: 1.2rem;
		line-height: 1;
		cursor: pointer;
		padding: 0;
	}

	.dismiss:hover {
		color: #f4f6ff;
	}

	.dismiss:focus-visible {
		outline: 2px solid #ffd23f;
		outline-offset: 2px;
	}
</style>