<div class="landscape-guard">
	<div class="icon">↻</div>
	<p>Please rotate your device to landscape mode to play.</p>
</div>

<style>
	.landscape-guard {
		display: none;
	}

	@media (orientation: portrait) and (max-width: 900px) {
		.landscape-guard {
			display: flex;
			flex-direction: column;
			align-items: center;
			justify-content: center;
			gap: 16px;
			position: fixed;
			inset: 0;
			z-index: 1000;
			background: #1a1a2e;
			color: #f4f1de;
			font-family: 'VT323', monospace;
			text-align: center;
			padding: 32px;
		}
	}

	.icon {
		font-size: 3rem;
		animation: spin 1.5s linear infinite;
	}

	@keyframes spin {
		to {
			transform: rotate(90deg);
		}
	}

	@media (prefers-reduced-motion: reduce) {
		.icon {
			animation: none;
		}
	}

	p {
		font-size: 1.3rem;
		max-width: 320px;
		margin: 0;
	}
</style>