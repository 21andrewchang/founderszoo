import { browser } from '$app/environment';
import { readable, type Readable } from 'svelte/store';
import { supabase } from '$lib/supabaseClient';

export type PlayerStatus = 'online' | 'away' | 'offline';

type PlayerPresenceMeta = {
	user_id: string;
	active: boolean;
	updated_at: number;
};

const presenceChannelName = (userId: string) => `presence:player:${userId}`;
const presenceKey = () =>
	typeof crypto !== 'undefined' && 'randomUUID' in crypto
		? crypto.randomUUID()
		: Math.random().toString(36).slice(2);

export function watchPlayerStatus(userId: string | null): Readable<PlayerStatus> {
	return readable<PlayerStatus>('offline', (set) => {
		if (!browser || !userId) {
			set('offline');
			return () => {};
		}

		const channel = supabase.channel(presenceChannelName(userId), {
			config: { presence: { key: presenceKey() } }
		});

		const handleSync = () => {
			const state = channel.presenceState<PlayerPresenceMeta>();
			const metas = Object.values(state).flatMap((value) => value ?? []);
			if (metas.length === 0) {
				set('offline');
				return;
			}
			if (metas.some((meta) => meta?.active)) {
				set('online');
				return;
			}
			set('away');
		};

		channel.on('presence', { event: 'sync' }, handleSync);

		channel.subscribe((status) => {
			if (status === 'SUBSCRIBED') {
				handleSync();
			}
		});

		return () => {
			channel.unsubscribe();
			set('offline');
		};
	});
}

export function trackPlayerPresence(userId: string | null): () => void {
	if (!browser || !userId) return () => {};

	const channel = supabase.channel(presenceChannelName(userId), {
		config: { presence: { key: presenceKey() } }
	});

	let subscribed = false;

	const broadcastState = () => {
		if (!subscribed) return;
		const active = document.visibilityState === 'visible';
		const payload: PlayerPresenceMeta = {
			user_id: userId,
			active,
			updated_at: Date.now()
		};
		void channel.track(payload);
	};

	channel.subscribe((status) => {
		if (status === 'SUBSCRIBED') {
			subscribed = true;
			broadcastState();
		}
	});

	const handleVisibility = () => broadcastState();
	const handleBeforeUnload = () => cleanup();

	document.addEventListener('visibilitychange', handleVisibility);
	window.addEventListener('focus', handleVisibility);
	window.addEventListener('blur', handleVisibility);
	window.addEventListener('beforeunload', handleBeforeUnload);

	function cleanup() {
		document.removeEventListener('visibilitychange', handleVisibility);
		window.removeEventListener('focus', handleVisibility);
		window.removeEventListener('blur', handleVisibility);
		window.removeEventListener('beforeunload', handleBeforeUnload);
		if (!subscribed) {
			channel.unsubscribe();
			return;
		}
		subscribed = false;
		void channel.untrack();
		channel.unsubscribe();
	}

	return cleanup;
}
