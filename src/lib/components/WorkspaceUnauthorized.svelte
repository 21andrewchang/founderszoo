<script lang="ts">
	export let viewerEmail: string | null = null;
	export let workspaceUsername: string | null = null;

	const backLabel = 'Back to Home';
	const title = 'Authentication error';
	const message = "You don't have access to this workspace.";
	const helpText = 'Please contact a workspace admin for access.';
</script>

<div class="min-h-dvh bg-white text-stone-900">
	<header class="mx-auto flex w-full max-w-5xl items-center justify-between px-6 py-6 text-sm">
		<a href="/" class="inline-flex items-center gap-2 text-stone-500 hover:text-stone-900">
			<span aria-hidden="true">&#x2039;</span>
			<span>{backLabel}</span>
		</a>
		<div class="text-right text-stone-500">
			<div>Logged in as</div>
			<div class="text-stone-900">
				{viewerEmail ?? 'Not logged in'}
			</div>
		</div>
	</header>

	<main class="mx-auto flex w-full max-w-2xl flex-col items-center px-6 pt-10 text-center">
		<div class="flex h-12 w-12 items-center justify-center rounded-full bg-stone-900/90 text-white">
		</div>
		<h1 class="mt-6 text-2xl font-semibold text-stone-900">{title}</h1>
		<p class="mt-3 text-stone-500">{message}</p>
		<p class="mt-2 text-stone-400">{helpText}</p>
		{#if workspaceUsername}
			<p class="mt-6 text-xs tracking-[0.2em] text-stone-300 uppercase">
				Workspace: {workspaceUsername}
			</p>
		{/if}
	</main>
</div>
