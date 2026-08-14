<script lang="ts">
	import { supabase } from '$lib/supabaseClient';
	import { goto } from '$app/navigation';
	import { getContext } from 'svelte';
	import type { Session } from '$lib/session';
	import type { Writable } from 'svelte/store';

	const session = getContext<Writable<Session>>('session');

	let email = $state('');
	let password = $state('');
	let loading = $state(false);
	let errorMessage = $state('');

	async function handleSubmit(event: SubmitEvent) {
		event.preventDefault();
		if (loading) return;
		loading = true;
		errorMessage = '';
		try {
			const { data, error } = await supabase.auth.signInWithPassword({ email, password });
			if (error) throw error;
			const user = data.user ?? null;
			if (session && user) {
				session.set({
					user,
					name: user.user_metadata?.name ?? '',
					loading: false
				});
			}
			goto('/');
		} catch (err) {
			console.error('sign in error', err);
			errorMessage = err instanceof Error ? err.message : 'Unable to sign in.';
		} finally {
			loading = false;
		}
	}
</script>

<div class="flex min-h-dvh flex-col items-center justify-center bg-white px-4">
	<div class="w-full max-w-lg">
		<form class="flex flex-col gap-5" onsubmit={handleSubmit}>
			<input
				type="email"
				required
				bind:value={email}
				placeholder="jane@company.com"
				class="w-full rounded-xl border border-stone-200 px-4 py-3 text-stone-900 placeholder-stone-400 focus:border-stone-400 focus:outline-none"
			/>

			<input
				type="password"
				required
				bind:value={password}
				placeholder="••••••••"
				class="w-full rounded-xl border border-stone-200 px-4 py-3 text-stone-900 placeholder-stone-400 focus:border-stone-400 focus:outline-none"
			/>

			{#if errorMessage}
				<p class="text-sm text-rose-600">{errorMessage}</p>
			{/if}

			<button
				type="submit"
				disabled={loading}
				class="mt-2 flex cursor-pointer items-center justify-center gap-3 self-end text-2xl text-stone-400 transition-colors duration-200 ease-out hover:text-stone-700 disabled:opacity-60"
				style="font-family: 'Cormorant Garamond', serif"
			>
				Enter
				<svg viewBox="0 0 16 16" fill="currentColor" class="h-4 w-4" aria-hidden="true">
					<path
						fill-rule="evenodd"
						d="M14.5 1.5a.5.5 0 0 1 .5.5v4.8a2.5 2.5 0 0 1-2.5 2.5H2.707l3.347 3.346a.5.5 0 0 1-.708.708l-4.2-4.2a.5.5 0 0 1 0-.708l4-4a.5.5 0 1 1 .708.708L2.707 8.3H12.5A1.5 1.5 0 0 0 14 6.8V2a.5.5 0 0 1 .5-.5"
					/>
				</svg>
			</button>
		</form>
	</div>
</div>
