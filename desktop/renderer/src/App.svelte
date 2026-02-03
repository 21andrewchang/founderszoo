<script lang="ts">
	import Layout from '../../../src/routes/+layout.svelte';
	import MainPage from '../../../src/routes/+page.svelte';
	import ReminderHUD from './ReminderHUD.svelte';

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
	<ReminderHUD />
{:else}
	<Layout suppressSpectator desktopMode>
		<MainPage />
	</Layout>
{/if}
