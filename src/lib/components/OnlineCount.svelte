<script lang="ts">
	import type { PresenceSnapshot } from '$lib/presence';

	type Props = {
		counts: PresenceSnapshot;
		dedupe?: boolean;
	};

	let { counts, dedupe = false }: Props = $props();

	const total = $derived(dedupe ? counts.unique : counts.tabs);
</script>

{#if counts.connected}
	<div
		class="group fixed top-5 right-6 z-68 flex h-4 select-none"
		aria-live="polite"
		aria-label="Live spectator count"
	>
		<div class="relative inline-flex">
			<div class="flex flex-row items-center gap-1 text-[12px] text-red-400">
				<svg
					viewBox="0 0 24 24"
					fill="currentColor"
					stroke="currentColor"
					stroke-width="2"
					stroke-linecap="round"
					stroke-linejoin="round"
					shape-rendering="geometricPrecision"
					class="h-2.5 w-2.5 transition-colors duration-200"
				>
					<path d="M20 21.5v-2.5a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2.5h16" />
					<circle cx="12" cy="7" r="4" />
				</svg>
				{#if counts.connected}{total}{:else}--{/if}
			</div>
		</div>
		<div
			role="tooltip"
			class="pointer-events-none absolute top-full right-0 mt-1 origin-top-right rounded-md bg-stone-700 px-2 py-1 text-xs font-medium whitespace-nowrap text-white opacity-0 shadow-lg transition-opacity duration-150 group-hover:opacity-100"
		>
			Live spectator count
		</div>
	</div>
{/if}
