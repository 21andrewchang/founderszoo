<script lang="ts">
	import Layout from '../../../src/routes/+layout.svelte';
	import MainPage from '../../../src/routes/+page.svelte';

	const view = new URLSearchParams(window.location.search).get('view');
	const isPanel = view === 'panel';

	const onKeydown = (event: KeyboardEvent) => {
		if (!isPanel) return;
		if (event.key === 'Escape') {
			(window as { desktop?: { hidePanel?: () => void } }).desktop?.hidePanel?.();
		}
	};
</script>

<svelte:window on:keydown={onKeydown} />
{#if isPanel}
	<div class="panel-root">
		<div class="panel-card">
			<div class="panel-title">test</div>
		</div>
	</div>
{:else}
	<Layout suppressSpectator desktopMode>
		<MainPage />
	</Layout>
{/if}
