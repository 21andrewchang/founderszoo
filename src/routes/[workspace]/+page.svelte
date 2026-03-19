<script lang="ts">
	import WorkspacePage from '$lib/pages/WorkspacePage.svelte';
	import WorkspaceUnauthorized from '$lib/components/WorkspaceUnauthorized.svelte';

	export let data: {
		authorized: boolean;
		viewerEmail: string | null;
		workspaceUsername: string | null;
	};
</script>

{#if data.authorized}
	<WorkspacePage showMultiGrid={false} />
{:else}
	<WorkspaceUnauthorized
		viewerEmail={data.viewerEmail}
		workspaceUsername={data.workspaceUsername}
	/>
{/if}
