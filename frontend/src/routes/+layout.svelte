<script lang="ts">
	import '../app.css';
	import favicon from '$lib/assets/favicon.svg';
	import IosInstallBanner from '$lib/IosInstallBanner.svelte';

	let { children } = $props();
</script>

<svelte:head>
	<link rel="icon" href={favicon} />
	<link rel="manifest" href="/manifest.json" />
	<link rel="apple-touch-icon" href="/icons/icon-180.png" />
	<meta name="theme-color" content="#1a1b3a" />
	<!-- Safari 17+ honors display: standalone straight from the manifest
	     above - these are for older iOS versions that don't, and cost
	     nothing to include alongside it. -->
	<meta name="apple-mobile-web-app-capable" content="yes" />
	<meta name="apple-mobile-web-app-status-bar-style" content="black" />
	<meta name="apple-mobile-web-app-title" content="Pixel Maker" />
	<link rel="preconnect" href="https://fonts.googleapis.com" />
	<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin="anonymous" />
	<link
		href="https://fonts.googleapis.com/css2?family=Baloo+2:wght@500;700;800&family=Manrope:wght@400;500;600;700&display=swap"
		rel="stylesheet"
	/>
</svelte:head>

<IosInstallBanner />
{@render children()}