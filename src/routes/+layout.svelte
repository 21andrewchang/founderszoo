<script lang="ts">
	import { onMount, setContext } from 'svelte';
	import '../app.css';
	import OnlineCount from '$lib/components/OnlineCount.svelte';
	import { writable, type Writable } from 'svelte/store';
	import { supabase } from '$lib/supabaseClient';
	import favicon from '$lib/assets/favicon.svg';
	import type { Session } from '$lib/session';
	import type { User } from '@supabase/supabase-js';

	const session: Writable<Session> = writable({ user: null, name: '', loading: true });
	setContext('session', session);

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
	});

	let { children } = $props();
</script>

<svelte:head>
	<link rel="icon" href={favicon} />
</svelte:head>

<OnlineCount dedupe={true} />
{@render children()}
