<script lang="ts">
	import { goto } from '$app/navigation';
	import { supabase } from '$lib/supabaseClient';
	import type { Session } from '$lib/session';
	import { getContext, onMount } from 'svelte';
	import type { Writable } from 'svelte/store';

	const session = getContext<Writable<Session>>('session');

	onMount(async () => {
		try {
			await supabase.auth.signOut();
		} catch (error) {
			console.error('Failed to log out', error);
		}

		session.set({ user: null, name: '', loading: false });
		await goto('/');
	});
</script>

<div class="flex h-dvh w-full items-center justify-center bg-stone-50 text-stone-500">
	Logging you out…
</div>
