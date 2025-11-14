<script lang="ts">
	import type { PlayerStatus } from '$lib/playerPresence';
	import type { PlayerStreak } from '$lib/streaks';

	const props = $props<{
		label?: string | null;
		status?: PlayerStatus;
		me?: boolean;
		streak?: PlayerStreak | null;
	}>();

	const DOT_CLASSES: Record<PlayerStatus, string> = {
		online: 'bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.65)]',
		away: 'bg-amber-400  shadow-[0_0_8px_rgba(251,191,36,0.65)]',
		offline: 'bg-rose-400   shadow-[0_0_8px_rgba(248,113,113,0.4)]'
	};
	const DOT_CLASS_ME = 'bg-violet-400 shadow-[0_0_8px_rgba(139,92,246,0.55)]';

	const me = $derived(Boolean(props.me));
	const effectiveStatus: PlayerStatus = $derived(
		(me ? 'online' : (props.status ?? 'offline')) as PlayerStatus
	);
	const label: string | null = $derived(props.label ?? null);

	const TEXT_LABELS: Record<PlayerStatus, string> = {
		online: 'online',
		away: 'away',
		offline: 'offline'
	};

	// what to show as the status string (tooltip/aria)
	const statusText = $derived(me ? 'you' : TEXT_LABELS[effectiveStatus]);

	const dotClass = $derived(me ? DOT_CLASS_ME : DOT_CLASSES[effectiveStatus]);
	const streak = $derived(props.streak ?? null);
	const streakDisplay = $derived(streak ? `${streak.length}` : '–');
	const streakArrowClass = $derived.by(() => {
		const base = 'h-[8px] w-[8px]';
		if (!streak) return `${base} text-stone-400`;
		const color = streak.kind === 'positive' ? 'text-emerald-500' : 'text-rose-500';
		const rotation = streak.kind === 'positive' ? '' : 'rotate-180';
		return `${base} ${color} ${rotation}`;
	});
	const streakDescription = $derived(
		streak
			? `${streak.length}-day ${streak.kind === 'positive' ? 'positive' : 'negative'} streak`
			: null
	);
	const baseAria = $derived(label ? `${label} is ${statusText}` : statusText);
	const aria = $derived(streakDescription ? `${baseAria}, ${streakDescription}` : baseAria);
</script>

<div
	class="group relative inline-flex items-center gap-2 rounded-md font-medium text-stone-700"
	aria-label={aria}
>
	<span class={`h-2 w-2 rounded-full ${dotClass}`}></span>
	{#if label}{label}{/if}
	<span
		class="pointer-events-none top-1/2 left-full inline-flex
           items-center gap-1 rounded-sm bg-stone-700 px-1 text-[10px]
           font-medium whitespace-nowrap text-stone-50 capitalize transition-opacity duration-150 group-hover:opacity-100"
	>
		<svg viewBox="0 0 10 10" class={streakArrowClass} aria-hidden="true">
			<polygon
				points="5,2 9,9 1,9"
				fill="currentColor"
				stroke="currentColor"
				stroke-width="1"
				stroke-linejoin="round"
			/>
		</svg>
		{streakDisplay}
	</span>
</div>
