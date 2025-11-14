<script lang="ts">
	import { browser } from '$app/environment';
	import { page } from '$app/stores';
	import { getContext, onDestroy } from 'svelte';
	import type { Writable } from 'svelte/store';
	import { usePresence, type PresenceSnapshot } from '$lib/presence';
	import type { Session } from '$lib/session';

	type Props = {
		room?: string;
		dedupe?: boolean;
	};

	let { room = undefined, dedupe = false }: Props = $props();

	const session = getContext<Writable<Session> | null>('session');

	let userId = $state<string | null>(null);
	const stopSession =
		session?.subscribe?.((value) => {
			userId = value.user?.id ?? null;
		}) ?? (() => {});

	let pathname = $state('/');

	$effect(() => {
		if (!browser) {
			pathname = '/';
			return;
		}

		const unsubscribe = page.subscribe(($page) => {
			pathname = $page.url.pathname;
		});

		return () => {
			unsubscribe();
		};
	});

	let counts = $state<PresenceSnapshot>({ tabs: 0, unique: 0, connected: false });

	$effect(() => {
		if (!browser) {
			counts = { tabs: 0, unique: 0, connected: false };
			return;
		}

		const resolvedRoom = room ?? pathname ?? '/';

		if (!resolvedRoom) {
			counts = { tabs: 0, unique: 0, connected: false };
			return;
		}

		const store = usePresence(resolvedRoom, userId);
		const unsubscribe = store.subscribe((value) => {
			counts = value;
		});

		return () => {
			unsubscribe();
		};
	});

	onDestroy(() => {
		stopSession?.();
	});

	const total = $derived(dedupe ? counts.unique : counts.tabs);
	const label = $derived(dedupe ? 'unique viewers' : 'tabs online');
</script>

<div class="group fixed top-4 right-6" aria-live="polite" aria-label="Live spectator count">
	<div class="flex flex-row items-center gap-1 text-sm text-red-400">
		<svg
			viewBox="0 0 24 24"
			fill="currentColor"
			stroke="currentColor"
			stroke-width="2"
			stroke-linecap="round"
			stroke-linejoin="round"
			shape-rendering="geometricPrecision"
			class="h-3 w-3 transition-colors duration-200"
		>
			<path d="M20 21.5v-2.5a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2.5h16" />
			<circle cx="12" cy="7" r="4" />
		</svg>
		{#if counts.connected}{total}{:else}--{/if}
	</div>

	<div
		role="tooltip"
		class="pointer-events-none absolute top-full right-0 mt-1 origin-top-right rounded-md bg-stone-700 px-2 py-1 text-[11px] font-medium whitespace-nowrap text-white opacity-0 shadow-lg transition-opacity duration-150 group-hover:opacity-100"
	>
		Live spectator count
	</div>
</div>
