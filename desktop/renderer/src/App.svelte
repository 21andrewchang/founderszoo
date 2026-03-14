<script lang="ts">
	import Layout from '../../../src/routes/+layout.svelte';
	import MainPage from '../../../src/routes/+page.svelte';

	type DesktopApi = {
		isDesktop?: boolean;
		hidePanel?: () => void;
	};

	const LayoutComponent: any = Layout;

	const view = new URLSearchParams(window.location.search).get('view');
	const isPanel = view === 'panel';

	const onKeydown = (event: KeyboardEvent) => {
		if (!isPanel) return;
		if (event.key === 'Escape') {
			(window as { desktop?: DesktopApi }).desktop?.hidePanel?.();
		}
	};
</script>

<svelte:window on:keydown={onKeydown} />

<svelte:component this={LayoutComponent} suppressSpectator desktopMode>
	<MainPage />
</svelte:component>
