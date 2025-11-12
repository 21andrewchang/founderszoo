<script lang="ts">
	type HabitConfig = { icon: string; filled: string; empty: string };

	const HABITS: Record<string, HabitConfig> = {
		read: {
			icon: '📖',
			filled: 'border-amber-200 bg-amber-50 text-amber-900',
			empty: 'border-amber-100 bg-amber-50 text-amber-700 hover:bg-amber-100'
		},
		meditate: {
			icon: '🧘',
			filled: 'border-emerald-200 bg-emerald-50 text-emerald-900',
			empty: 'border-emerald-100 bg-emerald-50 text-emerald-700 hover:bg-emerald-100'
		},
		gym: {
			icon: '🏋️',
			filled: 'border-sky-200 bg-sky-50 text-sky-900',
			empty: 'border-sky-100 bg-sky-50 text-sky-800 hover:bg-sky-100'
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

	const BASE_SLOT =
		'flex flex-row w-full items-center gap-2 rounded-md border px-2 py-1 text-xs font-medium bg-stone-50';
	const DEFAULT_FILLED = 'border-stone-200 bg-white text-stone-900';
	const DEFAULT_EMPTY = 'border-stone-100 bg-stone-100 text-stone-600 hover:bg-stone-200';
	const DEFAULT_EMPTY_DISABLED = 'border-stone-100 bg-stone-100 text-stone-400';

	const showTodo = $derived(todo !== null);
	const canOpen = $derived(
		editable &&
			!isFilled && // don’t open if already has text
			!habitPreset && // don’t open if this title maps to a known habit
			!habitPlaceholder // don’t open if a habit placeholder is shown
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
	class="flex w-full flex-row items-center rounded-sm bg-stone-100 p-2 transition hover:bg-stone-200"
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
			<span class="text-stone-400">{habitPlaceholder}</span>
		{:else}
			&nbsp;
		{/if}
	</span>
	{#if showTodo}
		<div
			class="relative ml-3 grid h-3 w-3 place-items-center rounded-full focus:outline-none
			       {todo ? 'bg-stone-900' : ''}"
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
