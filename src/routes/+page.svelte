<script lang="ts">
	import LogModal from '$lib/components/LogModal.svelte';
	import Slot from '$lib/components/Slot.svelte';
	import { onMount } from 'svelte';
	import { supabase } from '$lib/supabaseClient';

	type Person = { label: string; user_id: string };

	let people = $state<Person[]>([]);

	const START_HOUR = 8;
	const END_HOUR = 24;
	const hours = Array.from({ length: END_HOUR - START_HOUR }, (_, i) => START_HOUR + i);
	const loadingPlaceholderColumns = Array.from({ length: 2 });
	const hh = (n: number) => n.toString().padStart(2, '0');

	const TEST_CLOCK = {
		enabled: false,
		hour: 12,
		minute: 0
	};
	function getNow(): Date {
		if (!TEST_CLOCK.enabled) return new Date();
		const d = new Date();
		d.setHours(TEST_CLOCK.hour, TEST_CLOCK.minute, 0, 0);
		return d;
	}
	let currentHour = $state(-1);
	let currentHalf = $state<0 | 1>(0);
	const isCurrent = (h: number) => h === currentHour;

	// auth + data
	let viewerUserId = $state<string | null>(null);
	let dayIdByUser = $state<Record<string, string | null>>({});
	let isLoading = $state(true);

	type SlotValue = { title: string; todo: boolean | null };
	type SlotRow = { first: SlotValue; second: SlotValue };
	type HabitSlotRow = { first: string | null; second: string | null };
	type SelectedSlot = { hourIndex: number; half: 0 | 1 };

	const createEmptySlot = (): SlotValue => ({ title: '', todo: null });
	let slotsByUser = $state<Record<string, Record<number, SlotRow>>>({});
	let habitsByUser = $state<Record<string, Record<number, HabitSlotRow>>>({});

	// modal + draft
	let logOpen = $state(false);
	let draft = $state<{ user_id: string | null; hour: number | null; half: 0 | 1 | null }>({
		user_id: null,
		hour: null,
		half: null
	});
	let selectedSlot = $state<SelectedSlot | null>(null);

	// prevent re-prompting within same slot
	let lastPromptKey = $state<string | null>(null);

	const localToday = () => {
		const d = getNow();
		return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
	};

	function ensureSlotRow(user_id: string, h: number): SlotRow {
		slotsByUser[user_id] ??= {};
		slotsByUser[user_id][h] ??= { first: createEmptySlot(), second: createEmptySlot() };
		return slotsByUser[user_id][h];
	}
	function setTitle(
		user_id: string,
		h: number,
		half01: 0 | 1,
		text: string,
		todo?: boolean | null
	) {
		const row = ensureSlotRow(user_id, h);
		if (half01 === 0) {
			row.first.title = text;
			if (todo !== undefined) row.first.todo = todo;
		} else {
			row.second.title = text;
			if (todo !== undefined) row.second.todo = todo;
		}
	}
	function setTodo(user_id: string, h: number, half01: 0 | 1, value: boolean | null) {
		const row = ensureSlotRow(user_id, h);
		if (half01 === 0) row.first.todo = value;
		else row.second.todo = value;
	}
	function getSlot(user_id: string, h: number, half01: 0 | 1): SlotValue {
		const row = slotsByUser[user_id]?.[h];
		if (!row) return createEmptySlot();
		return half01 === 0 ? row.first : row.second;
	}
	function getTitle(user_id: string, h: number, half01: 0 | 1) {
		return getSlot(user_id, h, half01).title ?? '';
	}
	function getTodo(user_id: string, h: number, half01: 0 | 1) {
		return getSlot(user_id, h, half01).todo ?? null;
	}
	function ensureHabitRow(user_id: string, h: number): HabitSlotRow {
		habitsByUser[user_id] ??= {};
		habitsByUser[user_id][h] ??= { first: null, second: null };
		return habitsByUser[user_id][h];
	}
	function setHabitTitle(user_id: string, h: number, half01: 0 | 1, name: string | null) {
		const row = ensureHabitRow(user_id, h);
		if (half01 === 0) row.first = name;
		else row.second = name;
	}
	function getHabitTitle(user_id: string, h: number, half01: 0 | 1) {
		const row = habitsByUser[user_id]?.[h];
		if (!row) return null;
		return half01 === 0 ? row.first : row.second;
	}
	function getHourIndex(value: number) {
		return hours.findIndex((hour) => hour === value);
	}
	function clampHourIndex(idx: number) {
		return Math.max(0, Math.min(hours.length - 1, idx));
	}
	function slotIsEmpty(user_id: string, h: number, half01: 0 | 1) {
		return getTitle(user_id, h, half01).trim().length === 0;
	}
	async function insertHabitHours(
		user_id: string,
		day_id: string | null,
		entries: { hour: number; half: 0 | 1; name: string }[]
	) {
		if (!day_id || entries.length === 0) return;
		const payload = entries.map(({ hour, half, name }) => ({
			day_id,
			hour,
			half: half === 1,
			title: name,
			todo: false,
			habit: true
		}));
		const { error } = await supabase
			.from('hours')
			.upsert(payload, { onConflict: 'day_id,hour,half' });
		if (error) {
			console.error('habit hour insert error', error);
			return;
		}
		for (const { hour, half, name } of entries) {
			setTitle(user_id, hour, half, name, false);
		}
	}
	async function ensureHabitHoursForDay(user_id: string, day_id: string | null) {
		if (!day_id) return;
		const userHabits = habitsByUser[user_id];
		if (!userHabits) return;
		const pending: { hour: number; half: 0 | 1; name: string }[] = [];
		for (const [hourStr, row] of Object.entries(userHabits)) {
			const hour = Number(hourStr);
			if (Number.isNaN(hour)) continue;
			if (row.first && slotIsEmpty(user_id, hour, 0))
				pending.push({ hour, half: 0, name: row.first });
			if (row.second && slotIsEmpty(user_id, hour, 1))
				pending.push({ hour, half: 1, name: row.second });
		}
		if (pending.length === 0) return;
		await insertHabitHours(user_id, day_id, pending);
	}
	function setSelectedSlot(next: SelectedSlot | null) {
		if (!viewerUserId || next === null) {
			selectedSlot = null;
			return;
		}
		selectedSlot = {
			hourIndex: clampHourIndex(next.hourIndex),
			half: next.half === 1 ? 1 : 0
		};
	}
	function ensureSelectionExists() {
		if (!viewerUserId || selectedSlot) return;
		const { hour, half } = slotInfoFromNow();
		const idx = getHourIndex(hour);
		setSelectedSlot({
			hourIndex: idx === -1 ? 0 : idx,
			half
		});
	}
	function isTypingTarget(target: EventTarget | null) {
		if (!(target instanceof HTMLElement)) return false;
		const tag = target.tagName;
		if (tag === 'INPUT' || tag === 'TEXTAREA') return true;
		if (target.isContentEditable) return true;
		return !!target.closest('input, textarea, [contenteditable="true"]');
	}
	function moveSelectionLeft() {
		if (!viewerUserId || !selectedSlot) return false;
		if (selectedSlot.half === 0) return true;
		setSelectedSlot({ hourIndex: selectedSlot.hourIndex, half: 0 });
		return true;
	}
	function moveSelectionRight() {
		if (!viewerUserId || !selectedSlot) return false;
		if (selectedSlot.half === 1) return true;
		setSelectedSlot({ hourIndex: selectedSlot.hourIndex, half: 1 });
		return true;
	}
	function moveSelectionVertical(delta: 1 | -1) {
		if (!viewerUserId || !selectedSlot) return false;
		const nextIndex = selectedSlot.hourIndex + delta;
		if (nextIndex < 0 || nextIndex >= hours.length) return false;
		setSelectedSlot({ hourIndex: nextIndex, half: selectedSlot.half });
		return true;
	}
	function activateSelectedSlotFromKeyboard() {
		if (!viewerUserId || !selectedSlot) return false;
		const hour = hours[selectedSlot.hourIndex];
		if (hour === undefined) return false;

		// 1) If this slot has a todo bubble, toggle it.
		const todoValue = getTodo(viewerUserId, hour, selectedSlot.half);
		if (todoValue !== null) {
			toggleTodo(viewerUserId, hour, selectedSlot.half);
			return true;
		}

		// 2) Block opening if this slot is a habit.
		const habitName = getHabitTitle(viewerUserId, hour, selectedSlot.half);
		if ((habitName ?? '').trim().length > 0) return true; // handled: habits are not editable

		// 3) Only open editor if empty and not a habit.
		const title = getTitle(viewerUserId, hour, selectedSlot.half);
		if (title.trim().length > 0) return false;
		openEditor(viewerUserId, hour, selectedSlot.half);
		return true;
	}

	function handleGlobalKeydown(event: KeyboardEvent) {
		if (!viewerUserId || logOpen) return;
		if (event.metaKey || event.ctrlKey || event.altKey) return;
		if (isTypingTarget(event.target)) return;
		const key = event.key;
		const normalized = key.length === 1 ? key.toLowerCase() : key;
		if (normalized === 'Escape') {
			if (selectedSlot) {
				setSelectedSlot(null);
				event.preventDefault();
			}
			return;
		}
		if (!['h', 'j', 'k', 'l', 'Enter'].includes(normalized)) return;
		ensureSelectionExists();
		if (!selectedSlot) return;
		let handled = false;
		switch (normalized) {
			case 'h':
				handled = moveSelectionLeft();
				break;
			case 'l':
				handled = moveSelectionRight();
				break;
			case 'j':
				handled = moveSelectionVertical(1);
				break;
			case 'k':
				handled = moveSelectionVertical(-1);
				break;
			case 'Enter':
				handled = activateSelectedSlotFromKeyboard();
				break;
		}
		if (handled) event.preventDefault();
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
			.select('hour, half, title, todo')
			.eq('day_id', day_id);
		if (error) throw error;
		const next: Record<number, SlotRow> = {};
		for (const r of data ?? []) {
			const h = r.hour as number;
			const half01 = (r.half ? 1 : 0) as 0 | 1;
			const slotValue: SlotValue = {
				title: r.title ?? '',
				todo: r.todo as boolean | null
			};
			next[h] ??= { first: createEmptySlot(), second: createEmptySlot() };
			if (half01 === 0) next[h].first = slotValue;
			else next[h].second = slotValue;
		}
		slotsByUser[user_id] = next;
	}
	async function loadHabitsForUser(user_id: string) {
		const { data, error } = await supabase
			.from('habits')
			.select('hour, half, name')
			.eq('user_id', user_id);
		if (error) throw error;
		const next: Record<number, HabitSlotRow> = {};
		for (const r of data ?? []) {
			const h = r.hour as number;
			const half01 = (r.half ? 1 : 0) as 0 | 1;
			const name = r.name ?? '';
			next[h] ??= { first: null, second: null };
			if (half01 === 0) next[h].first = name;
			else next[h].second = name;
		}
		habitsByUser[user_id] = next;
	}

	function openEditor(user_id: string, h: number, half01: 0 | 1) {
		if (viewerUserId !== user_id) return; // only edit your own column
		const hourIndex = getHourIndex(h);
		if (hourIndex !== -1) {
			setSelectedSlot({ hourIndex, half: half01 });
		}
		draft = { user_id, hour: h, half: half01 };
		logOpen = true;
	}

	async function saveLog(
		text: string,
		todo: boolean | null,
		habit?: { name: string; hour: number; half: 0 | 1 } | null
	) {
		const { user_id, hour, half } = draft;
		if (!user_id || hour == null || half == null) return;
		const day_id = dayIdByUser[user_id];
		if (!day_id) return;

		const hourPayload: {
			day_id: string;
			hour: number;
			half: boolean;
			title: string;
			todo: boolean | null;
			habit?: boolean;
		} = {
			day_id,
			hour,
			half: half === 1,
			title: text,
			todo
		};
		if (habit && habit.hour === hour && habit.half === half) {
			hourPayload.habit = true;
		}
		const { error } = await supabase
			.from('hours')
			.upsert(hourPayload, { onConflict: 'day_id,hour,half' });

		if (error) {
			console.error('save error', error);
			return;
		}

		// update local cache with both title and todo
		setTitle(user_id, hour, half, text, todo);

		if (habit && viewerUserId === user_id) {
			const { name, hour: habitHour, half: habitHalf } = habit;
			const { error: habitErr } = await supabase.from('habits').upsert(
				{
					user_id,
					name,
					hour: habitHour,
					half: habitHalf === 1
				},
				{ onConflict: 'user_id,hour,half' }
			);
			if (habitErr) {
				console.error('habit save error', habitErr);
			} else {
				setHabitTitle(user_id, habitHour, habitHalf, name);
			}

			await insertHabitHours(user_id, day_id, [{ hour: habitHour, half: habitHalf, name }]);
		}

		logOpen = false;
	}

	async function toggleTodo(user_id: string, hour: number, half: 0 | 1) {
		if (viewerUserId !== user_id) return;
		const day_id = dayIdByUser[user_id];
		if (!day_id) return;
		const slot = getSlot(user_id, hour, half);
		if (slot.todo === null) return;
		const nextTodo = !slot.todo;
		const { error } = await supabase.from('hours').upsert(
			{
				day_id,
				hour,
				half: half === 1,
				title: slot.title ?? '',
				todo: nextTodo
			},
			{ onConflict: 'day_id,hour,half' }
		);
		if (error) {
			console.error('toggle todo error', error);
			return;
		}
		setTodo(user_id, hour, half, nextTodo);
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
		const now = getNow();
		const hour = now.getHours();
		const half = (now.getMinutes() < 30 ? 0 : 1) as 0 | 1;
		return { hour, half, dateStr: localToday() };
	}

	function msUntilNextBoundary() {
		const now = getNow();
		const m = now.getMinutes();
		const s = now.getSeconds();
		const ms = now.getMilliseconds();
		const minsToNext = 30 - (m % 30);
		const totalMs =
			(minsToNext === 30 ? 0 : minsToNext) * 60_000 +
			(minsToNext === 30 ? (30 - (m % 30)) * 60_000 : 0); // guard not needed but harmless
		const msLeft = minsToNext * 60_000 - (s * 1_000 + ms);
		return msLeft <= 0 ? 1_000 : msLeft;
	}

	function withinWindow(hour: number) {
		return hour >= START_HOUR && hour < END_HOUR;
	}

	function notifyCurrentSlot() {
		if (!viewerUserId || !('Notification' in window) || Notification.permission !== 'granted')
			return;

		const { hour, half } = slotInfoFromNow();
		if (!withinWindow(hour)) return;

		const blockLabel = half === 0 ? 'Block A' : 'Block B';
		const hourLabel = `${String(hour).padStart(2, '0')}:${half === 0 ? '00' : '30'}`;

		// read the viewer's current slot title
		const rawTitle = getTitle(viewerUserId, hour, half);
		const titleTxt = (rawTitle ?? '').trim();

		const notifTitle = `${blockLabel} • ${hourLabel}`;
		const body = titleTxt ? `TODO: ${titleTxt}` : undefined;

		new Notification(notifTitle, {
			body,
			tag: `slot-${localToday()}-${hour}-${half}`,
			// 1×1 transparent PNG to suppress default site icon
			icon: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR4nGNgYAAAAAMAASsJTYQAAAAASUVORK5CYII=',
			requireInteraction: false,
			silent: false
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
			notifyCurrentSlot();
			// schedule next boundary precisely every 30 minutes
			window.clearTimeout(notifTimer as unknown as number);
			notifTimer = window.setTimeout(arm, msUntilNextBoundary());
		};

		notifTimer = window.setTimeout(arm, msUntilNextBoundary());
	}

	async function init() {
		try {
			const { data: auth, error: authErr } = await supabase.auth.getUser();
			if (authErr) throw authErr;
			viewerUserId = auth.user?.id ?? null;
			if (!viewerUserId) selectedSlot = null;

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
					const tasks: Promise<void>[] = [loadHabitsForUser(user_id)];
					if (dayId) tasks.push(loadHoursForDay(user_id, dayId));
					await Promise.all(tasks);
					if (dayId) await ensureHabitHoursForDay(user_id, dayId);
				})
			);

			// Try prompting once right after initial load
			maybePromptForMissing();
			startHalfHourNotifier();
			ensureSelectionExists();
		} catch (e) {
			console.error('init failed', e);
		} finally {
			isLoading = false;
		}
	}

	onMount(() => {
		const tick = () => {
			const now = getNow();
			currentHour = now.getHours();
			currentHalf = now.getMinutes() < 30 ? 0 : 1;
			// Re-check at each minute tick (will only open once per slot)
			maybePromptForMissing();
		};
		tick();
		const i = setInterval(tick, 60_000);
		init();
		const keyHandler = (event: KeyboardEvent) => handleGlobalKeydown(event);
		window.addEventListener('keydown', keyHandler);
		return () => {
			clearInterval(i);
			window.removeEventListener('keydown', keyHandler);
		};
	});
