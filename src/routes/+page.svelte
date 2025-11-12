<script lang="ts">
	import AuthModal from '$lib/components/AuthModal.svelte';

	const people = ['Andrew', 'Nico'];
	const START_HOUR = 8; // 8 AM
	const END_HOUR = 24; // 12 AM
	const hours = Array.from({ length: END_HOUR - START_HOUR }, (_, i) => START_HOUR + i);

	let authModalOpen = false;
</script>

<div class="flex min-h-screen flex-col bg-stone-50 p-6 text-stone-900">
	<div class="mb-6 flex justify-end">
		<button
			class="rounded-xl border border-stone-300 px-4 py-2 text-sm font-medium text-stone-800 transition hover:bg-stone-100"
			on:click={() => (authModalOpen = true)}
		>
			Sign in
		</button>
	</div>
	<div class="flex flex-row space-x-4">
		<div class="flex flex-col space-y-1">
			<div>Time</div>
			{#each hours as h}
				<div class="flex">{h}</div>
			{/each}
		</div>
		{#each people as p}
			<div class="flex w-full flex-col space-y-1">
				<div>{p}</div>
				{#each hours}
					<div class="flex w-full flex-row space-x-1">
						<div class="flex w-full bg-stone-200">Block 1</div>
						<div class="flex w-full bg-stone-200">Block 2</div>
					</div>
				{/each}
			</div>
		{/each}
	</div>
</div>

<AuthModal open={authModalOpen} onClose={() => (authModalOpen = false)} />
