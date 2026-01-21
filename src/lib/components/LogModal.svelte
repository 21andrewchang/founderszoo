<script lang="ts">
	import { fade, fly, scale } from 'svelte/transition';
	import type { PlayerStreak } from '$lib/streaks';

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
		habitStreaks = null,
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
			category: BlockCategory | null
		) => void;
		initialHour?: number | null;
		initialHalf?: 0 | 1 | null;
		initialTitle?: string | null;
		initialStatus?: boolean | null;
		initialCategory?: BlockCategory | null;
		habitStreaks?: Record<string, PlayerStreak | null> | null;
		maxBlockCountFor?: ((hour: number, half: 0 | 1) => number) | null;
		runLengthFor?: ((hour: number, half: 0 | 1) => number) | null;
	}>();

	type ModalMode = 'insert' | 'normal';

	const HABIT_KEYS = ['read', 'bored', 'gym'] as const;
	type HabitKey = (typeof HABIT_KEYS)[number];

	type BlockCategory = 'body' | 'social' | 'work' | 'admin';
	type CategoryPreset = {
		label: string;
		value: BlockCategory;
		key: string;
	};

	const CATEGORY_PRESETS: CategoryPreset[] = [
		{ label: 'Body', value: 'body', key: '1' },
		{ label: 'Social', value: 'social', key: '2' },
		{ label: 'Work', value: 'work', key: '3' },
		{ label: 'Admin', value: 'admin', key: '4' }
	];

	const streakArrowClassFor = (key: HabitKey) => {
		const streak = habitStreaks?.[key] ?? null;
		const base = 'h-2 w-2 transition-transform';
		if (!streak) return `${base} text-stone-400`;
		const color = streak.kind === 'positive' ? 'text-emerald-500' : 'text-rose-500';
		const rotation = streak.kind === 'positive' ? '' : 'rotate-180';
		return `${base} ${color} ${rotation}`;
	};

	let text = $state('');
	let status = $state<boolean | null>(null);
	let category = $state<BlockCategory | null>(null);
	let blockCount = $state(1);
	let isNewBlock = $state(true);
	let runLength = $state(1);
	const statusLabel = $derived(
		status === true ? 'Completed' : status === false ? 'In progress' : 'Planned'
	);
	const displayedBlockCount = $derived(isNewBlock ? blockCount : runLength);
	const blockCountDisabled = $derived(!isNewBlock);
	let saving = $state(false);
	let inputEl: HTMLInputElement | null = $state(null);
	let modalEl: HTMLDivElement | null = $state(null);
	let hour = $state<number>((initialHour ?? currentBlock().hour) as number);
	let half = $state<0 | 1>((initialHalf ?? currentBlock().half) as 0 | 1);
	let mode = $state<ModalMode>(normal ? 'normal' : 'insert');

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

	function cycleStatus() {
		status = status === null ? false : status === false ? true : null;
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

		if (mode === 'normal' && key === 't') {
			e.preventDefault();
			cycleBlockCount();
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
			await Promise.resolve(onSave(value, status, hour, half, saveCount, category));
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
		if (!open) return;
		const fallback = currentBlock();
		hour = (initialHour ?? fallback.hour) as number;
		half = (initialHalf ?? fallback.half) as 0 | 1;
		text = initialTitle ?? '';
		status = initialStatus ?? null;
		category = initialCategory ?? null;
		isNewBlock = (initialTitle ?? '').trim().length === 0;
		runLength = !isNewBlock && runLengthFor ? runLengthFor(hour, half) : 1;
		blockCount = isNewBlock ? 1 : runLength;
	});

	$effect(() => {
		if (!open || isNewBlock) return;
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

	function selectCategory(next: BlockCategory) {
		category = category === next ? null : next;
		queueMicrotask(() => inputEl?.focus());
	}
</script>

{#if open}
	<div
		bind:this={modalEl}
		in:fade={{ duration: 150 }}
		class="fixed inset-0 z-[130] flex items-center justify-center focus:ring-0 focus:outline-0"
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
						<span class="relative flex h-3 w-3 items-center justify-center text-stone-600">
							{#if p.value === 'social'}
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
						<span class="h-2 w-2 rounded-full border border-stone-400" />
						{#if mode === 'normal' && !blockCountDisabled}
							<span
								class="absolute h-3 w-3 rounded-xs bg-stone-200 text-[8px] text-stone-500"
								in:fly={{ y: 6, duration: 200 }}
							>
								t
							</span>
						{/if}
					</span>
					{displayedBlockCount} block{displayedBlockCount === 1 ? '' : 's'}
				</button>
				<button
					type="button"
					class="inline-flex items-center justify-center gap-1 rounded-lg border border-stone-200 px-2 py-1 text-[10px] font-medium text-stone-900 transition"
					onclick={cycleStatus}
				>
					<span class="relative flex h-3 w-3 items-center justify-center">
						{#if status === true}
							<span class="absolute inset-0 rounded-full bg-stone-800" />
							<svg viewBox="0 0 24 24" class="relative z-10 h-2.5 w-2.5 text-stone-50" fill="none">
								<path
									d="M7 12.5 L10.25 15.75 L16.75 9.25"
									stroke="currentColor"
									stroke-width="2"
									stroke-linecap="round"
									stroke-linejoin="round"
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
									class:status-ring-dashed={status === null}
									class:status-ring-solid={status === false}
								/>
							</svg>
						{/if}
					</span>
					{statusLabel}
				</button>
			</div>

			<div class="flex items-center justify-end gap-2 border-t border-stone-100 p-4 py-3">
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

	.status-ring-dashed {
		stroke-dasharray: 3 3;
	}

	.status-ring-solid {
		stroke-dasharray: 0;
	}
</style>
