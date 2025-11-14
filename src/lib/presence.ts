// $lib/presence.ts
import { browser } from '$app/environment';
import { readable, type Readable } from 'svelte/store';
import { supabase } from '$lib/supabaseClient';

export type PresenceSnapshot = { tabs: number; unique: number; connected: boolean };
type PresenceMeta = { user_id: string | null; room: string; ts: number };

const GLOBAL_ROOM = '__global__';
const SESSION_KEY = 'presence_session_id';

// --- singleton state (per tab) ---
let globalChannel: ReturnType<typeof supabase.channel> | null = null;
let globalConnected = false;
let globalSnapshot: PresenceSnapshot = { tabs: 0, unique: 0, connected: false };
const subscribers = new Set<(v: PresenceSnapshot) => void>();
let trackedUserId: string | null = null; // for optional re-track if user logs in later

function getSessionId() {
	if (!browser) return crypto.randomUUID();
	let id = sessionStorage.getItem(SESSION_KEY);
	if (!id) {
		id = crypto.randomUUID();
		sessionStorage.setItem(SESSION_KEY, id);
	}
	return id;
}

function notifyAll() {
	for (const fn of subscribers) fn(globalSnapshot);
}

function handleGlobalSync() {
	if (!globalChannel) return;
	const state = globalChannel.presenceState<PresenceMeta>();
	let tabs = 0;
	let unique = 0; // NOT de-duped by design

	for (const key in state) {
		const metas = state[key] ?? [];
		tabs += metas.length;
		unique += metas.length;
	}
	globalSnapshot = { tabs, unique, connected: globalConnected };
	notifyAll();
}

async function ensureGlobalStarted(userId: string | null, roomLabel: string) {
	if (globalChannel) {
		// If userId changes (e.g., login), update presence meta once
		if (trackedUserId !== userId) {
			trackedUserId = userId;
			try { await globalChannel.track({ user_id: userId, room: roomLabel, ts: Date.now() }); } catch { }
		}
		return;
	}

	const sessionId = getSessionId();
	globalChannel = supabase.channel(`presence:${GLOBAL_ROOM}`, {
		config: { presence: { key: sessionId } }
	});

	globalChannel.on('presence', { event: 'sync' }, handleGlobalSync);

	globalChannel.subscribe(async (status) => {
		if (status === 'SUBSCRIBED') {
			globalConnected = true;
			trackedUserId = userId;
			try {
				await globalChannel!.track({ user_id: userId, room: roomLabel, ts: Date.now() });
			} finally {
				handleGlobalSync();
			}
		} else if (status === 'CLOSED' || status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
			globalConnected = false;
			globalSnapshot = { tabs: 0, unique: 0, connected: false };
			notifyAll();
		}
	});

	// graceful shutdown
	if (browser) {
		window.addEventListener('beforeunload', () => {
			try { void globalChannel?.untrack(); } catch { }
			globalChannel?.unsubscribe();
			globalChannel = null;
		});
	}
}

// Public API: subscribe to the GLOBAL pool (no de-dupe)
export function useGlobalPresence(userId: string | null): Readable<PresenceSnapshot> {
	return readable<PresenceSnapshot>(globalSnapshot, (set) => {
		if (!browser) {
			set({ tabs: 0, unique: 0, connected: false });
			return () => { };
		}

		subscribers.add(set);
		// Start or update singleton channel once per tab
		void ensureGlobalStarted(userId, '__any__');

		// Push current snapshot immediately
		set(globalSnapshot);

		return () => {
			subscribers.delete(set);
			// Do NOT tear down the channel here; keep singleton alive for the tab.
			// (If you want aggressive tear down, add a refcount and unsubscribe at 0.)
		};
	});
}

// If you still need per-page presence for other features (not used for counts)
export function usePresence(_room: string, userId: string | null): Readable<PresenceSnapshot> {
	// Delegate to global pool so layout code doesn’t change
	return useGlobalPresence(userId);
}
