import { browser } from '$app/environment';
import { readable, type Readable } from 'svelte/store';
import { supabase } from '$lib/supabaseClient';

export type PresenceSnapshot = {
	tabs: number;
	unique: number;
	connected: boolean;
};

type PresenceMeta = {
	user_id: string | null;
	room: string;
	ts: number;
};

/**
 * If Supabase Realtime is unavailable, a lightweight fallback is to have each tab POST a heartbeat
 * containing its sessionId + userId into Redis (e.g. `SETEX presence:{room}:{session} 10 payload`),
 * and then periodically aggregate counts by scanning keys per room. That preserves the same
 * semantics with minimal moving parts.
 */
export function usePresence(room: string, userId: string | null): Readable<PresenceSnapshot> {
	const normalizedRoom = room || '/';

	return readable<PresenceSnapshot>(
		{ tabs: 0, unique: 0, connected: false },
		(set) => {
			if (!browser || typeof window === 'undefined' || typeof crypto === 'undefined') {
				return () => {};
			}

			let disposed = false;
			const sessionId = crypto.randomUUID();
			const channel = supabase.channel(`presence:${normalizedRoom}`, {
				config: { presence: { key: sessionId } }
			});

			const handlePresenceSync = () => {
				const state = channel.presenceState<PresenceMeta>();
				let tabs = 0;
				const uniques = new Set<string>();

				for (const key in state) {
					const metas = state[key] ?? [];
					tabs += metas.length;
					for (const meta of metas) {
						if (meta?.user_id) {
							uniques.add(meta.user_id);
						}
					}
				}

				if (!disposed) {
					set({ tabs, unique: uniques.size, connected: true });
				}
			};

			channel.on('presence', { event: 'sync' }, handlePresenceSync);

			const payload: PresenceMeta = {
				user_id: userId,
				room: normalizedRoom,
				ts: Date.now()
			};

			channel.subscribe((status) => {
				if (status === 'SUBSCRIBED') {
					void channel.track(payload);
				}
			});

			const beforeUnloadHandler = () => {
				cleanup();
			};

			window.addEventListener('beforeunload', beforeUnloadHandler);

			function cleanup() {
				if (disposed) return;
				disposed = true;
				window.removeEventListener('beforeunload', beforeUnloadHandler);
				void channel.untrack();
				channel.unsubscribe();
				set({ tabs: 0, unique: 0, connected: false });
			}

			return cleanup;
		}
	);
}
