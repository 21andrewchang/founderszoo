<script lang="ts">
	import { fade, scale } from 'svelte/transition';

	let {
		open = false,
		onClose = () => {},
		singlePlayerMode = false,
		singlePlayerDisabled = false,
		onToggleSinglePlayer = () => {}
	} = $props<{
		open?: boolean;
		onClose?: () => void;
		singlePlayerMode?: boolean;
		singlePlayerDisabled?: boolean;
		onToggleSinglePlayer?: (next: boolean) => void;
	}>();

	function handleBackdropClick(event: MouseEvent) {
		if (event.target === event.currentTarget) onClose();
	}

	function handleKeydown(event: KeyboardEvent) {
		if (!open) return;
		if (event.key === 'Escape') {
			event.preventDefault();
			event.stopPropagation();
			onClose();
		}
	}
</script>

<svelte:window on:keydown={handleKeydown} />

{#if open}
	<div
		in:fade={{ duration: 150 }}
		class="fixed inset-0 z-[120] flex items-center justify-center bg-black/70"
		role="dialog"
		aria-modal="true"
		aria-label="Settings"
		onclick={handleBackdropClick}
	>
		<div
			in:scale={{ start: 0.96, duration: 160 }}
			class="w-full max-w-md rounded-xl border border-stone-200 bg-white text-stone-800 shadow-[0_20px_45px_rgba(36,35,32,0.15)]"
			onclick={(event) => event.stopPropagation()}
		>
			<div class="space-y-4 px-5 py-5 text-sm text-stone-600">
				<div class="text-base font-semibold text-stone-900">Settings</div>
				<div class="flex items-center justify-between gap-4">
					<div class="space-y-1">
						<div class="text-sm font-semibold text-stone-900">Single player mode</div>
						<div class="text-xs text-stone-500">
							Show only your grid and keep the right side empty.
						</div>
					</div>
					<label class="flex items-center gap-2 text-xs font-medium text-stone-600">
						<input
							type="checkbox"
							class="h-4 w-4 rounded border-stone-300 text-stone-900 focus:ring-stone-500"
							checked={singlePlayerMode}
							disabled={singlePlayerDisabled}
							onchange={(event) =>
								onToggleSinglePlayer((event.currentTarget as HTMLInputElement).checked)}
						/>
						<span>{singlePlayerMode ? 'On' : 'Off'}</span>
					</label>
				</div>
				{#if singlePlayerDisabled}
					<div class="text-xs text-stone-400">Sign in to enable single player mode.</div>
				{/if}
			</div>
			<div class="flex items-center justify-end border-t border-stone-100 px-5 py-4">
				<button
					type="button"
					class="inline-flex items-center justify-center rounded-lg border border-stone-200 px-3 py-1.5 text-xs font-medium text-stone-700 transition hover:bg-stone-100 focus-visible:ring-2 focus-visible:ring-stone-500 focus-visible:outline-none"
					onclick={onClose}
				>
					Done
				</button>
			</div>
		</div>
	</div>
{/if}
