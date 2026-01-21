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
		status?: boolean | null;
		showStatus?: boolean;
		editable?: boolean;
		onSelect?: () => void;
		onCycleStatus?: () => void;
		onPrimaryAction?: () => boolean;
		selected?: boolean;
		category?: string | null;
		habit?: string | null;
		isCurrent?: boolean;
		habitStreak?: PlayerStreak | null;
		isCut?: boolean;
	}>();

	const title = $derived(props.title ?? '');
	const editable = $derived(props.editable ?? false);
	const onSelect = $derived(props.onSelect ?? (() => {}));
	const status = $derived(props.status ?? null);
	const onCycleStatus = $derived(props.onCycleStatus ?? (() => {}));
	const onPrimaryAction = $derived(props.onPrimaryAction ?? (() => false));
	const selected = $derived(props.selected ?? false);
	const habitPlaceholder = $derived((props.habit ?? '').trim());
	const category = $derived((props.category ?? '').trim().toLowerCase());
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
	const habitKey = $derived(habitPlaceholder.toLowerCase());
	const habitPreset = $derived(HABITS[habitKey]);
	const isHabit = $derived(Boolean(props.habit));
	const showCategoryIcon = $derived(category.length > 0 && !isHabit);
	const displayTitle = $derived(isHabit && trimmed.length === 0 ? habitPlaceholder : trimmed);
	const isFilled = $derived(displayTitle.length > 0);
	const showStatusProp = $derived(props.showStatus);

	const currentClass = $derived(isCurrentBlock ? 'bg-stone-200' : '');

	const baseClasses =
		'flex w-full min-w-0 flex-row items-center rounded-sm p-2 transition overflow-hidden focus:outline-0';

	const habitClasses = $derived(
		isHabit
			? `border border-stone-700 text-stone-900 ${status === true ? '' : 'border-dashed'}`
			: `${
					isFilled ? 'bg-stone-100 text-stone-900' : 'bg-stone-100 text-stone-600 border-stone-100'
				}`
	);

	const showStatus = $derived(
		showStatusProp === undefined ? isFilled && !isHabit : Boolean(showStatusProp)
	);
	const canToggleStatus = $derived(isFilled && !isHabit);

	const canToggleHabit = $derived(isHabit);
	const showHabitStreak = $derived(isHabit && Boolean(habitStreakLabel));
	const canOpen = $derived(editable && !habitPlaceholder);

	function handleBlockClick() {
		if (onPrimaryAction()) return;
		if (canToggleStatus || canToggleHabit) {
			onCycleStatus();
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

	let statusAnim = $state<'none' | 'check' | 'uncheck' | 'progress'>('none');
	let lastStatus = $state<boolean | null>(null);

	function triggerStatusAnim(kind: 'check' | 'uncheck' | 'progress') {
		if (typeof window === 'undefined') return;
		statusAnim = 'none';
		requestAnimationFrame(() => {
			statusAnim = kind;
			window.setTimeout(() => {
				statusAnim = 'none';
			}, 220);
		});
	}

	$effect(() => {
		if (!showStatus) {
			lastStatus = null;
			statusAnim = 'none';
			return;
		}

		// First render: just set baseline
		if (lastStatus === null && status === null) {
			lastStatus = status;
			return;
		}

		if (lastStatus === null && status === false) {
			triggerStatusAnim('progress');
		}

		if (lastStatus !== true && status === true) {
			triggerStatusAnim('check');
		}

		if (lastStatus === true && status !== true) {
			triggerStatusAnim('uncheck');
		}

		lastStatus = status;
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
			{#if showCategoryIcon}
				<span class="text-stone-300 mr-1">
					{#if category === 'social'}
						<svg
							xmlns="http://www.w3.org/2000/svg"
							viewBox="0 0 16 16"
							class="h-2.5 w-2.5"
							fill="currentColor"
							aria-hidden="true"
						>
							<path d="M3 14s-1 0-1-1 1-4 6-4 6 3 6 4-1 1-1 1zm5-6a3 3 0 1 0 0-6 3 3 0 0 0 0 6" />
						</svg>
					{:else if category === 'body'}
						<svg
							xmlns="http://www.w3.org/2000/svg"
							viewBox="0 0 16 16"
							class="h-2.5 w-2.5"
							fill="currentColor"
							aria-hidden="true"
						>
							<path
								d="M1.828 8.9 8.9 1.827a4 4 0 1 1 5.657 5.657l-7.07 7.071A4 4 0 1 1 1.827 8.9Zm9.128.771 2.893-2.893a3 3 0 1 0-4.243-4.242L6.713 5.429z"
							/>
						</svg>
					{:else if category === 'work'}
						<svg
							xmlns="http://www.w3.org/2000/svg"
							viewBox="0 0 16 16"
							class="h-2.5 w-2.5"
							fill="currentColor"
							aria-hidden="true"
						>
							<path
								d="M0 3a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H2a2 2 0 0 1-2-2zm9.5 5.5h-3a.5.5 0 0 0 0 1h3a.5.5 0 0 0 0-1m-6.354-.354a.5.5 0 1 0 .708.708l2-2a.5.5 0 0 0 0-.708l-2-2a.5.5 0 1 0-.708.708L4.793 6.5z"
							/>
						</svg>
					{:else if category === 'admin'}
						<svg
							xmlns="http://www.w3.org/2000/svg"
							viewBox="0 0 16 16"
							class="h-2.5 w-2.5"
							fill="currentColor"
							aria-hidden="true"
						>
							<path
								d="M12.643 15C13.979 15 15 13.845 15 12.5V5H1v7.5C1 13.845 2.021 15 3.357 15zM5.5 7h5a.5.5 0 0 1 0 1h-5a.5.5 0 0 1 0-1M.8 1a.8.8 0 0 0-.8.8V3a.8.8 0 0 0 .8.8h14.4A.8.8 0 0 0 16 3V1.8a.8.8 0 0 0-.8-.8z"
							/>
						</svg>
					{/if}
				</span>
			{/if}
			{#if habitPreset}
				<span class="text-xs leading-none">{habitPreset.icon}</span>
			{/if}

			{#if isFilled}
				{displayTitle}
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

	{#if showStatus}
		<div
			class="relative ml-3 grid aspect-square h-3.5 w-3.5 shrink-0 place-items-center rounded-full focus:outline-none"
			class:bg-stone-700={status === true}
			class:status-pop-checked={statusAnim === 'check' || statusAnim === 'progress'}
			class:status-pop-unchecked={statusAnim === 'uncheck'}
		>
			{#if status === true}
				<svg viewBox="0 0 24 24" class="relative z-10 h-3.5 w-3.5 text-stone-50" fill="none">
					<path
						d="M7 12.5 L10.25 15.75 L16.75 9.25"
						stroke="currentColor"
						stroke-width="2"
						stroke-linecap="round"
						stroke-linejoin="round"
						pathLength="100"
						class="check"
						class:check-animated={statusAnim === 'check'}
					/>
				</svg>
			{:else}
				<svg viewBox="0 0 24 24" class="h-3.5 w-3.5 text-stone-700" fill="none">
					<circle
						cx="12"
						cy="12"
						r="9"
						stroke="currentColor"
						stroke-width="2"
						stroke-linecap="round"
						class:status-ring-dashed={status === null}
						class:status-ring-solid={status === false}
						class:status-ring-progress={statusAnim === 'progress'}
					/>
				</svg>
			{/if}

			{#if statusAnim === 'check'}
				<span class="status-halo absolute inset-0 rounded-full" aria-hidden="true" />
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

	.status-pop-checked {
		animation: status-pop-checked 0.22s ease-out;
	}

	.status-pop-unchecked {
		animation: status-pop-unchecked 0.18s ease-in;
	}

	.status-ring-dashed {
		stroke-dasharray: 3 3;
	}

	.status-ring-solid {
		stroke-dasharray: 0;
	}

	.status-ring-progress {
		animation: status-ring-progress 0.22s ease-out;
	}

	.status-halo {
		background: radial-gradient(circle, rgba(15, 23, 42, 0.25), transparent 70%);
		animation: status-halo-fade 0.25s ease-out forwards;
		pointer-events: none;
	}

	@keyframes status-pop-checked {
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

	@keyframes status-pop-unchecked {
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

	@keyframes status-halo-fade {
		0% {
			opacity: 0.4;
			transform: scale(0.6);
		}
		100% {
			opacity: 0;
			transform: scale(1.4);
		}
	}

	@keyframes status-ring-progress {
		0% {
			stroke-dasharray: 3 3;
		}
		100% {
			stroke-dasharray: 0;
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