</script>

<div class="flex flex-col overflow-clip bg-stone-50 p-4">
	<div class="flex flex-row space-x-4">
		<div class="flex flex-col space-y-1">
			<div class="text-stone-50">T</div>
			{#each hours as h}
				<div
					class="flex h-7 items-center justify-center rounded px-1 text-stone-300"
					class:bg-amber-200={isCurrent(h)}
					class:text-stone-900={isCurrent(h)}
				>
					{hh(h)}
				</div>
			{/each}
		</div>

		{#if isLoading}
			{#each loadingPlaceholderColumns as _}
				<div class="flex w-full flex-col space-y-1" aria-hidden="true">
					<div class="flex items-center gap-2">
						<div class="loading-sheen h-4 w-24 rounded bg-stone-200"></div>
					</div>
					{#each hours as _}
						<div class="flex h-7 w-full flex-row space-x-1">
							<div class="loading-slot flex w-full rounded-md bg-stone-100"></div>
							<div class="loading-slot flex w-full rounded-md bg-stone-100"></div>
						</div>
					{/each}
				</div>
			{/each}
		{:else}
			{#each people as person}
				<div class="flex w-full flex-col space-y-1">
					<div class="flex items-center gap-2">
						<span>{person.label}</span>
						{#if viewerUserId === person.user_id}
							<span class="rounded bg-stone-200 px-2 py-0.5 text-[10px] text-stone-700">you</span>
						{/if}
					</div>

					{#if dayIdByUser[person.user_id] === undefined || dayIdByUser[person.user_id] === undefined}
						{#each hours as _}
							<div class="flex h-7 w-full flex-row space-x-1">
								<div class="loading-slot flex w-full rounded-md bg-stone-100"></div>
								<div class="loading-slot flex w-full rounded-md bg-stone-100"></div>
							</div>
						{/each}
					{:else}
						{#each hours as h, hourIndex}
							<div class="flex h-7 w-full flex-row space-x-1">
								<Slot
									title={getTitle(person.user_id, h, 0)}
									todo={getTodo(person.user_id, h, 0)}
									editable={viewerUserId === person.user_id}
									onSelect={() => openEditor(person.user_id, h, 0)}
									onToggleTodo={() => toggleTodo(person.user_id, h, 0)}
									habit={getHabitTitle(person.user_id, h, 0)}
									selected={viewerUserId === person.user_id &&
										selectedSlot?.hourIndex === hourIndex &&
										selectedSlot?.half === 0}
								/>
								<Slot
									title={getTitle(person.user_id, h, 1)}
									todo={getTodo(person.user_id, h, 1)}
									editable={viewerUserId === person.user_id}
									onSelect={() => openEditor(person.user_id, h, 1)}
									onToggleTodo={() => toggleTodo(person.user_id, h, 1)}
									habit={getHabitTitle(person.user_id, h, 1)}
									selected={viewerUserId === person.user_id &&
										selectedSlot?.hourIndex === hourIndex &&
										selectedSlot?.half === 1}
								/>
							</div>
						{/each}
					{/if}
				</div>
			{/each}
		{/if}
	</div>
</div>

<LogModal
	open={logOpen}
	onClose={() => (logOpen = false)}
	onSave={saveLog}
	initialHour={draft.hour}
	initialHalf={draft.half}
/>

<style>
	.loading-slot,
	.loading-sheen {
		position: relative;
		overflow: hidden;
	}

	.loading-slot::after,
	.loading-sheen::after {
		content: '';
		position: absolute;
		inset: 0;
		background: linear-gradient(
			120deg,
			transparent 0%,
			rgba(255, 255, 255, 0.65) 50%,
			transparent 100%
		);
		transform: translateX(-100%);
		animation: slot-sheen 0.5s linear infinite;
	}

	@keyframes slot-sheen {
		100% {
			transform: translateX(100%);
		}
	}
</style>
