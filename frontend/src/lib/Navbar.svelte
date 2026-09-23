<script lang="ts">
	import { auth } from './auth.svelte';
</script>

<nav>
	<a class="wordmark" href="/">Pixel Maker</a>
	<div class="auth-links">
		{#if auth.isLoggedIn}
			<a class="greeting" href="/profile">Hi, {auth.user?.username}</a>
			<button class="nav-link nav-link-ghost" onclick={() => auth.logout()}>Log Out</button>
		{:else}
			<a class="nav-link nav-link-ghost" href="/login">Log In</a>
			<a class="nav-link nav-link-solid" href="/signup">Sign Up</a>
		{/if}
	</div>
</nav>

<style>
	nav {
		display: flex;
		align-items: center;
		justify-content: space-between;
		max-width: 1040px;
		margin: 0 auto;
		padding: 20px 24px 0;
	}

	.wordmark {
		font-family: 'Baloo 2', sans-serif;
		font-weight: 700;
		font-size: 1.15rem;
		color: #f4f6ff;
		text-decoration: none;
	}

	.auth-links {
		display: flex;
		align-items: center;
		gap: 12px;
	}

	.nav-link {
		font-family: 'Baloo 2', sans-serif;
		font-weight: 700;
		font-size: 0.9rem;
		padding: 9px 20px;
		border-radius: 8px;
		text-decoration: none;
		transition:
			background 0.15s ease,
			color 0.15s ease,
			border-color 0.15s ease;
	}

	/* button defaults reset so <button class="nav-link nav-link-ghost">
	   matches the anchor-based one above exactly - background, font,
	   and cursor all need explicit values a plain <button> won't have. */
	button.nav-link {
		background: none;
		font: inherit;
		font-family: 'Baloo 2', sans-serif;
		font-weight: 700;
		cursor: pointer;
	}

	.greeting {
		font-size: 0.9rem;
		color: #c7cbef;
		text-decoration: none;
		transition: color 0.15s ease;
	}

	.greeting:hover {
		color: #f4f6ff;
	}

	.greeting:focus-visible {
		outline: 3px solid #ffd23f;
		outline-offset: 2px;
	}

	.nav-link-ghost {
		color: #c7cbef;
		border: 2px solid #3a3d76;
	}

	.nav-link-ghost:hover {
		border-color: #6b6f9e;
		color: #f4f6ff;
	}

	.nav-link-solid {
		color: #142013;
		background: #4ecb71;
		border: 2px solid #4ecb71;
	}

	.nav-link-solid:hover {
		background: #5fdb81;
		border-color: #5fdb81;
	}

	.nav-link:focus-visible {
		outline: 3px solid #ffd23f;
		outline-offset: 2px;
	}

	@media (max-width: 420px) {
		nav {
			padding: 16px 20px 0;
		}

		.nav-link {
			padding: 8px 14px;
			font-size: 0.82rem;
		}
	}
</style>