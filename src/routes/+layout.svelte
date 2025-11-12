<script lang="ts">
	import { onMount, onDestroy, setContext } from 'svelte';
	import '../app.css';
	import { writable, type Writable } from 'svelte/store';
	import type { User } from '@supabase/supabase-js';
	import { supabase } from '$lib/supabaseClient';
	import AuthModal from '$lib/components/AuthModal.svelte';
	import favicon from '$lib/assets/favicon.svg';

	type Session = { user: User | null; name: string; loading: boolean };

	// Context store
	const session: Writable<Session> = writable({ user: null, name: '', loading: true });
	setContext('session', session);

	let authModalOpen = $state(false);

	const applyUser = (u: User | null) => {
		session.set({
			user: u,
			name: u?.user_metadata?.name ?? '',
			loading: false
		});
	};

	onMount(async () => {
		const { data } = await supabase.auth.getUser();
		applyUser(data.user ?? null);

		// keep store in sync with future sign-in/out
		const { data: sub } = supabase.auth.onAuthStateChange((_event, s) => {
			applyUser(s?.user ?? null);
		});
		onDestroy(() => sub.subscription.unsubscribe());
	});

	// Close modal if signed in
	$effect(() => {
		if ($session.user && authModalOpen) authModalOpen = false;
	});

	let { children } = $props();
</script>

<svelte:head>
	<link rel="icon" href={favicon} />
</svelte:head>

<div class="flex h-dvh w-full flex-col justify-center overflow-hidden bg-stone-50 text-stone-900">
	<div class="fixed top-2 left-2">
		{#if $session.loading}
			<div class="px-3 py-1 text-xs font-medium text-stone-50"></div>
		{:else if !$session.user}
			<button
				class="rounded-lg border border-stone-300 bg-stone-50 px-2 py-1 text-xs font-medium text-stone-800 transition hover:bg-stone-100"
				onclick={() => (authModalOpen = true)}
			>
				Sign in
			</button>
		{/if}
	</div>

	{@render children()}
</div>

<AuthModal open={authModalOpen} onClose={() => (authModalOpen = false)} />
