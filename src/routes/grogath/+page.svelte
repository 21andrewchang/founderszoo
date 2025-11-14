<script lang="ts">
	import { supabase } from '$lib/supabaseClient';
	import { fade, fly, scale } from 'svelte/transition';
	import { getContext, onMount, tick } from 'svelte';
	import type { Session } from '$lib/session';
	import type { Writable } from 'svelte/store';
	import { invalidateAll, invalidate, goto } from '$app/navigation';

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
	let passwordInput: HTMLInputElement | null = null;
	let email = $state('');
	let password = $state('');
	let loading = $state(false);
	let message = $state('');
	let messageType = $state<'error' | 'success' | ''>('');
	let showSuccessAnimation = $state(false);

	const TITLE = 'welcome back jittington';
	const HOLD_MS = 1200; // dwell after animations before navigating

	function focusPasswordInput() {
		if (!passwordInput) return;
		passwordInput.focus();
		passwordInput.select();
	}

	onMount(() => {
		// No hero selected yet; focus will be applied after selection.
		if (!session) return;
		const unsub = session.subscribe((value) => {
			if (!value.loading && value.user) {
				// already signed in
			}
		});
		return () => unsub();
	});

	async function selectHero(id: HeroId) {
		selectedHero = id;
		email = heroMap[id].email;
		message = '';
		messageType = '';

		// Wait for the input to mount, then focus/select it.
		await tick();
		focusPasswordInput();
	}

	function bgClasses(hero: Hero) {
		const alignClass = hero.alignment === 'left' ? 'left-0' : 'right-0';
		if (!selectedHero) return `${alignClass} w-1/2`;
		return selectedHero === hero.id
			? `${hero.alignment === 'left' ? 'left-0' : 'right-0'} w-full`
			: `${alignClass} w-0`;
	}

	function handleKeydown(event: KeyboardEvent) {
		if (event.key === 'h' || event.key === 'H') {
			selectHero('graves'); // left
		} else if (event.key === 'l' || event.key === 'L') {
			selectHero('cho'); // right
		}
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
			message = '';
			await runSuccessSequence();
		} catch (err) {
			console.error('sign in error', err);
			messageType = 'error';
			message = err instanceof Error ? err.message : 'Unable to sign in.';
		} finally {
			loading = false;
		}
	}

	async function runSuccessSequence() {
		if (showSuccessAnimation) return;
		showSuccessAnimation = true;

		// Beam/title animation lasts ~2000ms; fade overlaps 900ms. Add a short dwell.
		const total = 2000 + 900 + HOLD_MS;
		await new Promise((r) => setTimeout(r, total));
		goto('/');
	}
</script>

<svelte:window on:keyup={handleKeydown} />

<div
	class="relative flex min-h-dvh flex-col items-center justify-center overflow-hidden bg-stone-950 px-4 py-10 text-stone-50"
