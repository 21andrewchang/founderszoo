<script lang="ts">
	import LogModal from '$lib/components/LogModal.svelte';
	import { onMount } from 'svelte';
	import { supabase } from '$lib/supabaseClient';

	type Person = { label: string; user_id: string };

	let people = $state<Person[]>([]);

	const START_HOUR = 8;
	const END_HOUR = 24;
	const hours = Array.from({ length: END_HOUR - START_HOUR }, (_, i) => START_HOUR + i);
	const hh = (n: number) => n.toString().padStart(2, '0');

	// clock highlight
	let currentHour = $state(-1);
	let currentHalf = $state<0 | 1>(0);
	const isCurrent = (h: number) => h === currentHour;

	// auth + data
	let viewerUserId = $state<string | null>(null);
	let dayIdByUser = $state<Record<string, string | null>>({});
	let titlesByUser = $state<Record<string, Record<number, { first: string; second: string }>>>({});

	// modal + draft
	let logOpen = $state(false);
	let draft = $state<{ user_id: string | null; hour: number | null; half: 0 | 1 | null }>({
		user_id: null,
		hour: null,
		half: null
	});

	// prevent re-prompting within same slot
	let lastPromptKey = $state<string | null>(null);

	const localToday = () => {
		const d = new Date();
		return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
	};

	function setTitle(user_id: string, h: number, half01: 0 | 1, text: string) {
		titlesByUser[user_id] ??= {};
		titlesByUser[user_id][h] ??= { first: '', second: '' };
		if (half01 === 0) titlesByUser[user_id][h].first = text;
		else titlesByUser[user_id][h].second = text;
	}
	function getTitle(user_id: string, h: number, half01: 0 | 1) {
		const row = titlesByUser[user_id]?.[h];
		return row ? (half01 === 0 ? row.first : row.second) : '';
	}

	async function getTodayDayIdForUser(user_id: string, createIfMissing: boolean) {
		const today = localToday();
		const { data: found, error: findErr } = await supabase
			.from('days')
			.select('id')
			.eq('user_id', user_id)
			.eq('date', today)
			.maybeSingle();
		if (findErr) throw findErr;
		if (found?.id) return found.id as string;
		if (!createIfMissing) return null;
		const { data: created, error: insErr } = await supabase
			.from('days')
			.insert({ user_id, date: today })
			.select('id')
			.single();
		if (insErr) throw insErr;
		return created.id as string;
	}

	async function loadHoursForDay(user_id: string, day_id: string) {
		const { data, error } = await supabase
			.from('hours')
			.select('hour, half, title')
			.eq('day_id', day_id);
		if (error) throw error;
		const next: Record<number, { first: string; second: string }> = {};
		for (const r of data ?? []) {
			const h = r.hour as number;
			const half01 = (r.half ? 1 : 0) as 0 | 1;
			next[h] ??= { first: '', second: '' };
			if (half01 === 0) next[h].first = r.title ?? '';
			else next[h].second = r.title ?? '';
		}
		titlesByUser[user_id] = next;
	}

	function openEditor(user_id: string, h: number, half01: 0 | 1) {
		if (viewerUserId !== user_id) return; // only edit your own column
		draft = { user_id, hour: h, half: half01 };
		logOpen = true;
	}

	async function saveLog(text: string) {
		const { user_id, hour, half } = draft;
		if (!user_id || hour == null || half == null) return;
		const day_id = dayIdByUser[user_id];
		if (!day_id) return;
		const halfBool = half === 1;

		const { error } = await supabase
			.from('hours')
			.upsert({ day_id, hour, half: halfBool, title: text }, { onConflict: 'day_id,hour,half' });
		if (error) {
			console.error('save error', error);
			return;
		}
		setTitle(user_id, hour, half, text);
		logOpen = false;
	}

	// ---------- Auto-prompt if current slot empty (viewer only) ----------
	function slotKey(u: string, date: string, h: number, half: 0 | 1) {
		return `${u}|${date}|${h}|${half}`;
	}

	function maybePromptForMissing() {
		if (!viewerUserId || logOpen) return;
		const date = localToday();
		const h = currentHour;
		const half = currentHalf;
		if (h < START_HOUR || h >= END_HOUR) return;

		const key = slotKey(viewerUserId, date, h, half);
		if (lastPromptKey === key) return; // already prompted this slot

		const t = getTitle(viewerUserId, h, half);
		if (!t || t.trim() === '') {
			openEditor(viewerUserId, h, half);
			lastPromptKey = key;
		}
	}
	// --------------------------------------------------------------------

	// ---- Half-hour notifications (viewer only) ----
	const ENABLE_NOTIFS = true;

	async function ensureNotifPermission() {
		if (!('Notification' in window) || !ENABLE_NOTIFS) return false;
		if (Notification.permission === 'granted') return true;
		if (Notification.permission !== 'denied') {
			const p = await Notification.requestPermission();
			return p === 'granted';
		}
		return false;
	}

	function slotInfoFromNow() {
		const now = new Date();
		const hour = now.getHours();
		const half = (now.getMinutes() < 30 ? 0 : 1) as 0 | 1;
		return { hour, half, dateStr: localToday() };
	}

	function msUntilNextBoundary() {
		const now = new Date();
		const m = now.getMinutes();
		const s = now.getSeconds();
		const ms = now.getMilliseconds();
		const minsToNext = 30 - (m % 30);
		const totalMs =
			(minsToNext === 30 ? 0 : minsToNext) * 60_000 +
			(minsToNext === 30 ? (30 - (m % 30)) * 60_000 : 0); // guard not needed but harmless
		const msLeft = minsToNext * 60_000 - (s * 1_000 + ms);
		return msLeft <= 0 ? 1_000 : msLeft; // safety
	}

	function withinWindow(hour: number) {
		return hour >= START_HOUR && hour < END_HOUR;
	}

	function notifyCurrentSlot() {
		if (!viewerUserId || !('Notification' in window) || Notification.permission !== 'granted')
			return;

		const { hour, half } = slotInfoFromNow();
		if (!withinWindow(hour)) return;

		// Use viewer's titles if already loaded
		const titleTxt = getTitle(viewerUserId, hour, half)?.trim() || '';
		const blockLabel = half === 0 ? 'Block A' : 'Block B';
		const hourLabel = `${String(hour).padStart(2, '0')}:${half === 0 ? '00' : '30'}`;

		new Notification(`${blockLabel} • ${hourLabel}`, {
			body: titleTxt || 'Tap to log what you’re doing.',
			tag: `slot-${localToday()}-${hour}-${half}`
		});
	}

	let notifTimer: number | null = null;
	function startHalfHourNotifier() {
		// wait until we know who the viewer is
		if (!ENABLE_NOTIFS) return;
		window.clearTimeout(notifTimer as unknown as number);

		const arm = async () => {
			const ok = await ensureNotifPermission();
			if (!ok) return;
			notifyCurrentSlot(); // fire at boundary
			// schedule next boundary precisely every 30 minutes
			window.clearTimeout(notifTimer as unknown as number);
			notifTimer = window.setTimeout(arm, msUntilNextBoundary());
		};

		// align to the next boundary from "now"
		notifTimer = window.setTimeout(arm, msUntilNextBoundary());
	}
	async function testNotify() {
		const ok = await ensureNotifPermission();
		if (!ok) {
			alert('Notifications are blocked by the browser.');
			return;
		}
		const now = new Date();
		const hour = now.getHours();
		const half = now.getMinutes() < 30 ? 0 : 1;
		const blockLabel = half === 0 ? 'Block A' : 'Block B';
		const timeLabel = `${String(hour).padStart(2, '0')}:${half === 0 ? '00' : '30'}`;

		new Notification(`Test • ${blockLabel} • ${timeLabel}`, {
			body: 'This is a test notification.',
			tag: `test-${Date.now()}`
		});
	}
	// -----------------------------------------------

	async function init() {
		const { data: auth, error: authErr } = await supabase.auth.getUser();
		if (authErr) throw authErr;
		viewerUserId = auth.user?.id ?? null;

		const { data: rows, error: uerr } = await supabase
			.from('users')
			.select('id, display_name')
			.order('display_name', { ascending: true });
		if (uerr) throw uerr;

		people = (rows ?? []).map((r) => ({
			label: r.display_name as string,
			user_id: r.id as string
		}));

		await Promise.all(
			people.map(async ({ user_id }) => {
				const create = viewerUserId === user_id;
				const dayId = await getTodayDayIdForUser(user_id, create);
				dayIdByUser[user_id] = dayId;
				if (dayId) await loadHoursForDay(user_id, dayId);
			})
		);

		// Try prompting once right after initial load
		maybePromptForMissing();
		startHalfHourNotifier();
	}

	onMount(() => {
		const tick = () => {
			const now = new Date();
			currentHour = now.getHours();
			currentHalf = now.getMinutes() < 30 ? 0 : 1;
			// Re-check at each minute tick (will only open once per slot)
			maybePromptForMissing();
		};
		tick();
		const i = setInterval(tick, 60_000);
		init().catch((e) => console.error('init failed', e));
		return () => clearInterval(i);
	});
