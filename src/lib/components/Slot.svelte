<script lang="ts">
	import type { PlayerStreak } from '$lib/streaks';
	type HabitConfig = { icon: string };

	const HABITS: Record<string, HabitConfig> = {
		read: { icon: '📖' },
		bored: { icon: '😵‍💫' },
		gym: { icon: '🏋️' }
	};

	const props = $props<{
		title?: string;
		todo?: boolean | null;
		editable?: boolean;
		onSelect?: () => void;
		onToggleTodo?: () => void;
		selected?: boolean;
		habit?: string | null;
		isCurrent?: boolean;
		habitStreak?: PlayerStreak | null;
	}>();

	const title = $derived(props.title ?? '');
	const editable = $derived(props.editable ?? false);
	const onSelect = $derived(props.onSelect ?? (() => {}));
	const todo = $derived(props.todo ?? null);
	const onToggleTodo = $derived(props.onToggleTodo ?? (() => {}));
	const selected = $derived(props.selected ?? false);
	const habitPlaceholder = $derived((props.habit ?? '').trim());
	const isCurrentSlot = $derived(Boolean(props.isCurrent));
	const habitStreak = $derived(props.habitStreak ?? null);
	const habitStreakLabel = $derived(() => {
		if (!habitStreak || habitStreak.length <= 0) return null;
		return `${habitStreak.kind === 'positive' ? '' : '-'}${habitStreak.length}`;
	});
	const habitStreakClasses = $derived(() => {
		if (!habitStreak) return 'border-stone-300 text-stone-500';
		return habitStreak.kind === 'positive'
			? 'border-emerald-400 text-emerald-700'
			: 'border-rose-400 text-rose-700';
	});

	const trimmed = $derived((title ?? '').trim());
	const isFilled = $derived(trimmed.length > 0);

	const habitKey = $derived(habitPlaceholder.toLowerCase());
	const habitPreset = $derived(HABITS[habitKey]);
	const isHabit = $derived(Boolean(props.habit));

	const currentClass = $derived(isCurrentSlot ? 'bg-stone-200' : '');

	const baseClasses =
		'flex w-full min-w-0 flex-row items-center rounded-sm p-2 transition overflow-hidden focus:outline-0';

	const habitClasses = $derived(
		isHabit
			? `border border-stone-700 text-stone-900 ${todo ? '' : 'border-dashed'}`
			: `${
					isFilled ? 'bg-stone-100 text-stone-900' : 'bg-stone-100 text-stone-600 border-stone-100'
				}`
	);

	const showTodo = $derived(todo !== null);
	const showHabitStreak = $derived(isHabit && Boolean(habitStreakLabel));
	const canOpen = $derived(editable && !habitPlaceholder);

	function handleSlotClick() {
		if (todo !== null) {
			onToggleTodo();
			return;
		}
		if (!canOpen) return;
		onSelect();
	}

	function handleSlotKeydown(event: KeyboardEvent) {
		if (!editable) return;
		if (event.key === 'Enter' || event.key === ' ') {
			event.preventDefault();
			handleSlotClick();
		}
	}
	const streakArrowClass = $derived.by(() => {
		const base = 'h-2 w-2 transition-transform';
		if (!habitStreak) return `${base} text-stone-400`;
		const color = habitStreak.kind === 'positive' ? 'text-emerald-500' : 'text-rose-500';
		const rotation = habitStreak.kind === 'positive' ? '' : 'rotate-180';
		return `${base} ${color} ${rotation}`;
	});
</script>

<button
	class={`${baseClasses} ${habitClasses} ${currentClass}`}
	class:ring-1={selected}
	class:ring-stone-400={selected}
	class:ring-offset-1={selected}
	class:ring-offset-stone-50={selected}
	role={canOpen ? 'button' : undefined}
	onclick={handleSlotClick}
	onkeydown={handleSlotKeydown}
>
	<span class="flex w-full min-w-0 items-center justify-between gap-2 truncate text-left text-xs">
		<div class="flex flex-row items-center gap-0.5">
			{#if habitPreset}
				<span class="text-xs leading-none">{habitPreset.icon}</span>
			{/if}

			{#if isFilled}
				{trimmed}
			{:else}
				&nbsp;
			{/if}
		</div>
		{#if showHabitStreak}
			<span
				class={`inline-flex shrink-0 items-center gap-0.5 rounded-sm  text-[10px] font-semibold tracking-wider uppercase ${habitStreakClasses}`}
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
				{habitStreak.length}
			</span>
		{/if}
	</span>

	{#if showTodo && !isHabit}
		<div
			class="relative ml-3 grid h-3 w-3 place-items-center rounded-full focus:outline-none {todo
				? 'bg-stone-700'
				: ''}"
		>
			{#if todo}
				<svg viewBox="0 0 24 24" class="h-3 w-3 text-stone-50" fill="none">
					<path
						d="M7 12.5 L10.25 15.75 L16.75 9.25"
						stroke="currentColor"
						stroke-width="2"
						stroke-linecap="round"
						stroke-linejoin="round"
					/>
				</svg>
			{:else}
				<span
					class="pointer-events-none absolute inset-0 rounded-full border border-[1px] border-stone-400 transition duration-200 ease-out"
				></span>
			{/if}
		</div>
	{/if}
</button>
