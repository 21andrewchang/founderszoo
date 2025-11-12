<script lang="ts">
	import { fade, scale } from 'svelte/transition';
	import { supabase } from '$lib/supabaseClient';

	let { open = false, onClose = () => {} } = $props<{
		open?: boolean;
		onClose?: () => void;
	}>();

	let email = $state('');
	let password = $state('');
	let loading = $state(false);
	let message = $state('');
	let messageType = $state<'error' | 'success' | ''>('');

	function handleBackdropClick(e: MouseEvent) {
		if (e.target === e.currentTarget) {
			onClose();
		}
	}

	function handleKeydown(e: KeyboardEvent) {
		if (e.key === 'Escape') {
			onClose();
		}
	}

	async function handleSubmit(event: SubmitEvent) {
		event.preventDefault();
		if (loading) return;

		loading = true;
		message = '';
		messageType = '';

		try {
			const { error } = await supabase.auth.signInWithPassword({ email, password });
			if (error) {
				throw error;
			}

			messageType = 'success';
			message = 'Signed in successfully.';
			setTimeout(() => onClose(), 700);
		} catch (err) {
			console.error('Supabase sign-in error', err);
			messageType = 'error';
			message = err instanceof Error ? err.message : 'Unable to sign in.';
		} finally {
			loading = false;
		}
	}
</script>

{#if open}
	<div
		in:fade={{ duration: 200 }}
		class="fixed inset-0 z-[120] flex items-center justify-center bg-stone-50/80"
		role="dialog"
		aria-modal="true"
		aria-label="Sign in"
		tabindex="-1"
		onclick={handleBackdropClick}
		onkeydown={handleKeydown}
	>
		<div
			in:scale={{ start: 0.9, duration: 200 }}
			class="w-full max-w-sm rounded-2xl border border-stone-200 bg-white/95 p-5 text-stone-800 shadow-[0_12px_32px_rgba(15,15,15,0.12)]"
		>
			<form class="space-y-4" onsubmit={handleSubmit}>
				<label class="block text-xs font-medium text-stone-600">
					Email
					<input
						type="email"
						required
						class="mt-2 w-full rounded-xl border border-stone-200 bg-white px-4 py-3 text-sm text-stone-800 transition outline-none focus:border-stone-400 focus:ring-2 focus:ring-stone-200"
						placeholder="you@example.com"
						bind:value={email}
					/>
				</label>

				<label class="block text-xs font-medium text-stone-600">
					Password
					<input
						type="password"
						required
						minlength="6"
						class="mt-2 w-full rounded-xl border border-stone-200 bg-white px-4 py-3 text-sm text-stone-800 transition outline-none focus:border-stone-400 focus:ring-2 focus:ring-stone-200"
						placeholder="••••••••"
						bind:value={password}
					/>
				</label>

				<button
					type="submit"
					class="flex w-full items-center justify-center rounded-xl border border-stone-200 bg-stone-900 px-4 py-3 text-sm font-medium text-white transition hover:bg-stone-800 focus-visible:ring-2 focus-visible:ring-stone-500 focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-60"
					disabled={loading}
				>
					{#if loading}
						<span>Signing in…</span>
					{:else}
						<span>Sign in with email</span>
					{/if}
				</button>

				{#if message}
					<p class={`text-xs ${messageType === 'error' ? 'text-red-500' : 'text-green-600'}`}>
						{message}
					</p>
				{/if}
			</form>
		</div>
	</div>
{/if}