>
	<!-- Background heroes -->
	<div class="pointer-events-none absolute inset-0">
		{#each HEROES as hero}
			<div
				class={`absolute top-0 h-full bg-cover bg-[center_right_30%] opacity-40 transition-all duration-700 ease-out ${bgClasses(hero)}`}
				style={`background-image:url('${hero.image}'); transform-origin:${hero.alignment};`}
			></div>
		{/each}
	</div>

	<!-- Click-through hero selection zones -->
	<div class="absolute inset-0 flex">
		{#each HEROES as hero}
			<button
				type="button"
				class="flex-1 cursor-pointer bg-transparent transition duration-300 focus:outline-0"
				onclick={() => selectHero(hero.id)}
				aria-label={`Play as ${hero.label}`}
			/>
		{/each}
	</div>

	<!-- Card -->
	{#if !showSuccessAnimation}
		{#if selectedHero}
			<div
				class="relative z-10 w-full max-w-md rounded-xl border border-white/10 bg-white/10 p-2 text-stone-50 shadow-[0_25px_60px_rgba(15,15,15,0.45)] backdrop-blur"
				in:fly={{ y: 10, duration: 300, delay: 500 }}
			>
				<form class="space-y-4" onsubmit={handleSubmit}>
					<label class="block text-xs font-semibold text-stone-300">
						<input
							type="password"
							required
							minlength="6"
							class="mt-2 w-full rounded-xl border border-white/20 bg-white/10 px-4 py-3 text-sm text-white transition outline-none placeholder:text-stone-400 focus:outline-none"
							placeholder="••••••••••••••••••••••••••••••••"
							bind:value={password}
							bind:this={passwordInput}
							autocomplete="current-password"
						/>
					</label>
					{#if message}
						<p class="text-xs {messageType === 'error' ? 'text-rose-300' : 'text-emerald-300'}">
							{message}
						</p>
					{/if}
					<input type="submit" class="hidden" tabindex="-1" aria-hidden="true" />
				</form>
			</div>
		{/if}
	{/if}
</div>

{#if showSuccessAnimation}
	<div
		in:fade={{ duration: 500 }}
		class="fixed inset-0 z-[9999] flex items-center justify-center bg-black/70 backdrop-blur-sm"
		role="dialog"
		tabindex="-1"
		data-rank="platinum"
		aria-live="polite"
	>
		<div class="pointer-events-none relative z-10 w-full max-w-md text-center select-none">
			<div class="rank-beam" aria-hidden="true"></div>
			<div class="rank-title mb-16 font-mono text-lg tracking-widest uppercase">{TITLE}</div>
		</div>
	</div>
{/if}

<style>
	/* Reduced motion */
	@media (prefers-reduced-motion: reduce) {
		.rank-beam,
		.rank-title {
			animation: none !important;
			opacity: 1 !important;
			transform: none !important;
		}
	}

	/* Platinum tokens only */
	[data-rank='platinum'] {
		--rank-core-0: rgba(0, 0, 0, 0);
		--rank-core-1: rgba(167, 224, 255, 0);
		--rank-core-2: rgba(167, 224, 255, 0.92);
		--rank-core-3: rgba(167, 224, 255, 0);
		--rank-bloom-1: rgba(147, 197, 253, 0.08);
		--rank-bloom-2: rgba(147, 197, 253, 0.25);
		--rank-shadow-1: rgba(147, 197, 253, 0.75);
		--rank-shadow-2: rgba(147, 197, 253, 0.45);
		--rank-shadow-3: rgba(147, 197, 253, 0.25);
		--rank-title-glow-1: rgba(147, 197, 253, 0.55);
		--rank-title-glow-2: rgba(147, 197, 253, 0.35);
		--rank-title-color: #e6f6ff;
	}

	/* Beam line */
	.rank-beam {
		position: absolute;
		left: 50%;
		top: 50%;
		height: 1px;
		width: min(30vw, 900px);
		transform: translate(-50%, -50%) scaleX(0);
		transform-origin: 50% 50%;
		background: linear-gradient(
			90deg,
			var(--rank-core-0) 0%,
			var(--rank-core-1) 12%,
			var(--rank-core-2) 50%,
			var(--rank-core-3) 88%,
			var(--rank-core-0) 100%
		);
		box-shadow:
			0 0 12px var(--rank-shadow-1),
			0 0 28px var(--rank-shadow-2),
			0 0 60px var(--rank-shadow-3);
		filter: saturate(1.2);
		animation:
			beam-grow 2000ms cubic-bezier(0.15, 0.8, 0.2, 1) forwards,
			beam-fade 900ms 700ms ease-out forwards,
			beam-pulse 1200ms 700ms ease-in-out 2;
	}

	.rank-beam::before {
		content: '';
		position: absolute;
		inset: -14px 0;
		background: linear-gradient(
			90deg,
			transparent 0%,
			var(--rank-bloom-1) 20%,
			var(--rank-bloom-2) 50%,
			var(--rank-bloom-1) 80%,
			transparent 100%
		);
		filter: blur(12px);
		opacity: 0;
		animation: bloom-in 600ms 200ms ease-out forwards;
	}

	/* Title */
	.rank-title {
		position: relative;
		margin-top: 0.5rem;
		color: var(--rank-title-color);
		text-shadow:
			0 0 6px var(--rank-title-glow-1),
			0 0 18px var(--rank-title-glow-2);
		opacity: 0;
		transform: translateY(6px) scale(0.98);
		animation:
			title-in 2000ms 520ms cubic-bezier(0.12, 0.7, 0.2, 1) forwards,
			title-glow 1400ms 900ms ease-in-out 2;
	}

	/* Keyframes */
	@keyframes beam-grow {
		to {
			transform: translate(-50%, -50%) scaleX(1);
		}
	}
	@keyframes beam-fade {
		to {
			opacity: 0.35;
			box-shadow:
				0 0 8px rgba(147, 197, 253, 0.55),
				0 0 20px rgba(147, 197, 253, 0.28),
				0 0 36px rgba(147, 197, 253, 0.15);
		}
	}
	@keyframes beam-pulse {
		0%,
		100% {
			filter: brightness(1);
		}
		50% {
			filter: brightness(1.35);
		}
	}
	@keyframes bloom-in {
		to {
			opacity: 0.9;
		}
	}
	@keyframes title-in {
		to {
			opacity: 1;
			transform: translateY(0) scale(1);
		}
	}
	@keyframes title-glow {
		0%,
		100% {
			text-shadow:
				0 0 6px var(--rank-title-glow-1),
				0 0 14px var(--rank-title-glow-2);
		}
		50% {
			text-shadow:
				0 0 10px var(--rank-title-glow-1),
				0 0 26px var(--rank-title-glow-2);
		}
	}
</style>
