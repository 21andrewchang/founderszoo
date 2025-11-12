<script lang="ts">
	import { fade, fly, scale } from 'svelte/transition';

	const START = 8;
	const END = 23; // inclusive
	const HOURS = Array.from({ length: END - START + 1 }, (_, i) => START + i);
	const hh = (n: number) => n.toString().padStart(2, '0');

	let {
		open = false,
		onClose = () => {},
		onSave = () => {},
		initialHour = null,
		initialHalf = null
	} = $props<{
		open?: boolean;
		onClose?: () => void;
		onSave?: (
			text: string,
			todo: boolean | null,
			hour: number,
			half: 0 | 1,
			habit: boolean
		) => void;
		initialHour?: number | null;
		initialHalf?: 0 | 1 | null;
	}>();

	let text = $state('');
	let todo = $state<boolean | null>(null);
	let saving = $state(false);
	let inputEl: HTMLInputElement | null = $state(null);
	let makeHabit = $state(false);
	let hour = $state<number>((initialHour ?? currentSlot().hour) as number);
	let half = $state<0 | 1>((initialHalf ?? currentSlot().half) as 0 | 1);

	function handleBackdropClick(e: MouseEvent) {
		if (e.target === e.currentTarget) onClose();
	}
	function handleKeydown(e: KeyboardEvent) {
		if (e.key === 'Escape') {
			onClose();
			return;
		}
		if (e.key === 'Enter' && e.metaKey) {
			e.preventDefault();
			void handleSubmit();
		}
	}

	function currentSlot(): { hour: number; half: 0 | 1 } {
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
			await Promise.resolve(onSave(value, todo, hour, half, makeHabit));
			text = '';
			todo = null;
			makeHabit = false;
			onClose();
		} finally {
			saving = false;
		}
	}
	$effect(() => {
		if (open) queueMicrotask(() => inputEl?.focus());
	});

	$effect(() => {
		if (!open) return;
		const fallback = currentSlot();
		hour = (initialHour ?? fallback.hour) as number;
		half = (initialHalf ?? fallback.half) as 0 | 1;
		makeHabit = false;
	});

	function fillPreset(s: string) {
		text = s;
		queueMicrotask(() => inputEl?.focus());
	}
</script>

{#if open}
	<div
		in:fade={{ duration: 150 }}
		class="fixed inset-0 z-[120] flex items-center justify-center bg-stone-50/80"
		role="dialog"
		aria-modal="true"
		aria-label="New log"
		tabindex="-1"
		onclick={handleBackdropClick}
		onkeydown={handleKeydown}
	>
		<div
			in:scale={{ start: 0.95, duration: 160 }}
			class="w-full max-w-xl rounded-xl border border-stone-200 bg-white/95 text-stone-800 shadow-[0_12px_32px_rgba(15,15,15,0.12)]"
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
					bind:value={text}
					autocomplete="off"
				/>
				{#if todo === false}
					<div class="relative mr-5 grid h-3 w-3 rounded-full p-3">
						<span
							class="pointer-events-none absolute inset-0 rounded-full border border-[1px] border-stone-400 transition duration-200 ease-out"
						/>
					</div>
				{/if}
			</div>

			<div class="flex flex-row gap-1 px-4 pb-4">
				<button
					type="button"
					class="inline-flex items-center justify-center rounded-lg border border-stone-200 px-2 py-1 text-xs font-medium text-stone-900 transition"
					onclick={() => fillPreset('Read')}
				>
					Read
				</button>
				<button
					type="button"
					class="inline-flex items-center justify-center rounded-lg border border-stone-200 px-2 py-1 text-xs font-medium text-stone-900 transition"
					onclick={() => fillPreset('Meditate')}
				>
					Meditate
				</button>
				<button
					type="button"
					class="inline-flex items-center justify-center rounded-lg border border-stone-200 px-2 py-1 text-xs font-medium text-stone-900 transition"
					onclick={() => fillPreset('Gym')}
				>
					Gym
				</button>
			</div>
			<div class="flex items-center justify-between gap-2 border-t border-stone-100 p-4 py-3">
				<div class="flex flex-row items-center gap-2">
					<button
						class={`inline-flex items-center justify-center rounded-lg border border-stone-200 ${todo === null ? 'bg-stone-50 text-stone-900' : 'bg-stone-900 text-stone-50'} px-2 py-1 text-xs font-medium  transition  focus-visible:outline-none`}
						onclick={() => {
							if (todo === null) todo = false;
							else todo = null;
						}}
					>
						Todo
					</button>
					<button
						class={`inline-flex items-center justify-center rounded-lg border border-stone-200 ${makeHabit === false ? 'bg-stone-50 text-stone-900' : 'bg-stone-900 text-stone-50'} px-2 py-1 text-xs font-medium  transition  focus-visible:outline-none`}
						onclick={() => {
							makeHabit = !makeHabit;
							if (makeHabit) {
								todo = false;
							} else {
								todo = null;
							}
						}}
					>
						Habit
					</button>
				</div>
				<button
					class="inline-flex items-center justify-center rounded-lg border border-stone-200 bg-stone-900 px-2 py-1 text-xs font-medium text-white transition hover:bg-stone-800 focus-visible:ring-2 focus-visible:ring-stone-500 focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-60"
					onclick={handleSubmit}
				>
					{saving ? 'Saving…' : `Save ⌘+Enter`}
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
