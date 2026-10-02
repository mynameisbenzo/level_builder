<script lang="ts">
	import { onMount } from 'svelte';

	// The one real, current origin this app is meant to be reached at -
	// hand-maintained the same way FRONTEND_ORIGIN is in render.yaml,
	// not read from any shared config (this project doesn't have one -
	// see the other hand-duplicated constants like GRID_SIZE).
	const CANONICAL_ORIGIN = 'https://pixelmaker.win';

	let visible = $state(false);

	onMount(() => {
		// Same standalone-launch detection as IosInstallBanner.
		const isStandalone =
			window.matchMedia('(display-mode: standalone)').matches ||
			(window.navigator as Navigator & { standalone?: boolean }).standalone === true;

		// Only an installed/home-screen launch is checked here - a
		// stale bookmark opened in a regular browser tab isn't broken
		// the same way (an origin mismatch there is usually just a
		// Render PR preview deployment, each on its own onrender.com
		// subdomain, being opened deliberately for testing - not
		// something to warn a real visitor about).
		//
		// The underlying problem: a home-screen icon's target origin is
		// fixed by the OS at install time and can't be retargeted by
		// this app later. If Pixel Maker's domain ever moves again,
		// every already-installed icon silently breaks the same way
		// (API calls start failing CORS, surfacing as generic "could
		// not reach the server" errors) with no indication why - this
		// banner exists to make that failure legible instead of
		// mysterious.
		visible = isStandalone && window.location.origin !== CANONICAL_ORIGIN;
	});
</script>

{#if visible}
	<div class="banner" role="alert">
		<p>
			This shortcut points to an address Pixel Maker has moved away from, so logging in and
			saving won't work from here. Remove this icon from your home screen, then visit
			<strong>pixelmaker.win</strong> and add it again.
		</p>
	</div>
{/if}

<style>
	.banner {
		background: #3a1a1a;
		border-bottom: 2px solid #a83c3c;
		padding: 10px 16px;
		padding-top: calc(10px + env(safe-area-inset-top, 0px));
	}

	p {
		margin: 0;
		font-size: 0.85rem;
		color: #ffc7bd;
		text-align: center;
	}

	strong {
		color: #ff8a7a;
	}
</style>