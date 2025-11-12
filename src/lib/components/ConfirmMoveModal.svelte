<script lang="ts">
	import { fade, scale } from 'svelte/transition';

	let {
		open = false,
		onCancel = () => {},
		onConfirm = () => {},
		slotLabel = '',
		fromLabel = '',
		toLabel = '',
		destinationLabel = null,
		hasDestinationContent = false,
		isHabit = false,
		loading = false
	} = $props<{
		open?: boolean;
		onCancel?: () => void;
		onConfirm?: () => void | Promise<void>;
		slotLabel?: string;
		fromLabel?: string;
		toLabel?: string;
		destinationLabel?: string | null;
		hasDestinationContent?: boolean;
		isHabit?: boolean;
		loading?: boolean;
	}>();

	function handleBackdropClick(event: MouseEvent) {
		if (event.target === event.currentTarget) onCancel();
	}
	function handleKeydown(event: KeyboardEvent) {
		if (event.key === 'Escape') {
			event.stopPropagation();
			onCancel();
		}
		if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
			event.preventDefault();
			if (!loading) onConfirm();
		}
	}
</script>

{#if open}
	<div
		in:fade={{ duration: 150 }}
		class="fixed inset-0 z-[130] flex items-center justify-center bg-stone-900/30 backdrop-blur-sm"
		role="dialog"
		aria-modal="true"
		aria-label="Move slot confirmation"
		tabindex="-1"
		onclick={handleBackdropClick}
		onkeydown={handleKeydown}
	>
		<div
			in:scale={{ start: 0.96, duration: 160 }}
			class="w-full max-w-md rounded-xl border border-stone-200 bg-white/95 text-stone-800 shadow-[0_20px_45px_rgba(36,35,32,0.15)]"
		>
			<div class="space-y-3 px-5 py-5 text-sm text-stone-600">
				<div class="text-base font-semibold text-stone-900">Move {isHabit ? 'habit' : 'slot'}?</div>
				<p>
					Are you sure you want to move
					<span class="font-medium text-stone-900">{slotLabel || (isHabit ? 'this habit' : 'this slot')}</span>
					from <span class="font-medium text-stone-900">{fromLabel}</span> to
					<span class="font-medium text-stone-900">{toLabel}</span>?
				</p>
				{#if hasDestinationContent}
					<div class="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
						This will replace
						{#if destinationLabel}
							<span class="font-medium">"{destinationLabel}"</span>
						{:else}
							the existing entry
						{/if}
						at <span class="font-medium">{toLabel}</span>.
					</div>
				{/if}
			</div>
			<div class="flex items-center justify-end gap-2 border-t border-stone-100 px-5 py-4">
				<button
					type="button"
					class="inline-flex items-center justify-center rounded-lg border border-stone-200 px-3 py-1.5 text-xs font-medium text-stone-700 transition hover:bg-stone-100 focus-visible:ring-2 focus-visible:ring-stone-500 focus-visible:outline-none"
					onclick={onCancel}
					disabled={loading}
				>
					Cancel
				</button>
				<button
					type="button"
					class="inline-flex items-center justify-center rounded-lg border border-stone-200 bg-stone-900 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-stone-800 focus-visible:ring-2 focus-visible:ring-stone-500 focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-60"
					onclick={() => {
						if (loading) return;
						onConfirm();
					}}
					disabled={loading}
				>
					{loading ? 'Moving…' : 'Move'}
				</button>
			</div>
		</div>
	</div>
{/if}
