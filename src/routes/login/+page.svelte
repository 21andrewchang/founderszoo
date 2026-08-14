<script lang="ts">
	import { supabase } from '$lib/supabaseClient';
	import { goto } from '$app/navigation';

	let email = $state('');
	let password = $state('');
	let loading = $state(false);
	let message = $state('');
	let messageType = $state<'error' | 'success' | ''>('');

	async function handleSubmit(event: SubmitEvent) {
		event.preventDefault();
		if (loading) return;
		loading = true;
		message = '';
		messageType = '';
		try {
			const { data, error } = await supabase.auth.signInWithPassword({ email, password });
			if (error) throw error;
			const user = data.user ?? null;
			if (!user) {
				messageType = 'error';
				message = 'Unable to sign in.';
				return;
			}
			const { data: userRow } = await supabase
				.from('users')
				.select('username')
				.eq('id', user.id)
				.maybeSingle();
			if (userRow?.username) {
				await goto(`/${userRow.username}`);
				return;
			}
			await goto('/');
		} catch (err) {
			messageType = 'error';
			message = err instanceof Error ? err.message : 'Unable to sign in.';
		} finally {
			loading = false;
		}
	}
</script>

<div class="flex min-h-dvh items-center justify-center bg-white px-6 py-10">
	<div class="w-full max-w-md">
		<form class="flex flex-col gap-5" onsubmit={handleSubmit}>
			<input
				type="email"
				required
				bind:value={email}
				placeholder="jane@company.com"
				autocomplete="email"
				class="w-full rounded-xl border border-stone-200 px-4 py-3 text-stone-900 placeholder-stone-400 transition outline-none focus:border-stone-400"
			/>

			<input
				type="password"
				required
				bind:value={password}
				placeholder="••••••••"
				autocomplete="current-password"
				class="w-full rounded-xl border border-stone-200 px-4 py-3 text-stone-900 placeholder-stone-400 transition outline-none focus:border-stone-400"
			/>

			{#if message}
				<p class={`text-sm ${messageType === 'error' ? 'text-rose-500' : 'text-emerald-600'}`}>
					{message}
				</p>
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