</script>

<div class="flex flex-col overflow-clip bg-stone-50 p-4">
	<div class="flex flex-row space-x-4">
		<div class="flex flex-col space-y-1">
			<div class="text-stone-50">T</div>
			{#each hours as h}
				<div class="flex">
					<div
						class="rounded px-1 text-stone-300"
						class:bg-amber-200={isCurrent(h)}
						class:text-stone-900={isCurrent(h)}
					>
						{hh(h)}
					</div>
				</div>
			{/each}
		</div>

		{#each people as person}
			<div class="flex w-full flex-col space-y-1">
				<div class="flex items-center gap-2">
					<span>{person.label}</span>
					{#if viewerUserId === person.user_id}
						<span class="rounded bg-stone-200 px-2 py-0.5 text-[10px] text-stone-700">you</span>
					{/if}
				</div>

				{#if dayIdByUser[person.user_id] === undefined}
					{#each hours as _}
						<div class="flex h-6 w-full flex-row space-x-1">
							<div class="flex w-full rounded-md bg-stone-100" />
							<div class="flex w-full rounded-md bg-stone-100" />
						</div>
					{/each}
				{:else if dayIdByUser[person.user_id] === null}
					{#each hours as _}
						<div class="flex h-6 w-full flex-row space-x-1">
							<div class="flex w-full rounded-md bg-stone-100" />
							<div class="flex w-full rounded-md bg-stone-100" />
						</div>
					{/each}
				{:else}
					{#each hours as h}
						<div class="flex h-6 w-full flex-row space-x-1">
							<button
								class="flex w-full justify-center rounded-md bg-stone-100 p-1 text-xs hover:bg-stone-200 disabled:opacity-60"
								onclick={() => openEditor(person.user_id, h, 0)}
								disabled={viewerUserId !== person.user_id}
							>
								{getTitle(person.user_id, h, 0) || ' '}
							</button>
							<button
								class="flex w-full justify-center rounded-md bg-stone-100 p-1 text-xs hover:bg-stone-200 disabled:opacity-60"
								onclick={() => openEditor(person.user_id, h, 1)}
								disabled={viewerUserId !== person.user_id}
							>
								{getTitle(person.user_id, h, 1) || ' '}
							</button>
						</div>
					{/each}
				{/if}
			</div>
		{/each}
	</div>
</div>

<LogModal open={logOpen} onClose={() => (logOpen = false)} onSave={saveLog} />
