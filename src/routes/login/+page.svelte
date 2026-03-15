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
		<div class="text-center">
			<div
				class="flex h-10 items-center justify-center text-2xl text-stone-700 uppercase"
				style="font-family: 'Cormorant Garamond', serif"
			>
				founderszoo
			</div>
		</div>

		<form class="space-y-6" onsubmit={handleSubmit}>
			<label class="block space-y-2 text-sm text-stone-600">
				<span>Email</span>
				<input
					type="email"
					required
					class="w-full rounded-2xl border border-stone-200 px-4 py-3 text-base text-stone-900 transition outline-none focus:border-stone-400"
					placeholder="jane@company.com"
					bind:value={email}
					autocomplete="email"
				/>
			</label>
			<label class="block space-y-2 text-sm text-stone-600">
				<span>Password</span>
				<input
					type="password"
					required
					class="w-full rounded-2xl border border-stone-200 px-4 py-3 text-base text-stone-900 transition outline-none focus:border-stone-400"
					placeholder="••••••••"
					bind:value={password}
					autocomplete="current-password"
				/>
			</label>

			{#if message}
				<p class={`text-sm ${messageType === 'error' ? 'text-rose-500' : 'text-emerald-600'}`}>
					{message}
				</p>
			{/if}

			<button
				type="submit"
				class="h-12 w-full rounded-2xl bg-stone-900 text-sm font-medium text-white transition hover:bg-stone-800 disabled:cursor-not-allowed disabled:opacity-70"
				disabled={loading}
			>
				{loading ? 'Logging in...' : 'Log in'}
			</button>
		</form>
	</div>
</div>
