<script lang="ts">
	import Navbar from '$lib/Navbar.svelte';
</script>

<svelte:head>
	<title>Log In — Pixel Maker</title>
</svelte:head>

<Navbar />

<main>
	<div class="card">
		<h1>Log in</h1>
		<p class="note">
			Login isn't built yet — there's no backend auth endpoint at all right now, magic-link
			or Twitch. <a href="/signup">Account creation</a> works today; logging back into one doesn't,
			yet.
		</p>
	</div>
</main>

<style>
	:global(body) {
		background: #1a1b3a;
		color: #f4f6ff;
	}

	main {
		max-width: 480px;
		margin: 0 auto;
		padding: 48px 24px;
	}

	.card {
		background: #252650;
		border: 2px solid #3a3d76;
		border-radius: 6px;
		padding: 32px;
	}

	h1 {
		font-family: 'Baloo 2', sans-serif;
		font-weight: 700;
		font-size: 1.6rem;
		margin: 0 0 16px;
	}

	.note {
		font-size: 0.95rem;
		line-height: 1.6;
		color: #b6baec;
		margin: 0;
	}

	.note a {
		color: #4ecb71;
	}
</style>