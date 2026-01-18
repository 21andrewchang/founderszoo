<script lang="ts">
	import { fade, scale } from 'svelte/transition';

	let {
		open = false,
		onCancel = () => {},
		onConfirm = () => {},
		blockLabel = '',
		fromLabel = '',
		toLabel = '',
		destinationLabel = null,
		hasDestinationContent = false,
		isHabit = false,
		mode = 'move',
		loading = false
	} = $props<{
		open?: boolean;
		onCancel?: () => void;
		onConfirm?: () => void | Promise<void>;
		blockLabel?: string;
		fromLabel?: string;
		toLabel?: string;
		destinationLabel?: string | null;
		hasDestinationContent?: boolean;
		isHabit?: boolean;
		mode?: 'move' | 'swap' | 'delete';
		loading?: boolean;
	}>();

	const isSwap = $derived(mode === 'swap');
	const isDelete = $derived(mode === 'delete');
	const actionVerb = $derived(isDelete ? 'Delete' : isSwap ? 'Swap' : 'Move');
	const actionVerbIng = $derived(isDelete ? 'Deleting…' : isSwap ? 'Swapping…' : 'Moving…');
	const warningShouldRender = $derived(isDelete || hasDestinationContent || isHabit);
	const warningClasses = $derived(
		isDelete
			? 'border-rose-200 bg-rose-50 text-rose-900'
			: 'border-amber-200 bg-amber-50 text-amber-900'
	);

	function handleBackdropClick(event: MouseEvent) {
		if (event.target === event.currentTarget) onCancel();
	}
	function handleKeydown(event: KeyboardEvent) {
		if (open) {
			if (event.key === 'Escape') {
				event.stopPropagation();
				event.preventDefault();
				onCancel();
			}
			if (event.key === 'Enter') {
				event.stopPropagation();
				event.preventDefault();
				onConfirm();
			}
			if (event.key === 'y') {
				event.stopPropagation();
				onConfirm();
			}
			if (event.key === 'n') {
				event.preventDefault();
				event.stopPropagation();
				onCancel();
			}
		}
	}
</script>

<svelte:window on:keydown={handleKeydown} />
{#if open}
	<div
		in:fade={{ duration: 150 }}
		class="fixed inset-0 z-[130] flex items-center justify-center"
		role="dialog"
		aria-modal="true"
		aria-label={isDelete
			? 'Delete block confirmation'
			: isSwap
				? 'Swap blocks confirmation'
				: 'Move block confirmation'}
		tabindex="-1"
		onclick={handleBackdropClick}
		onkeydown={handleKeydown}
	>
		<div
			in:scale={{ start: 0.96, duration: 160 }}
			class="w-full max-w-md rounded-xl border border-stone-200 bg-white text-stone-800 shadow-[0_20px_45px_rgba(36,35,32,0.15)]"
		>
			<div class="space-y-3 px-5 py-5 text-sm text-stone-600">
				<div class="text-base font-semibold text-stone-900">
					{#if isDelete}
						Delete {isHabit ? 'habit' : 'block'}?
					{:else if isSwap}
						Swap blocks?
					{:else}
						Move {isHabit ? 'habit' : 'block'}?
					{/if}
				</div>
				{#if isDelete}
					<p>
						<span class="font-medium text-stone-900"
							>{blockLabel || (isHabit ? 'this habit' : 'this block')}</span
						>
						at <span class="font-medium text-stone-900">{fromLabel}</span>
					</p>
				{:else}
					<p>
						<span class="font-medium text-stone-900"
							>{blockLabel || (isHabit ? 'this habit' : 'this block')}</span
						>
						from <span class="font-medium text-stone-900">{fromLabel}</span> to
						<span class="font-medium text-stone-900">{toLabel}</span>?
					</p>
				{/if}
				{#if warningShouldRender}
					<div class={`rounded-lg border px-3 py-2 text-xs ${warningClasses}`}>
						{#if isDelete}
							This will permanently clear this block including progress and habits.
						{:else if hasDestinationContent}
							{#if isSwap}
								This will swap with
							{:else}
								This will replace
							{/if}
							{#if destinationLabel}
								<span class="font-medium">"{destinationLabel}"</span>
							{:else}
								the existing entry
							{/if}
							at <span class="font-medium">{toLabel}</span>.
						{:else if isHabit}
							This will clear the habit from <span class="font-medium">{fromLabel}</span>.
						{/if}
					</div>
				{/if}
			</div>
			<div class="flex items-center justify-end gap-2 border-t border-stone-100 px-5 py-4">
				<button
					type="button"
					class="inline-flex items-center justify-center gap-1 rounded-lg border border-stone-200 px-2 py-1.5 text-xs font-medium text-stone-700 transition hover:bg-stone-100 focus-visible:ring-2 focus-visible:ring-stone-500 focus-visible:outline-none"
					onclick={onCancel}
					disabled={loading}
				>
					Cancel
					<div class="h-4 w-4 items-center justify-center rounded-sm bg-stone-200 font-mono">n</div>
				</button>
				<button
					type="button"
					class="inline-flex items-center justify-center gap-1 rounded-lg border border-stone-200 bg-stone-900 px-2 py-1.5 text-xs text-white transition hover:bg-stone-800 focus-visible:ring-2 focus-visible:ring-stone-500 focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-60"
					onclick={() => {
						if (loading) return;
						onConfirm();
					}}
					disabled={loading}
				>
					{loading ? actionVerbIng : actionVerb}
					<div class="h-4 w-4 items-center justify-center rounded-sm bg-stone-700/70 font-mono">
						y
					</div>
				</button>
			</div>
		</div>
	</div>
{/if}
