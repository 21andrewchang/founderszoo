<script lang="ts">
	import LogModal from '$lib/components/LogModal.svelte';
	import { onMount } from 'svelte';
	import { getContext } from 'svelte';
	import type { User } from '@supabase/supabase-js';

	type Session = { user: User | null; name: string; loading: boolean };
	const session: Session = getContext('session');
	let user = $derived(session.user);

	const people = ['Andrew', 'Nico'];
	const START_HOUR = 8;
	const END_HOUR = 24;
	const hours = Array.from({ length: END_HOUR - START_HOUR }, (_, i) => START_HOUR + i);
	const hh = (n: number) => n.toString().padStart(2, '0');

	let currentHour = $state(-1);
	const isCurrent = (h: number) => h === currentHour;

	onMount(() => {
		const tick = () => (currentHour = new Date().getHours());
		tick();
		const id = setInterval(tick, 60_000);
		return () => clearInterval(id);
	});
</script>

<div class="flex flex-col overflow-clip bg-stone-50 p-6">
	<div class="flex flex-row space-x-4">
		<!-- Time gutter -->
		<div class="flex flex-col space-y-1">
			<div class="text-stone-50">T</div>
			{#each hours as h}
				<div class="flex">
					<div
						class="rounded px-1 text-stone-300"
						class:bg-amber-200={isCurrent(h)}
						class:text-stone-900={isCurrent(h)}
					>
						{hh(h)}
					</div>
				</div>
			{/each}
		</div>

		<!-- Columns per person -->
		{#each people as p}
			<div class="flex w-full flex-col space-y-1">
				<div>{p}</div>
				{#each hours as h}
					<div class="flex w-full flex-row space-x-1 rounded">
						<div class="flex w-full justify-center rounded-md bg-stone-100 p-1 text-xs">
							Block 1
						</div>
						<div class="flex w-full justify-center rounded-md bg-stone-100 p-1 text-xs">
							Block 2
						</div>
					</div>
				{/each}
			</div>
		{/each}
	</div>
</div>
<LogModal open={true} />
