<script lang="ts">
	import { fade, fly, scale } from 'svelte/transition';

	const START = 8;
	const END = 23;
	const HOURS = Array.from({ length: END - START + 1 }, (_, i) => START + i);
	const hh = (n: number) => n.toString().padStart(2, '0');

	let {
		normal,
		open = false,
		onClose = () => {},
		onSave = () => {},
		initialHour = null,
		initialHalf = null,
		initialTitle = '',
		initialStatus = null,
		initialCategory = null,
		initialHabit = null,
		maxBlockCountFor = null,
		runLengthFor = null
	} = $props<{
		normal?: boolean;
		open?: boolean;
		onClose?: () => void;
		onSave?: (
			text: string,
			status: boolean | null,
			hour: number,
			half: 0 | 1,
			blockCount: number,
			category: BlockCategory | null,
			habitConfig: HabitSaveConfig | null
		) => void;
		initialHour?: number | null;
		initialHalf?: 0 | 1 | null;
		initialTitle?: string | null;
		initialStatus?: boolean | null;
		initialCategory?: BlockCategory | null;
		initialHabit?: HabitConfig | null;
		maxBlockCountFor?: ((hour: number, half: 0 | 1) => number) | null;
		runLengthFor?: ((hour: number, half: 0 | 1) => number) | null;
	}>();

	type ModalMode = 'insert' | 'normal';

	type BlockCategory = 'body' | 'rest' | 'work' | 'admin' | 'bad';
	type StatusKind = 'none' | 'planned' | 'bad';
	type HabitConfig = { id: string; repeatDays: number[] };
	type HabitSaveConfig = { id: string | null; repeatDays: number[] };
	type CategoryPreset = {
		label: string;
		value: BlockCategory;
		key: string;
	};

	const CATEGORY_PRESETS: CategoryPreset[] = [
		{ label: 'Body', value: 'body', key: '1' },
		{ label: 'Rest', value: 'rest', key: '2' },
		{ label: 'Work', value: 'work', key: '3' },
		{ label: 'Admin', value: 'admin', key: '4' }
	];
	const HABIT_DAYS = [
		{ label: 'Monday', value: 0 },
		{ label: 'Tuesday', value: 1 },
		{ label: 'Wednesday', value: 2 },
		{ label: 'Thursday', value: 3 },
		{ label: 'Friday', value: 4 },
		{ label: 'Saturday', value: 5 },
		{ label: 'Sunday', value: 6 }
	];
	const HABIT_MENU_DAYS = [{ label: 'All days', value: -1 }, ...HABIT_DAYS];

	let text = $state('');
	let status = $state<boolean | null>(null);
	let category = $state<BlockCategory | null>(null);
	let blockCount = $state(1);
	let isNewBlock = $state(true);
	let runLength = $state(1);
	let habitMode = $state(false);
	let habitMenuOpen = $state(false);
	let habitMenuIndex = $state(0);
	let habitDays = $state<number[]>([]);
	let habitId = $state<string | null>(null);
	const statusKind = $derived<StatusKind>(
		category === 'bad' ? 'bad' : status === false ? 'planned' : 'none'
	);
	const statusLabel = $derived(statusKind === 'bad' ? 'Bad' : 'Planned');
	const displayedBlockCount = $derived(isNewBlock ? blockCount : runLength);
	const blockCountDisabled = $derived(!isNewBlock || habitMode);
	const statusDisabled = $derived(habitMode);
	let saving = $state(false);
	let inputEl: HTMLInputElement | null = $state(null);
	let modalEl: HTMLDivElement | null = $state(null);
	let hour = $state<number>((initialHour ?? currentBlock().hour) as number);
	let half = $state<0 | 1>((initialHalf ?? currentBlock().half) as 0 | 1);
	let mode = $state<ModalMode>(normal ? 'normal' : 'insert');
	let didInit = $state(false);

	function focusInputSoon() {
		queueMicrotask(() => inputEl?.focus());
	}

	function focusModalSoon() {
		queueMicrotask(() => modalEl?.focus());
	}

	function enterInsertMode() {
		mode = 'insert';
		focusInputSoon();
	}

	function enterNormalMode() {
		mode = 'normal';
		inputEl?.blur();
		focusModalSoon();
	}

	function handleBackdropClick(e: MouseEvent) {
		if (e.target === e.currentTarget) onClose();
	}

	function setStatusKind(next: StatusKind) {
		if (next === 'bad') {
			status = null;
			category = 'bad';
			return;
		}
		if (next === 'planned') {
			status = false;
			if (category === 'bad') category = null;
			return;
		}
		status = null;
		if (category === 'bad') category = null;
	}

	function cycleStatus() {
		const next: StatusKind =
			statusKind === 'none' ? 'planned' : statusKind === 'planned' ? 'bad' : 'none';
		setStatusKind(next);
	}

	function toggleHabitDay(value: number) {
		if (value === -1) {
			if (habitDays.length === HABIT_DAYS.length) {
				habitDays = [];
				return;
			}
			habitDays = HABIT_DAYS.map((day) => day.value);
			return;
		}
		if (habitDays.includes(value)) {
			habitDays = habitDays.filter((day) => day !== value);
		} else {
			habitDays = [...habitDays, value].sort((a, b) => a - b);
		}
	}
	function toggleHabitMenu() {
		habitMenuOpen = !habitMenuOpen;
		if (habitMenuOpen) {
			habitMenuIndex = Math.min(habitMenuIndex, HABIT_MENU_DAYS.length - 1);
		}
	}
	function maxBlockCount() {
		if (!isNewBlock) return 1;
		return maxBlockCountFor ? maxBlockCountFor(hour, half) : 1;
	}

	function cycleBlockCount() {
		if (!isNewBlock) return;
		const maxCount = maxBlockCount();
		blockCount = blockCount >= maxCount ? 1 : blockCount + 1;
	}

	function handleKeydown(e: KeyboardEvent) {
		const key = e.key.length === 1 ? e.key.toLowerCase() : e.key;

		if (habitMenuOpen) {
			if (key === 'Escape') {
				habitMenuOpen = false;
				e.preventDefault();
				return;
			}
			if (key === 'j' || key === 'ArrowDown') {
				habitMenuIndex = (habitMenuIndex + 1) % HABIT_MENU_DAYS.length;
				e.preventDefault();
				return;
			}
			if (key === 'k' || key === 'ArrowUp') {
				habitMenuIndex = (habitMenuIndex - 1 + HABIT_MENU_DAYS.length) % HABIT_MENU_DAYS.length;
				e.preventDefault();
				return;
			}
			if (key === 'Enter') {
				const day = HABIT_MENU_DAYS[habitMenuIndex];
				if (day) toggleHabitDay(day.value);
				e.preventDefault();
				return;
			}
		}

		if (key === 'Escape') {
			if (mode === 'insert') {
				enterNormalMode();
			} else {
				onClose();
			}
			e.preventDefault();
			return;
		}

		if (mode === 'normal' && key === 'i') {
			enterInsertMode();
			e.preventDefault();
			return;
		}

		if (mode === 'normal' && key === 'b') {
			e.preventDefault();
			cycleBlockCount();
			return;
		}

		if (mode === 'normal' && key === 's') {
			if (statusDisabled) return;
			e.preventDefault();
			cycleStatus();
			return;
		}

		if (mode === 'normal' && key === 'h') {
			e.preventDefault();
			toggleHabitMenu();
			return;
		}

		// normal-mode numeric category shortcuts
		if (mode === 'normal') {
			const preset = CATEGORY_PRESETS.find((p) => p.key === key);
			if (preset) {
				e.preventDefault();
				selectCategory(preset.value);
				enterInsertMode();
				return;
			}
		}

		if (key === 'Enter' && e.metaKey) {
			e.preventDefault();
			void handleSubmit();
		} else if (key === 'Enter' && mode === 'normal') {
			e.preventDefault();
			void handleSubmit();
		}
	}

	function currentBlock(): { hour: number; half: 0 | 1 } {
		const now = new Date();
		const hour = now.getHours();
		const half = (now.getMinutes() < 30 ? 0 : 1) as 0 | 1;
		return { hour, half };
	}

	async function handleSubmit() {
		const value = text.trim();
		if (!value || saving) return;

		saving = true;
		try {
			const saveCount = isNewBlock ? blockCount : 1;
			const habitConfig = habitMode
				? {
						id: habitId,
						repeatDays: habitDays
					}
				: null;
			await Promise.resolve(onSave(value, status, hour, half, saveCount, category, habitConfig));
			text = '';
			status = null;
			onClose();
		} finally {
			saving = false;
		}
	}

	$effect(() => {
		if (open && !normal) {
			enterInsertMode();
		} else if (open && normal) {
			enterNormalMode();
		} else {
			mode = 'insert';
		}
	});

	$effect(() => {
		if (!open) {
			didInit = false;
			return;
		}
		if (didInit) return;
		didInit = true;
		const fallback = currentBlock();
		hour = (initialHour ?? fallback.hour) as number;
		half = (initialHalf ?? fallback.half) as 0 | 1;
		text = initialTitle ?? '';
		status = initialStatus ?? null;
		category = initialCategory ?? null;
		habitId = initialHabit?.id ?? null;
		habitDays = initialHabit?.repeatDays ?? [];
		habitMode = habitDays.length > 0;
		habitMenuOpen = false;
		habitMenuIndex = 0;
		isNewBlock = (initialTitle ?? '').trim().length === 0 && !initialHabit;
		runLength = !isNewBlock && runLengthFor ? runLengthFor(hour, half) : 1;
		blockCount = habitMode ? 1 : isNewBlock ? 1 : runLength;
	});

	$effect(() => {
		if (!open || isNewBlock || habitMode) return;
		runLength = runLengthFor ? runLengthFor(hour, half) : 1;
		blockCount = runLength;
	});

	$effect(() => {
		if (!open || !isNewBlock) return;
		const maxCount = maxBlockCount();
		if (blockCount > maxCount) {
			blockCount = maxCount;
		}
	});
	$effect(() => {
		if (!open) return;
		habitMode = habitDays.length > 0;
		if (habitMode) {
			status = null;
			blockCount = 1;
		} else {
			habitId = null;
		}
	});

	function selectCategory(next: BlockCategory) {
		category = category === next ? null : next;
		queueMicrotask(() => inputEl?.focus());
	}
