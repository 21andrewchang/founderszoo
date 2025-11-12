<script lang="ts">
	type HabitConfig = { icon: string };

	const HABITS: Record<string, HabitConfig> = {
		read: { icon: '📖' },
		meditate: { icon: '🧘' },
		gym: { icon: '🏋️' }
	};

	// Theme tokens per habit
	const HABIT_STYLES: Record<string, { filled: string; empty: string; border: string }> = {
		gym: {
			filled: 'bg-red-50 text-red-900',
			empty: 'bg-red-50 text-red-700 hover:bg-red-100',
			border: 'border-red-200'
		},
		read: {
			filled: 'bg-blue-50 text-blue-900',
			empty: 'bg-blue-50 text-blue-700 hover:bg-blue-100',
			border: 'border-blue-200'
		},
		meditate: {
			filled: 'bg-emerald-50 text-emerald-900',
			empty: 'bg-emerald-50 text-emerald-700 hover:bg-emerald-100',
			border: 'border-emerald-200'
		}
	};

	const props = $props<{
		title?: string;
		todo?: boolean | null;
		editable?: boolean;
		onSelect?: () => void;
		onToggleTodo?: () => void;
		selected?: boolean;
		habit?: string | null;
	}>();

	const title = $derived(props.title ?? '');
	const editable = $derived(props.editable ?? false);
	const onSelect = $derived(props.onSelect ?? (() => {}));
	const todo = $derived(props.todo ?? null);
	const onToggleTodo = $derived(props.onToggleTodo ?? (() => {}));
	const selected = $derived(props.selected ?? false);
	const habitPlaceholder = $derived((props.habit ?? '').trim());

	const trimmed = $derived((title ?? '').trim());
	const isFilled = $derived(trimmed.length > 0);

	const habitKey = $derived(habitPlaceholder.toLowerCase());
	const habitPreset = $derived(HABITS[habitKey]);
	const isHabit = $derived(Boolean(props.habit));

	// Choose theme or fallback
	const theme = $derived(HABIT_STYLES[habitKey] ?? null);

	// Build classes
	const baseClasses =
		'flex w-full flex-row items-center rounded-sm  p-2 transition  focus:outline-0';
	const habitClasses = $derived(
		isHabit
			? `border-dotted hover:border-solid border ${theme?.border ?? 'border-stone-300'} ${
					isFilled
						? (theme?.filled ?? 'bg-stone-50 text-stone-900')
						: (theme?.empty ?? 'bg-stone-50 text-stone-700 hover:bg-stone-100')
				}`
			: `${isFilled ? 'bg-stone-100 text-stone-900' : 'bg-stone-100 text-stone-600 border-stone-100'} ${
					editable && !isFilled ? 'hover:bg-stone-200' : 'hover:bg-stone-200'
				}`
	);

	const showTodo = $derived(todo !== null);
	const canOpen = $derived(
		editable && !isFilled && !habitPlaceholder // habits/filled don't open editor
	);

	function handleSlotClick() {
		onToggleTodo();
		if (!canOpen) return;
		onSelect();
	}
	function handleSlotKeydown(event: KeyboardEvent) {
		if (!canOpen) return;
		if (event.key === 'Enter' || event.key === ' ') {
			event.preventDefault();
			handleSlotClick();
		}
	}
</script>

<button
	class={`${baseClasses} ${habitClasses}`}
	class:ring-2={selected}
	class:ring-stone-400={selected}
	class:ring-offset-1={selected}
	class:ring-offset-stone-50={selected}
	role={canOpen ? 'button' : undefined}
	onclick={handleSlotClick}
	onkeydown={handleSlotKeydown}
>
	{#if habitPreset}
		<span class="text-xs leading-none">{habitPreset.icon}</span>
	{/if}

	<span class="ml-1 flex-1 truncate text-left text-xs">
		{#if isFilled}
			{trimmed}
		{:else if habitPlaceholder}
			<span class="opacity-70">{habitPlaceholder}</span>
		{:else}
			&nbsp;
		{/if}
	</span>

	{#if showTodo}
		<div
			class="relative ml-3 grid h-3 w-3 place-items-center rounded-full focus:outline-none {todo
				? 'bg-stone-900'
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
				/>
			{/if}
		</div>
	{/if}
</button>
