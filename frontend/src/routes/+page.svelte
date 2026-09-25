<script lang="ts">
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import { checkBackendHealth } from '$lib/api';
	import { auth } from '$lib/auth.svelte';
	import LevelPreviewHero from '$lib/LevelPreviewHero.svelte';
	import Navbar from '$lib/Navbar.svelte';

	let backendStatus: 'checking' | 'connected' | 'disconnected' = $state('checking');

	onMount(async () => {
		// The installed home-screen app's start_url is "/" (see
		// manifest.json) - regular browser visits to "/" (the Navbar
		// wordmark, a bookmark, a shared link) should always show the
		// normal marketing homepage, but launching the actual installed
		// app should skip straight to the account for anyone already
		// logged in, matching "open it and start playing" rather than
		// showing the pitch to someone who's already decided to use it.
		// display-mode: standalone / navigator.standalone is what tells
		// these two situations apart - true only when actually launched
		// from the home-screen icon, not a normal Safari/Chrome tab.
		const isStandalone =
			window.matchMedia('(display-mode: standalone)').matches ||
			(window.navigator as Navigator & { standalone?: boolean }).standalone === true;

		if (isStandalone && auth.isLoggedIn) {
			goto('/profile');
			return;
		}

		const isHealthy = await checkBackendHealth();
		backendStatus = isHealthy ? 'connected' : 'disconnected';
	});

	// Placeholder for now - the real devlog (its own storage, routing,
	// and actual posts) is being built out next. This is scaffolding
	// for the homepage layout only.
	const latestPost = {
		title: 'Devlog #1: mobile support, character abilities, and a rebuilt landing page',
		date: 'September 2026',
		excerpt:
			'Placeholder text for now - this is where a short excerpt of the actual latest devlog post will appear once the real devlog exists.'
	};
</script>

<svelte:head>
	<title>Pixel Maker</title>
	<meta
		name="description"
		content="An in-browser, Mario Maker-style platformer level editor. Build platforms, swap characters, and set a goal - then play what you built."
	/>
</svelte:head>

<Navbar />

<main>
	<section class="hero">
		<h1>Build a platformer level in your browser.</h1>
		<p class="subhead">
			Place platforms, swap who you're playing as mid-level, and set a goal to reach. No
			install, no account - just open the editor and start building.
		</p>
		<a class="cta" href="/play">Build Now</a>
		<LevelPreviewHero />
	</section>

	<section class="devlog">
		<h2>From the devlog</h2>
		<a class="post-card" href="/blog/devlog-1">
			<span class="post-date">{latestPost.date}</span>
			<h3>{latestPost.title}</h3>
			<p>{latestPost.excerpt}</p>
		</a>
		<a class="devlog-link" href="/blog">Read the devlog</a>
	</section>

	<footer>
		<span
			class="status"
			class:connected={backendStatus === 'connected'}
			class:disconnected={backendStatus === 'disconnected'}
		>
			{#if backendStatus === 'checking'}
				checking backend…
			{:else if backendStatus === 'connected'}
				● backend connected
			{:else}
				● backend unreachable
			{/if}
		</span>
		<a
			class="source-link"
			href="https://github.com/mynameisbenzo/level_builder"
			target="_blank"
			rel="noopener noreferrer"
		>
			View source on GitHub
		</a>
	</footer>
</main>

<style>
	:global(body) {
		background: #1a1b3a;
		color: #f4f6ff;
	}

	main {
		max-width: 1040px;
		margin: 0 auto;
		padding: 40px 24px 40px;
	}

	.hero {
		text-align: center;
		margin-bottom: 88px;
	}

	h1 {
		font-family: 'Baloo 2', sans-serif;
		font-weight: 800;
		font-size: clamp(2.1rem, 5vw, 3.4rem);
		line-height: 1.1;
		margin: 0 0 20px;
		max-width: 18ch;
		margin-inline: auto;
	}

	.subhead {
		font-size: 1.1rem;
		line-height: 1.6;
		color: #c7cbef;
		max-width: 52ch;
		margin: 0 auto 32px;
	}

	.cta {
		display: inline-block;
		font-family: 'Baloo 2', sans-serif;
		font-weight: 700;
		font-size: 1.15rem;
		color: #142013;
		background: #4ecb71;
		padding: 14px 36px;
		border-radius: 10px;
		border: 3px solid #142013;
		box-shadow: 0 4px 0 #142013;
		text-decoration: none;
		margin-bottom: 56px;
		transition:
			transform 0.15s ease,
			box-shadow 0.15s ease;
	}

	.cta:hover {
		transform: translateY(2px);
		box-shadow: 0 2px 0 #142013;
	}

	.cta:active {
		transform: translateY(4px);
		box-shadow: 0 0 0 #142013;
	}

	.cta:focus-visible {
		outline: 3px solid #ffd23f;
		outline-offset: 3px;
	}

	.devlog {
		text-align: center;
	}

	.devlog h2 {
		font-family: 'Baloo 2', sans-serif;
		font-weight: 700;
		font-size: 1.6rem;
		margin: 0 0 28px;
	}

	.post-card {
		display: block;
		max-width: 600px;
		margin: 0 auto 24px;
		padding: 28px 32px;
		background: #252650;
		border: 2px solid #3a3d76;
		border-radius: 6px;
		text-align: left;
		text-decoration: none;
		color: inherit;
		transition: border-color 0.15s ease;
	}

	.post-card:hover {
		border-color: #6b6f9e;
	}

	.post-card:focus-visible {
		outline: 3px solid #ffd23f;
		outline-offset: 3px;
	}

	.post-date {
		display: block;
		font-size: 0.85rem;
		color: #8b8fc7;
		margin-bottom: 8px;
	}

	.post-card h3 {
		font-family: 'Baloo 2', sans-serif;
		font-weight: 700;
		font-size: 1.3rem;
		line-height: 1.3;
		margin: 0 0 10px;
	}

	.post-card p {
		font-size: 0.95rem;
		line-height: 1.6;
		color: #b6baec;
		margin: 0;
	}

	.devlog-link {
		display: inline-block;
		font-family: 'Baloo 2', sans-serif;
		font-weight: 700;
		font-size: 0.95rem;
		color: #ffd23f;
		background: transparent;
		padding: 10px 26px;
		border-radius: 8px;
		border: 2px solid #ffd23f;
		text-decoration: none;
		transition:
			background 0.15s ease,
			color 0.15s ease;
	}

	.devlog-link:hover {
		background: #ffd23f;
		color: #1a1b3a;
	}

	.devlog-link:focus-visible {
		outline: 3px solid #ffd23f;
		outline-offset: 3px;
	}

	footer {
		margin-top: 88px;
		padding-top: 24px;
		border-top: 1px solid #3a3d76;
		display: flex;
		flex-wrap: wrap;
		justify-content: space-between;
		gap: 12px;
		font-size: 0.85rem;
		color: #8b8fc7;
	}

	.status.connected {
		color: #4ecb71;
	}

	.status.disconnected {
		color: #ff8a7a;
	}

	.source-link {
		color: #8b8fc7;
	}

	.source-link:hover {
		color: #f4f6ff;
	}

	@media (max-width: 520px) {
		.hero {
			margin-bottom: 64px;
		}
	}
</style>