</script>

{#if open}
	<div
		bind:this={modalEl}
		in:fade={{ duration: 100 }}
		class="fixed inset-0 z-[2000] flex items-center justify-center bg-black/40 focus:ring-0 focus:outline-0"
		role="dialog"
		aria-modal="true"
		aria-label="New log"
		tabindex="-1"
		onclick={handleBackdropClick}
		onkeydown={handleKeydown}
	>
		<div
			in:scale={{ start: 0.95, duration: 160 }}
			class="w-full max-w-lg rounded-xl border border-stone-200 bg-white text-stone-800 shadow-[0_12px_32px_rgba(15,15,15,0.12)]"
		>
			<div class="flex flex-row gap-1 p-3 pb-0 text-xs text-stone-600">
				<select
					class="no-chevron inline-flex items-center rounded-md p-1 pl-2 text-[11px] tracking-wide text-stone-500 uppercase hover:bg-stone-200 focus:bg-stone-200 focus:outline-0"
					value={hour}
					onchange={(event) => (hour = Number((event.currentTarget as HTMLSelectElement).value))}
				>
					{#each HOURS as h}
						<option value={h}>Hour {hh(h)}</option>
					{/each}
				</select>
				<button
					class="inline-flex items-center gap-1 rounded-md p-1 pl-2 text-[11px] tracking-wide text-stone-500 uppercase hover:bg-stone-200 focus:bg-stone-200 focus:outline-0"
					onclick={() => (half = half ? 0 : 1)}
				>
					Block
					<span class="relative inline-block h-[1.25em] w-[1em] overflow-hidden align-middle">
						{#key half}
							<span
								class="absolute inset-0 flex items-center justify-center leading-none"
								in:fly={{ y: half ? -10 : 10, duration: 180 }}
								out:fly={{ y: half ? 10 : -10, duration: 180 }}
							>
								{half ? 'B' : 'A'}
							</span>
						{/key}
					</span>
				</button>
			</div>

			<div class="flex w-full flex-row items-center">
				<input
					bind:this={inputEl}
					type="text"
					placeholder="Title"
					class="w-full p-5 text-2xl text-stone-800 transition outline-none"
					onfocus={enterInsertMode}
					bind:value={text}
					autocomplete="off"
				/>
			</div>

			<div class="flex flex-row gap-1 px-4 pb-2">
				{#each CATEGORY_PRESETS as p}
					<button
						type="button"
						class="inline-flex items-center justify-center gap-1 rounded-lg border border-stone-200 px-2 py-1 text-[10px] font-medium text-stone-900 transition"
						class:bg-stone-100={category === p.value}
						onclick={() => selectCategory(p.value)}
					>
						<span
							class={`relative flex h-3 w-3 items-center justify-center ${
								p.value === 'admin'
									? 'text-amber-900/30'
									: p.value === 'body'
										? 'text-rose-300'
										: p.value === 'work'
											? 'text-slate-300'
											: 'text-violet-300'
							}`}
						>
							{#if p.value === 'rest'}
								<svg
									xmlns="http://www.w3.org/2000/svg"
									viewBox="0 0 16 16"
									class="h-3 w-3"
									fill="currentColor"
								>
									<path
										d="M3 14s-1 0-1-1 1-4 6-4 6 3 6 4-1 1-1 1zm5-6a3 3 0 1 0 0-6 3 3 0 0 0 0 6"
									/>
								</svg>
							{:else if p.value === 'body'}
								<svg
									xmlns="http://www.w3.org/2000/svg"
									viewBox="0 0 16 16"
									class="h-3 w-3"
									fill="currentColor"
								>
									<path
										d="M1.828 8.9 8.9 1.827a4 4 0 1 1 5.657 5.657l-7.07 7.071A4 4 0 1 1 1.827 8.9Zm9.128.771 2.893-2.893a3 3 0 1 0-4.243-4.242L6.713 5.429z"
									/>
								</svg>
							{:else if p.value === 'work'}
								<svg
									xmlns="http://www.w3.org/2000/svg"
									viewBox="0 0 16 16"
									class="h-3 w-3"
									fill="currentColor"
								>
									<path
										d="M0 3a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H2a2 2 0 0 1-2-2zm9.5 5.5h-3a.5.5 0 0 0 0 1h3a.5.5 0 0 0 0-1m-6.354-.354a.5.5 0 1 0 .708.708l2-2a.5.5 0 0 0 0-.708l-2-2a.5.5 0 1 0-.708.708L4.793 6.5z"
									/>
								</svg>
							{:else if p.value === 'admin'}
								<svg
									xmlns="http://www.w3.org/2000/svg"
									viewBox="0 0 16 16"
									class="h-3 w-3"
									fill="currentColor"
								>
									<path
										d="M12.643 15C13.979 15 15 13.845 15 12.5V5H1v7.5C1 13.845 2.021 15 3.357 15zM5.5 7h5a.5.5 0 0 1 0 1h-5a.5.5 0 0 1 0-1M.8 1a.8.8 0 0 0-.8.8V3a.8.8 0 0 0 .8.8h14.4A.8.8 0 0 0 16 3V1.8a.8.8 0 0 0-.8-.8z"
									/>
								</svg>
							{/if}
							{#if mode === 'normal'}
								<span
									class="absolute h-3 w-3 rounded-xs bg-stone-200 text-[8px] text-stone-500"
									in:fly={{ y: 6, duration: 200 }}
								>
									{p.key}
								</span>
							{/if}
						</span>

						<span>{p.label}</span>
					</button>
				{/each}
				<button
					type="button"
					class="inline-flex items-center justify-center gap-1 rounded-lg border border-stone-200 px-2 py-1 text-[10px] font-medium text-stone-900 transition"
					class:opacity-50={blockCountDisabled}
					class:cursor-not-allowed={blockCountDisabled}
					onclick={cycleBlockCount}
					disabled={blockCountDisabled}
				>
					<span class="relative flex h-3 w-3 items-center justify-center">
						<svg
							xmlns="http://www.w3.org/2000/svg"
							viewBox="0 0 16 16"
							class="h-3 w-3 text-stone-700"
							fill="currentColor"
						>
							<path
								d="M16 8A8 8 0 1 1 0 8a8 8 0 0 1 16 0M8 3.5a.5.5 0 0 0-1 0V9a.5.5 0 0 0 .252.434l3.5 2a.5.5 0 0 0 .496-.868L8 8.71z"
							/>
						</svg>
						{#if mode === 'normal' && !blockCountDisabled}
							<span
								class="absolute z-20 h-3 w-3 rounded-xs bg-stone-200 text-[8px] text-stone-500"
								in:fly={{ y: 6, duration: 200 }}
							>
								b
							</span>
						{/if}
					</span>
					{displayedBlockCount} Block{displayedBlockCount === 1 ? '' : 's'}
				</button>
				<button
					type="button"
					class="inline-flex items-center justify-center gap-1 rounded-lg border border-stone-200 px-2 py-1 text-[10px] font-medium text-stone-900 transition"
					class:bg-stone-100={statusKind !== 'none'}
					class:opacity-50={statusDisabled}
					class:cursor-not-allowed={statusDisabled}
					onclick={cycleStatus}
					disabled={statusDisabled}
				>
					<span class="relative flex h-3 w-3 items-center justify-center">
						{#if statusKind === 'bad'}
							<svg
								xmlns="http://www.w3.org/2000/svg"
								viewBox="0 0 16 16"
								class="h-3 w-3 text-rose-500"
								fill="currentColor"
							>
								<path
									d="M16 8A8 8 0 1 1 0 8a8 8 0 0 1 16 0M5.354 4.646a.5.5 0 1 0-.708.708L7.293 8l-2.647 2.646a.5.5 0 0 0 .708.708L8 8.707l2.646 2.647a.5.5 0 0 0 .708-.708L8.707 8l2.647-2.646a.5.5 0 0 0-.708-.708L8 7.293z"
								/>
							</svg>
						{:else}
							<svg viewBox="0 0 24 24" class="h-3 w-3 text-stone-700" fill="none">
								<circle
									cx="12"
									cy="12"
									r="9"
									stroke="currentColor"
									stroke-width="2"
									stroke-linecap="round"
								/>
							</svg>
						{/if}
						{#if mode === 'normal'}
							<span
								class="absolute z-20 h-3 w-3 rounded-xs bg-stone-200 text-[8px] text-stone-500"
								in:fly={{ y: 6, duration: 200 }}
							>
								s
							</span>
						{/if}
					</span>
					{statusLabel}
				</button>
			</div>

			<div class="flex items-center justify-between gap-2 border-t border-stone-100 p-4 py-3">
				<div class="flex items-center gap-2">
					<div class="relative">
						<button
							type="button"
							class="inline-flex items-center gap-1 rounded-lg border border-stone-200 px-2 py-1 text-[10px] font-medium text-stone-900 transition"
							class:bg-stone-100={habitMode}
							onclick={toggleHabitMenu}
						>
							<span class="relative flex h-3 w-3 items-center justify-center">
								<svg
									xmlns="http://www.w3.org/2000/svg"
									viewBox="0 0 16 16"
									class="h-3 w-3 text-stone-700"
									fill="currentColor"
								>
									<path
										d="M11.534 7h3.932a.25.25 0 0 1 .192.41l-1.966 2.36a.25.25 0 0 1-.384 0l-1.966-2.36a.25.25 0 0 1 .192-.41m-11 2h3.932a.25.25 0 0 0 .192-.41L2.692 6.23a.25.25 0 0 0-.384 0L.342 8.59A.25.25 0 0 0 .534 9"
									/>
									<path
										fill-rule="evenodd"
										d="M8 3c-1.552 0-2.94.707-3.857 1.818a.5.5 0 1 1-.771-.636A6.002 6.002 0 0 1 13.917 7H12.9A5 5 0 0 0 8 3M3.1 9a5.002 5.002 0 0 0 8.757 2.182.5.5 0 1 1 .771.636A6.002 6.002 0 0 1 2.083 9z"
									/>
								</svg>
								{#if mode === 'normal'}
									<span
										class="absolute z-20 h-3 w-3 rounded-xs bg-stone-200 text-[8px] text-stone-500"
										in:fly={{ y: 6, duration: 200 }}
									>
										h
									</span>
								{/if}
							</span>
							Habit
						</button>
						{#if habitMenuOpen}
							<div
								class="absolute top-full left-0 z-20 mt-2 w-40 rounded-lg border border-stone-200 bg-white p-2 shadow-lg"
							>
								<div class="space-y-1">
									{#each HABIT_MENU_DAYS as day, index}
										<button
											type="button"
											class="flex w-full items-center justify-between rounded-md px-2 py-1 text-[11px] text-stone-700"
											class:bg-stone-100={habitMenuIndex === index}
											onclick={() => toggleHabitDay(day.value)}
											onmouseenter={() => (habitMenuIndex = index)}
										>
											<span>{day.label}</span>
											{#if day.value === -1 ? habitDays.length === HABIT_DAYS.length : habitDays.includes(day.value)}
												<span class="text-[10px] font-semibold text-stone-900">✓</span>
											{/if}
										</button>
									{/each}
								</div>
							</div>
						{/if}
					</div>
					<button
						type="button"
						class="inline-flex items-center gap-1 rounded-lg border border-stone-200 px-2 py-1 text-[10px] font-medium text-stone-900 transition"
					>
						<span class="flex h-3 w-3 items-center justify-center">
							<svg
								xmlns="http://www.w3.org/2000/svg"
								viewBox="0 0 16 16"
								class="h-2.5 w-2.5 text-stone-700"
								fill="currentColor"
								aria-hidden="true"
							>
								<path
									d="M2 2v13.5a.5.5 0 0 0 .74.439L8 13.069l5.26 2.87A.5.5 0 0 0 14 15.5V2a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2"
								/>
							</svg>
						</span>
						Event
					</button>
					<button
						type="button"
						class="inline-flex items-center gap-1 rounded-lg border border-stone-200 px-2 py-1 text-[10px] font-medium text-stone-900 transition"
					>
						<span class="flex h-3 w-3 items-center justify-center">
							<svg
								xmlns="http://www.w3.org/2000/svg"
								viewBox="0 0 16 16"
								class="h-3 w-3 text-stone-700"
								fill="currentColor"
								aria-hidden="true"
							>
								<path
									d="M16 8A8 8 0 1 1 0 8a8 8 0 0 1 16 0M8 4a.905.905 0 0 0-.9.995l.35 3.507a.552.552 0 0 0 1.1 0l.35-3.507A.905.905 0 0 0 8 4m.002 6a1 1 0 1 0 0 2 1 1 0 0 0 0-2"
								/>
							</svg>
						</span>
						Prio
					</button>
				</div>
				<button
					class="inline-flex items-center justify-center gap-2 rounded-lg border border-stone-200 bg-stone-900 px-2 py-1 text-xs font-medium text-white transition hover:bg-stone-800 focus-visible:ring-2 focus-visible:ring-stone-500 focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-60"
					onclick={handleSubmit}
				>
					{saving ? 'Saving…' : `Save `}
					<span class="text-stone-400">⌘ Enter</span>
				</button>
			</div>
		</div>
	</div>
{/if}

<style>
	select.no-chevron {
		-webkit-appearance: none;
		-moz-appearance: none;
		appearance: none;
		background-image: none;
	}
	select.no-chevron::-ms-expand {
		display: none;
	}
</style>
