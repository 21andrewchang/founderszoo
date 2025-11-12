<script lang="ts">
	import { fade, scale } from 'svelte/transition';

	let {
		open = false,
		onClose = () => {},
		onSave = () => {}
	} = $props<{
		open?: boolean;
		onClose?: () => void;
		onSave?: (text: string) => void;
	}>();

	let text = $state('');
	let saving = $state(false);
	let inputEl: HTMLInputElement | null = $state(null);

	function handleBackdropClick(e: MouseEvent) {
		if (e.target === e.currentTarget) onClose();
	}
	function handleKeydown(e: KeyboardEvent) {
		if (e.key === 'Escape') onClose();
	}

	function currentSlot(): { hour: number; half: 0 | 1 } {
		const now = new Date();
		const hour = now.getHours();
		const half = (now.getMinutes() < 30 ? 0 : 1) as 0 | 1;
		return { hour, half };
	}

	async function handleSubmit(e: SubmitEvent) {
		e.preventDefault();
		const value = text.trim();
		if (!value || saving) return;
		saving = true;
		try {
			const { hour, half } = currentSlot();
			onSave({ text: value, hour, half });
			text = '';
			onClose();
		} finally {
			saving = false;
		}
	}

	// autofocus when opened
	$effect(() => {
		if (open) queueMicrotask(() => inputEl?.focus());
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
			class="w-full max-w-lg rounded-2xl border border-stone-200 bg-white/95 p-5 text-stone-800 shadow-[0_12px_32px_rgba(15,15,15,0.12)]"
		>
			<form class="space-y-4" onsubmit={handleSubmit}>
				<label class="block text-xs font-medium text-stone-600">
					Log
					<input
						bind:this={inputEl}
						type="text"
						placeholder="what are you doing?"
						class="mt-2 w-full rounded-lg border border-stone-200 bg-white px-4 py-3 text-sm text-stone-800 transition outline-none"
						bind:value={text}
						autocomplete="off"
					/>
				</label>

				<div class="flex items-center justify-between gap-2">
					<div class="flex flex-row gap-1">
						<button
							type="button"
							class="inline-flex items-center justify-center rounded-lg border border-stone-200 bg-stone-900 px-2 py-1 text-xs font-medium text-white transition hover:bg-stone-800"
							onclick={() => fillPreset('Read')}
						>
							Read
						</button>
						<button
							type="button"
							class="inline-flex items-center justify-center rounded-lg border border-stone-200 bg-stone-900 px-2 py-1 text-xs font-medium text-white transition hover:bg-stone-800"
							onclick={() => fillPreset('Rise')}
						>
							Rise
						</button>
						<button
							type="button"
							class="inline-flex items-center justify-center rounded-lg border border-stone-200 bg-stone-900 px-2 py-1 text-xs font-medium text-white transition hover:bg-stone-800"
							onclick={() => fillPreset('Gym')}
						>
							Gym
						</button>
					</div>

					<button
						type="submit"
						class="inline-flex items-center justify-center rounded-lg border border-stone-200 bg-stone-900 px-2 py-1 text-xs font-medium text-white transition hover:bg-stone-800 focus-visible:ring-2 focus-visible:ring-stone-500 focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-60"
						disabled={!text.trim() || saving}
					>
						{saving ? 'Saving…' : 'Save log'}
					</button>
				</div>
			</form>
		</div>
	</div>
{/if}
