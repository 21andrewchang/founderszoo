<script lang="ts">
	import { supabase } from '$lib/supabaseClient';
	import { getContext, onMount } from 'svelte';
	import type { Session } from '$lib/session';
	import type { Writable } from 'svelte/store';
	import { goto } from '$app/navigation';

	type HeroId = 'graves' | 'cho';
	type Hero = {
		id: HeroId;
		label: string;
		email: string;
		image: string;
		alignment: 'left' | 'right';
	};

	const HEROES: Hero[] = [
		{
			id: 'graves',
			label: 'Andrew • Graves',
			email: '21andrewch@gmail.com',
			image: '/graves.jpg',
			alignment: 'left'
		},
		{
			id: 'cho',
			label: "Nico • Cho'gath",
			email: 'nicoluo@gmail.com',
			image: '/toycho.jpg',
			alignment: 'right'
		}
	];

	const heroMap = Object.fromEntries(HEROES.map((h) => [h.id, h])) as Record<HeroId, Hero>;

	const session = getContext<Writable<Session>>('session');

	let selectedHero = $state<HeroId | null>(null);
	let email = $state('');
	let password = $state('');
	let loading = $state(false);
	let message = $state('');
	let messageType = $state<'error' | 'success' | ''>('');

	onMount(() => {
		if (!session) return;
		const unsub = session.subscribe((value) => {
			if (!value.loading && value.user) {
				// void goto('/');
			}
		});
		return () => unsub();
	});

	function selectHero(id: HeroId) {
		selectedHero = id;
		email = heroMap[id].email;
		message = '';
		messageType = '';
	}

	function bgClasses(hero: Hero) {
		const alignClass = hero.alignment === 'left' ? 'left-0' : 'right-0';
		if (!selectedHero) return `${alignClass} w-1/2`;
		return selectedHero === hero.id
			? `${hero.alignment === 'left' ? 'left-0' : 'right-0'} w-full`
			: `${alignClass} w-0`;
	}

	async function handleSubmit(event: SubmitEvent) {
		event.preventDefault();
		if (loading) return;
		if (!selectedHero || !email) {
			messageType = 'error';
			message = 'Pick Graves or Cho to continue.';
			return;
		}
		loading = true;
		message = '';
		messageType = '';
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
			messageType = 'success';
			message = 'Locked in. Redirecting…';
			setTimeout(() => void goto('/'), 600);
		} catch (err) {
			console.error('sign in error', err);
			messageType = 'error';
			message = err instanceof Error ? err.message : 'Unable to sign in.';
		} finally {
			loading = false;
		}
	}
</script>

<div
	class="relative flex min-h-dvh flex-col items-center justify-center overflow-hidden bg-stone-950 px-4 py-10 text-stone-50"
>
	<div class="pointer-events-none absolute inset-0">
		{#each HEROES as hero}
			<div
				class={`absolute top-0 h-full bg-cover bg-[center_right_30%] opacity-40 transition-all duration-700 ease-out ${bgClasses(hero)}`}
				style={`background-image:url('${hero.image}'); transform-origin:${hero.alignment};`}
			></div>
		{/each}
	</div>
	<div class="absolute inset-0 flex">
		{#each HEROES as hero}
			<button
				type="button"
				class={`flex-1 cursor-pointer bg-transparent transition duration-300 focus:outline-0`}
				onclick={() => selectHero(hero.id)}
				aria-label={`Play as ${hero.label}`}
			></button>
		{/each}
	</div>
	<div
		class="relative z-10 w-full max-w-md rounded-2xl border border-white/10 bg-white/10 p-6 text-stone-50 shadow-[0_25px_60px_rgba(15,15,15,0.45)] backdrop-blur"
	>
		<form class="space-y-4" onsubmit={handleSubmit}>
			<label class="block text-xs font-semibold text-stone-300">
				<input
					type="password"
					required
					minlength="6"
					class="mt-2 w-full rounded-xl border border-white/20 bg-white/10 px-4 py-3 text-sm text-white transition outline-none placeholder:text-stone-400 focus:outline-none"
					placeholder="••••••••"
					bind:value={password}
				/>
			</label>

			<button
				type="submit"
				class="flex w-full items-center justify-center rounded-xl bg-stone-900 px-4 py-3 text-sm font-semibold text-stone-50 transition focus-visible:outline-none"
			>
				{#if loading}
					its time…
				{:else}
					lock in
				{/if}
			</button>
		</form>
	</div>
</div>
