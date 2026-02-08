<script lang="ts">
	import type { PlayerStreak } from '$lib/streaks';

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
		isCopied?: boolean;
		badShakeNonce?: number;
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
		if (!isHabit) return null;
		if (habitStreak == null || !habitStreak || habitStreak.length <= 0) return '0';
		return `${habitStreak.kind === 'positive' ? '' : '-'}${habitStreak.length}`;
	});
	const habitStreakClasses = $derived(() => {
		if (!habitStreak) return 'border-stone-300 text-stone-500';
		return habitStreak.kind === 'positive'
			? 'border-emerald-400 text-emerald-700'
			: 'border-rose-400 text-rose-700';
	});

	const trimmed = $derived((title ?? '').trim());
	const isHabit = $derived(Boolean(props.habit));
	const isBadCategory = $derived(category === 'bad');
	const displayTitle = $derived(isHabit && trimmed.length === 0 ? habitPlaceholder : trimmed);
	const displayTitleLower = $derived(displayTitle.trim().toLowerCase());
	const isDriveCategory = $derived(
		displayTitleLower === 'drive' || displayTitleLower === 'driving'
	);
	const showCategoryIcon = $derived((category.length > 0 && category !== 'bad') || isDriveCategory);
	const showHabitFallbackIcon = $derived(isHabit && category.length === 0 && !isDriveCategory);
	const isFilled = $derived(displayTitle.length > 0);
	const showStatusProp = $derived(props.showStatus);
	const isCopied = $derived(Boolean(props.isCopied));
	const badShakeNonce = $derived(props.badShakeNonce ?? 0);

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
		(showStatusProp === undefined ? isFilled && !isHabit : Boolean(showStatusProp)) &&
			(status !== null || isBadCategory)
	);
	const canToggleStatus = $derived(editable && isFilled && !isHabit && !isBadCategory);

	const canToggleHabit = $derived(editable && isHabit);
	const showHabitStreak = $derived(isHabit && habitStreakLabel !== null);
	const canOpen = $derived(editable && !habitPlaceholder);

	function handleBlockClick() {
		if (!editable) return;
		if (onPrimaryAction()) return;
		if (isBadCategory && showStatus) {
			triggerBadStatusShake();
		}
		if (canToggleStatus || canToggleHabit) {
			onCycleStatus();
			return;
		}
		if (!canOpen) return;
		onSelect();
	}

	function handleBlockKeydown(event: KeyboardEvent) {
		if (!editable) return;
		if (!selected) return;
		if (event.key === 'Enter' || event.key === ' ') {
			event.stopPropagation();
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
		const prevLen = lastStreakLength;
		const prevKind = lastStreakKind;
		if (!habitStreak) {
			if (prevLen !== null) {
				triggerStreakAnim('down');
			}
			lastStreakLength = null;
			lastStreakKind = null;
			streakAnim = 'none';
			return;
		}

		const len = habitStreak.length;
		const kind = habitStreak.kind;

		if (prevLen === null) {
			triggerStreakAnim(kind === 'positive' ? 'up' : 'down');
		} else {
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
	let badStatusAnim = $state<'none' | 'shake'>('none');
	let lastBadShakeNonce = $state(0);

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

	function triggerBadStatusShake() {
		if (typeof window === 'undefined') return;
		badStatusAnim = 'none';
		requestAnimationFrame(() => {
			badStatusAnim = 'shake';
			window.setTimeout(() => {
				badStatusAnim = 'none';
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

	$effect(() => {
		if (!isBadCategory) {
			lastBadShakeNonce = badShakeNonce;
			badStatusAnim = 'none';
			return;
		}
		if (badShakeNonce && badShakeNonce !== lastBadShakeNonce) {
			triggerBadStatusShake();
		}
		lastBadShakeNonce = badShakeNonce;
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
	tabindex={-1}
	onclick={handleBlockClick}
	onkeydown={handleBlockKeydown}
>
	<span class="flex w-full min-w-0 items-center justify-between gap-2 truncate text-left text-xs">
		<div class="flex flex-row items-center gap-0.5">
			{#if showCategoryIcon}
				<span
					class={`mr-1 ${
						isDriveCategory
							? 'text-stone-300'
							: category === 'admin'
								? 'text-amber-900/30'
								: category === 'body'
									? 'text-rose-300'
									: category === 'work'
										? 'text-slate-300'
										: 'text-violet-300'
					}`}
				>
					{#if isDriveCategory}
						<svg
							xmlns="http://www.w3.org/2000/svg"
							width="16"
							height="16"
							fill="currentColor"
							class="bi bi-car-front-fill h-2.5 w-2.5"
							viewBox="0 0 16 16"
							aria-hidden="true"
						>
							<path
								d="M2.52 3.515A2.5 2.5 0 0 1 4.82 2h6.362c1 0 1.904.596 2.298 1.515l.792 1.848c.075.175.21.319.38.404.5.25.855.715.965 1.262l.335 1.679q.05.242.049.49v.413c0 .814-.39 1.543-1 1.997V13.5a.5.5 0 0 1-.5.5h-2a.5.5 0 0 1-.5-.5v-1.338c-1.292.048-2.745.088-4 .088s-2.708-.04-4-.088V13.5a.5.5 0 0 1-.5.5h-2a.5.5 0 0 1-.5-.5v-1.892c-.61-.454-1-1.183-1-1.997v-.413a2.5 2.5 0 0 1 .049-.49l.335-1.68c.11-.546.465-1.012.964-1.261a.8.8 0 0 0 .381-.404l.792-1.848ZM3 10a1 1 0 1 0 0-2 1 1 0 0 0 0 2m10 0a1 1 0 1 0 0-2 1 1 0 0 0 0 2M6 8a1 1 0 0 0 0 2h4a1 1 0 1 0 0-2zM2.906 5.189a.51.51 0 0 0 .497.731c.91-.073 3.35-.17 4.597-.17s3.688.097 4.597.17a.51.51 0 0 0 .497-.731l-.956-1.913A.5.5 0 0 0 11.691 3H4.309a.5.5 0 0 0-.447.276L2.906 5.19Z"
							/>
						</svg>
					{:else if category === 'rest'}
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
			{#if showHabitFallbackIcon}
				<span class="mr-1 text-stone-400">
					<svg
						xmlns="http://www.w3.org/2000/svg"
						viewBox="0 0 16 16"
						class="h-2.5 w-2.5"
						fill="currentColor"
						aria-hidden="true"
					>
						<path
							d="M11.534 7h3.932a.25.25 0 0 1 .192.41l-1.966 2.36a.25.25 0 0 1-.384 0l-1.966-2.36a.25.25 0 0 1 .192-.41m-11 2h3.932a.25.25 0 0 0 .192-.41L2.692 6.23a.25.25 0 0 0-.384 0L.342 8.59A.25.25 0 0 0 .534 9"
						/>
						<path
							fill-rule="evenodd"
							d="M8 3c-1.552 0-2.94.707-3.857 1.818a.5.5 0 1 1-.771-.636A6.002 6.002 0 0 1 13.917 7H12.9A5 5 0 0 0 8 3M3.1 9a5.002 5.002 0 0 0 8.757 2.182.5.5 0 1 1 .771.636A6.002 6.002 0 0 1 2.083 9z"
						/>
					</svg>
				</span>
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
			{#if isBadCategory}
				<svg
					xmlns="http://www.w3.org/2000/svg"
					viewBox="0 0 16 16"
					class="relative z-10 h-3.5 w-3.5 text-rose-500"
					class:status-bad-shake={badStatusAnim === 'shake'}
					fill="currentColor"
				>
					<path
						d="M16 8A8 8 0 1 1 0 8a8 8 0 0 1 16 0M5.354 4.646a.5.5 0 1 0-.708.708L7.293 8l-2.647 2.646a.5.5 0 0 0 .708.708L8 8.707l2.646 2.647a.5.5 0 0 0 .708-.708L8.707 8l2.647-2.646a.5.5 0 0 0-.708-.708L8 7.293z"
					/>
				</svg>
			{:else if status === true}
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

	.status-bad-shake {
		animation: status-bad-shake 0.22s ease-in-out;
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

	@keyframes status-bad-shake {
		0% {
			transform: translateX(0);
		}
		20% {
			transform: translateX(-1px);
		}
		45% {
			transform: translateX(1px);
		}
		70% {
			transform: translateX(-1px);
		}
		100% {
			transform: translateX(0);
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
