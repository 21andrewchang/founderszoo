<script lang="ts">
	import { fade, scale } from 'svelte/transition';

	let {
		open = false,
		onClose = () => {},
		username = null,
		usernameSaving = false,
		usernameError = null,
		onSaveUsername = () => {},
		onLogout = () => {}
	} = $props<{
		open?: boolean;
		onClose?: () => void;
		username?: string | null;
		usernameSaving?: boolean;
		usernameError?: string | null;
		onSaveUsername?: (next: string) => void;
		onLogout?: () => void;
	}>();

	let usernameDraft = $state('');

	$effect(() => {
		if (!open) return;
		usernameDraft = username ?? '';
	});

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
				<div class="space-y-2">
					<div class="text-sm font-semibold text-stone-900">Workspace username</div>
					<div class="text-xs text-stone-500">This controls your workspace URL.</div>
					<div class="flex items-center gap-2">
						<input
							type="text"
							class="w-full rounded-lg border border-stone-200 px-3 py-2 text-sm text-stone-900 outline-none focus:border-stone-400"
							placeholder="your-username"
							bind:value={usernameDraft}
							disabled={!username || usernameSaving}
						/>
						<button
							type="button"
							class="inline-flex items-center justify-center rounded-lg border border-stone-200 px-3 py-2 text-xs font-medium text-stone-700 transition hover:bg-stone-100 disabled:cursor-not-allowed disabled:opacity-50"
							disabled={!username || usernameSaving || usernameDraft.trim().length === 0}
							onclick={() => onSaveUsername(usernameDraft)}
						>
							{usernameSaving ? 'Saving...' : 'Save'}
						</button>
					</div>
					{#if !username}
						<div class="text-xs text-stone-400">Sign in to edit your username.</div>
					{:else if usernameError}
						<div class="text-xs text-rose-500">{usernameError}</div>
					{/if}
				</div>
			</div>
			<div class="flex items-center justify-end border-t border-stone-100 px-5 py-4">
				<button
					type="button"
					class="mr-auto inline-flex items-center justify-center rounded-lg border border-stone-200 px-3 py-1.5 text-xs font-medium text-rose-600 transition hover:bg-rose-50 focus-visible:ring-2 focus-visible:ring-rose-500 focus-visible:outline-none"
					onclick={onLogout}
				>
					Log out
				</button>
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
