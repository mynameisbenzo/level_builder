<script lang="ts">
	import { onMount } from 'svelte';
	import { checkBackendHealth } from '$lib/api';

	let backendStatus: 'checking' | 'connected' | 'disconnected' = $state('checking');

	onMount(async () => {
		const isHealthy = await checkBackendHealth();
		backendStatus = isHealthy ? 'connected' : 'disconnected';
	});
</script>

<h1>Level Builder</h1>

<p>
	Backend status:
	{#if backendStatus === 'checking'}
		checking...
	{:else if backendStatus === 'connected'}
		✅ connected
	{:else}
		❌ disconnected
	{/if}
</p>