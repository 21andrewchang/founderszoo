<script lang="ts">
	import type { PlayerStreak } from '$lib/streaks';
	type HabitConfig = { icon: string };

	const HABITS: Record<string, HabitConfig> = {
		wake: { icon: '☀️' },
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
		onPrimaryAction?: () => boolean;
		selected?: boolean;
		habit?: string | null;
		isCurrent?: boolean;
		habitStreak?: PlayerStreak | null;
		isCut?: boolean;
	}>();

	const title = $derived(props.title ?? '');
	const editable = $derived(props.editable ?? false);
	const onSelect = $derived(props.onSelect ?? (() => {}));
	const todo = $derived(props.todo ?? null);
	const onToggleTodo = $derived(props.onToggleTodo ?? (() => {}));
	const onPrimaryAction = $derived(props.onPrimaryAction ?? (() => false));
	const selected = $derived(props.selected ?? false);
	const habitPlaceholder = $derived((props.habit ?? '').trim());
	const isCurrentBlock = $derived(Boolean(props.isCurrent));
	const habitStreak = $derived(props.habitStreak ?? null);
	const habitStreakLabel = $derived(() => {
		if (habitStreak == null || !habitStreak || habitStreak.length <= 0) return null;
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

	const currentClass = $derived(isCurrentBlock ? 'bg-stone-200' : '');

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

	function handleBlockClick() {
		if (onPrimaryAction()) return;
		if (todo !== null) {
			onToggleTodo();
			return;
		}
		if (!canOpen) return;
		onSelect();
	}

	function handleBlockKeydown(event: KeyboardEvent) {
		if (!editable) return;
		if (event.key === 'Enter' || event.key === ' ') {
			event.preventDefault();
			handleBlockClick();
		}
	}
	const streakArrowClass = $derived.by(() => {
		const base = 'h-2 w-2 transition-transform';
		if (!habitStreak) return `${base} text-stone-400`;
		const color = habitStreak.kind === 'positive' ? 'text-emerald-500' : 'text-rose-500';
		const rotation = habitStreak.kind === 'positive' ? '' : 'rotate-180';
		return `${base} ${color} ${rotation}`;
	});

	// Directional animation state
	let streakAnim = $state<'none' | 'up' | 'down'>('none');
	let lastStreakLength = $state<number | null>(null);
	let lastStreakKind = $state<'positive' | 'negative' | null>(null);

	function triggerStreakAnim(direction: 'up' | 'down') {
		if (typeof window === 'undefined') return;
		streakAnim = 'none';
		requestAnimationFrame(() => {
			streakAnim = direction;
			window.setTimeout(() => {
				streakAnim = 'none';
			}, 220);
		});
	}

	$effect(() => {
		// No streak → reset tracking
		if (!habitStreak) {
			lastStreakLength = null;
			lastStreakKind = null;
			streakAnim = 'none';
			return;
		}

		const len = habitStreak.length;
		const kind = habitStreak.kind;
		const prevLen = lastStreakLength;
		const prevKind = lastStreakKind;

		if (prevLen !== null) {
			// Checking off → positive streak increased
			if (len > prevLen && kind === 'positive') {
				triggerStreakAnim('up');
			}
			// Unchecking or otherwise losing progress
			else if (len < prevLen || (prevKind === 'positive' && kind === 'negative')) {
				triggerStreakAnim('down');
			}
		}

		lastStreakLength = len;
		lastStreakKind = kind;
	});

	let todoAnim = $state<'none' | 'check' | 'uncheck'>('none');
	let lastTodo = $state<boolean | null>(null);

	function triggerTodoAnim(kind: 'check' | 'uncheck') {
		if (typeof window === 'undefined') return;
		todoAnim = 'none';
		requestAnimationFrame(() => {
			todoAnim = kind;
			window.setTimeout(() => {
				todoAnim = 'none';
			}, 220);
		});
	}

	$effect(() => {
		// Only animate when this block has a todo indicator at all
		if (todo === null) {
			lastTodo = null;
			todoAnim = 'none';
			return;
		}

		// First render: just set baseline
		if (lastTodo === null) {
			lastTodo = todo;
			return;
		}

		// Changed from unchecked → checked
		if (lastTodo === false && todo === true) {
			triggerTodoAnim('check');
		}

		// Changed from checked → unchecked
		if (lastTodo === true && todo === false) {
			triggerTodoAnim('uncheck');
		}

		lastTodo = todo;
	});
</script>

<button
	class={`${baseClasses} ${habitClasses} ${currentClass}`}
	class:ring-1={selected}
	class:ring-stone-400={selected}
	class:ring-offset-1={selected}
	class:ring-offset-stone-50={selected}
	class:block-cut-source={Boolean(props.isCut)}
	role={canOpen ? 'button' : undefined}
	onclick={handleBlockClick}
	onkeydown={handleBlockKeydown}
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
				class={`inline-flex shrink-0 items-center gap-0.5 rounded-sm text-[10px] font-semibold tracking-wider uppercase ${habitStreakClasses}`}
				class:habit-bounce-up={streakAnim === 'up'}
				class:habit-bounce-down={streakAnim === 'down'}
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
				{habitStreak?.length ? habitStreak.length : '0'}
			</span>
		{/if}
	</span>

	{#if showTodo && !isHabit}
		<div
			class="relative ml-3 grid h-3 w-3 place-items-center rounded-full focus:outline-none"
			class:bg-stone-700={todo}
			class:border={todo === false}
			class:border-stone-400={todo === false}
			class:todo-pop-checked={todoAnim === 'check'}
			class:todo-pop-unchecked={todoAnim === 'uncheck'}
		>
			{#if todo}
				<svg viewBox="0 0 24 24" class="h-3 w-3 text-stone-50" fill="none">
					<path
						d="M7 12.5 L10.25 15.75 L16.75 9.25"
						stroke="currentColor"
						stroke-width="2"
						stroke-linecap="round"
						stroke-linejoin="round"
						pathLength="100"
						class="check"
						class:check-animated={todoAnim === 'check'}
					/>
				</svg>
			{:else}
				<svg viewBox="0 0 24 24" class="h-3 w-3 text-stone-400" fill="none" />
			{/if}

			{#if todoAnim === 'check'}
				<span class="todo-halo absolute inset-0 rounded-full" aria-hidden="true" />
			{/if}
		</div>
	{/if}
</button>

<style>
	.habit-bounce-up {
		animation: habit-bounce-up 0.22s ease-out;
	}

	.habit-bounce-down {
		animation: habit-bounce-down 0.22s ease-out;
	}

	@keyframes habit-bounce-up {
		0% {
			transform: translateY(0);
		}
		35% {
			transform: translateY(-2px);
		}
		100% {
			transform: translateY(0);
		}
	}

	@keyframes habit-bounce-down {
		0% {
			transform: translateY(0);
		}
		35% {
			transform: translateY(2px);
		}
		100% {
			transform: translateY(0);
		}
	}

	.todo-pop-checked {
		animation: todo-pop-checked 0.22s ease-out;
	}

	.todo-pop-unchecked {
		animation: todo-pop-unchecked 0.18s ease-in;
	}

	.todo-halo {
		background: radial-gradient(circle, rgba(15, 23, 42, 0.25), transparent 70%);
		animation: todo-halo-fade 0.25s ease-out forwards;
		pointer-events: none;
	}

	@keyframes todo-pop-checked {
		0% {
			transform: scale(0.9);
		}
		40% {
			transform: scale(1.25);
		}
		100% {
			transform: scale(1);
		}
	}

	@keyframes todo-pop-unchecked {
		0% {
			transform: scale(1);
		}
		40% {
			transform: scale(0.85);
		}
		100% {
			transform: scale(1);
		}
	}

	@keyframes todo-halo-fade {
		0% {
			opacity: 0.4;
			transform: scale(0.6);
		}
		100% {
			opacity: 0;
			transform: scale(1.4);
		}
	}

	.check {
		/* Static checkmark: fully drawn */
		stroke-dasharray: none;
		stroke-dashoffset: 0;
	}

	.check-animated {
		stroke-dasharray: 100;
		stroke-dashoffset: 100;
		animation: draw-check 200ms 100ms ease-out forwards;
	}

	@keyframes draw-check {
		from {
			stroke-dashoffset: 100;
		}
		to {
			stroke-dashoffset: 0;
		}
	}

	.block-cut-source {
		box-shadow: 0 0 0 2px rgb(248 113 113);
		border-color: rgb(248 113 113);
	}
</style>
