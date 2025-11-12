<script lang="ts">
	import type { PlayerStatus } from '$lib/playerPresence';

	const props = $props<{ label?: string | null; status?: PlayerStatus }>();

	const DOT_CLASSES: Record<PlayerStatus, string> = {
		online: 'bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.65)]',
		away: 'bg-amber-400  shadow-[0_0_8px_rgba(251,191,36,0.65)]',
		offline: 'bg-rose-400    shadow-[0_0_8px_rgba(248,113,113,0.4)]'
	};
	const TEXT_LABELS: Record<PlayerStatus, string> = {
		online: 'online',
		away: 'away',
		offline: 'offline'
	};

	// Explicit types fix the indexing error
	let status: PlayerStatus = $derived((props.status ?? 'offline') as PlayerStatus);
	let label: string | null = $derived(props.label ?? null);

	const dotClass = $derived(DOT_CLASSES[status]);
	const labelText = $derived(TEXT_LABELS[status]);
	const aria = $derived(label ? `${label} is ${labelText}` : labelText);
</script>

<div
	class="group relative inline-flex items-center gap-2 rounded-md font-medium text-stone-700"
	aria-label={aria}
>
	<span class={`h-2 w-2 rounded-full ${dotClass}`}></span>
	{#if label}{label}{/if}

	<!-- Tooltip extends to the RIGHT of the dot -->
	<span
		role="tooltip"
		class="pointer-events-none absolute top-1/2 left-full ml-2 -translate-y-1/2 rounded-md
           bg-stone-900 px-2 py-1 text-[11px] font-medium whitespace-nowrap text-white capitalize opacity-0
           shadow-lg transition-opacity duration-150 group-hover:opacity-100"
	>
		{labelText}
	</span>
</div>
