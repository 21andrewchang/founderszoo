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

<div class="online-count" aria-live="polite">
	<div class="online-count__value">
		{#if counts.connected}
			{total}
		{:else}
			--
		{/if}
	</div>
	<div class="online-count__label">
		{#if counts.connected}
			{label}
		{:else}
			connecting…
		{/if}
	</div>
</div>

<style>
	.online-count {
		position: fixed;
		top: 1rem;
		right: 1rem;
		background: rgba(15, 23, 42, 0.92);
		color: #f8fafc;
		padding: 0.75rem 1rem;
		border-radius: 0.75rem;
		box-shadow: 0 10px 30px rgba(15, 23, 42, 0.35);
		min-width: 120px;
		text-align: right;
		font-family:
			'Instrument Sans',
			system-ui,
			-apple-system,
			BlinkMacSystemFont,
			'Segoe UI',
			sans-serif;
		z-index: 999;
		pointer-events: none;
	}

	.online-count__value {
		font-size: 1.75rem;
		font-weight: 600;
		line-height: 1;
	}

	.online-count__label {
		font-size: 0.75rem;
		text-transform: uppercase;
		letter-spacing: 0.08em;
		opacity: 0.8;
		margin-top: 0.1rem;
	}
</style>
