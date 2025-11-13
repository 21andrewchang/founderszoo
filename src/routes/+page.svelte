<script lang="ts">
	import ConfirmMoveModal from '$lib/components/ConfirmMoveModal.svelte';
	import LogModal from '$lib/components/LogModal.svelte';
	import PlayerStatusTag from '$lib/components/PlayerStatusTag.svelte';
	import Slot from '$lib/components/Slot.svelte';
	import { watchPlayerStatus, trackPlayerPresence, type PlayerStatus } from '$lib/playerPresence';
	import { calculateStreak, type DayCompletionSummary, type PlayerStreak } from '$lib/streaks';
	import { getContext, onDestroy, onMount } from 'svelte';
	import { supabase } from '$lib/supabaseClient';
	import type { Writable } from 'svelte/store';
	import type { Session } from '$lib/session';

	type Person = { label: string; user_id: string };

	let people = $state<Person[]>([]);
	const session = getContext<Writable<Session>>('session');
	let isDragging = $state(false);
	let suppressNextClick = $state(false);

	const TRACKED_PLAYERS = [
		{ key: 'andrew', fallbackLabel: 'Andrew', tokens: ['andrew', 'graves'] },
		{ key: 'nico', fallbackLabel: 'Nico', tokens: ['nico', 'cho'] }
	] as const;

	type PlayerKey = (typeof TRACKED_PLAYERS)[number]['key'];
	type PlayerDisplay = { label: string; user_id: string | null };

	let playerDisplays = $state<Record<PlayerKey, PlayerDisplay>>({
		andrew: { label: 'Andrew', user_id: null },
		nico: { label: 'Nico', user_id: null }
	});
	let playerStatuses = $state<Record<PlayerKey, PlayerStatus>>({
		andrew: 'offline',
		nico: 'offline'
	});
	let streakByUser = $state<Record<string, PlayerStreak | null>>({});

	let playerStatusUnsubscribers: (() => void)[] = [];
	let stopLocalPlayerPresence: (() => void) | null = null;

	function updateTrackedPlayersFromPeople(list: Person[]) {
		const next = {} as Record<PlayerKey, PlayerDisplay>;
		for (const def of TRACKED_PLAYERS) {
			const match = list.find((person) => {
				const label = person.label.toLowerCase();
				return def.tokens.some((token) => label.includes(token));
			});
			next[def.key] = {
				label: match?.label ?? def.fallbackLabel,
				user_id: match?.user_id ?? null
			};
		}
		playerDisplays = next;
	}

	function stopPlayerStatusWatchers() {
		for (const unsub of playerStatusUnsubscribers) {
			unsub?.();
		}
		playerStatusUnsubscribers = [];
	}

	function startPlayerStatusWatchers(viewerId: string | null) {
		stopPlayerStatusWatchers();

		for (const def of TRACKED_PLAYERS) {
			const display = playerDisplays[def.key];
			if (!display?.user_id) {
				playerStatuses = { ...playerStatuses, [def.key]: 'offline' };
				continue;
			}
			if (viewerId && display.user_id === viewerId) continue;

			const store = watchPlayerStatus(display.user_id);
			const unsub = store.subscribe((status) => {
				playerStatuses = { ...playerStatuses, [def.key]: status };
			});
			playerStatusUnsubscribers.push(unsub);
		}
	}

	function startLocalPlayerPresenceIfTracked(userId: string | null) {
		stopLocalPlayerPresence?.();
		stopLocalPlayerPresence = null;
		if (!userId) return;
		const isTracked = Object.values(playerDisplays).some((display) => display.user_id === userId);
		if (!isTracked) return;
		stopLocalPlayerPresence = trackPlayerPresence(userId);
	}

	function getTrackedPlayerKeyForUser(user_id: string): PlayerKey | null {
		for (const def of TRACKED_PLAYERS) {
			if (playerDisplays[def.key]?.user_id === user_id) {
				return def.key;
			}
		}
		return null;
	}

	const START_HOUR = 8;
	const END_HOUR = 24;
	const hours = Array.from({ length: END_HOUR - START_HOUR }, (_, i) => START_HOUR + i);
	const TOTAL_BLOCKS_PER_DAY = hours.length * 2;
	const STREAK_LOOKBACK_DAYS = 60;
	const loadingPlaceholderColumns = Array.from({ length: 2 });
	const hh = (n: number) => n.toString().padStart(2, '0');
	const blockLabelText = (half: 0 | 1) => (half === 0 ? 'Block A' : 'Block B');
	const slotTimeLabel = (hour: number, half: 0 | 1) => `${hh(hour)}:${half === 0 ? '00' : '30'}`;
	const formatSlotLabel = (hour: number, half: 0 | 1) =>
		`${slotTimeLabel(hour, half)} (${blockLabelText(half)})`;

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
	let currentMinute = $state(0);
	const isCurrent = (h: number) => h === currentHour;
	const isNightWindow = () => currentHour >= 0 && currentHour < START_HOUR;
	const minutesUntilDayStart = () => {
		if (currentHour < 0 || currentMinute < 0) return 0;
		const totalMinutes = currentHour * 60 + currentMinute;
		const dayStartMinutes = START_HOUR * 60;
		if (totalMinutes >= dayStartMinutes) return 0;
		return dayStartMinutes - totalMinutes;
	};
	const countdownText = () => {
		const minutes = minutesUntilDayStart();
		const hours = Math.floor(minutes / 60);
		const mins = minutes % 60;
		return `${hours}h ${mins}m until day starts`;
	};

	// auth + data
	let viewerUserId = $state<string | null>(null);
	let dayIdByUser = $state<Record<string, string | null>>({});
	let isLoading = $state(true);

	type SlotValue = { title: string; todo: boolean | null };
	type SlotRow = { first: SlotValue; second: SlotValue };
	type HabitSlotRow = { first: string | null; second: string | null };
	type SelectedSlot = { hourIndex: number; half: 0 | 1 };
	type DraggingSlot = { user_id: string; hour: number; half: 0 | 1 };
	type PendingMove = {
		user_id: string;
		fromHour: number;
		fromHalf: 0 | 1;
		toHour: number;
		toHalf: 0 | 1;
	};

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
	let draggingSlot = $state<DraggingSlot | null>(null);
	let dragHoverSlot = $state<SelectedSlot | null>(null);
	let hoverSlot = $state<SelectedSlot | null>(null);
	let pendingMove = $state<PendingMove | null>(null);
	let isMoveSubmitting = $state(false);
	let dragImageEl: HTMLElement | null = null;
	const pendingMoveSummary = $derived.by(() => {
		if (!pendingMove) return null;
		const { user_id, fromHour, fromHalf, toHour, toHalf } = pendingMove;
		const sourceTitle = (getTitle(user_id, fromHour, fromHalf) ?? '').trim();
		const sourceHabit = (getHabitTitle(user_id, fromHour, fromHalf) ?? '').trim();
		const destinationTitle = (getTitle(user_id, toHour, toHalf) ?? '').trim();
		const destinationHabit = (getHabitTitle(user_id, toHour, toHalf) ?? '').trim();
		const destinationTodo = getTodo(user_id, toHour, toHalf);
		return {
			slotLabel: sourceTitle || sourceHabit || 'this slot',
			fromLabel: formatSlotLabel(fromHour, fromHalf),
			toLabel: formatSlotLabel(toHour, toHalf),
			destinationLabel: destinationTitle || destinationHabit || null,
			hasDestinationContent:
				destinationTitle.length > 0 || destinationHabit.length > 0 || destinationTodo !== null,
			isHabit: sourceHabit.length > 0
		};
	});

	// prevent re-prompting within same slot
	let lastPromptKey = $state<string | null>(null);

	const formatDateString = (date: Date) =>
		`${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
	const dateStringNDaysAgo = (days: number) => {
		const d = getNow();
		d.setDate(d.getDate() - days);
		return formatDateString(d);
	};
	const localToday = () => formatDateString(getNow());

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
	function slotHasContent(user_id: string, h: number, half01: 0 | 1) {
		const title = getTitle(user_id, h, half01).trim();
		const todo = getTodo(user_id, h, half01);
		const habitName = (getHabitTitle(user_id, h, half01) ?? '').trim();
		return title.length > 0 || todo !== null || habitName.length > 0;
	}
	function canDragSlot(user_id: string, h: number, half01: 0 | 1) {
		if (!viewerUserId || viewerUserId !== user_id) return false;
		return slotHasContent(user_id, h, half01);
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
	function slotMatches(selection: SelectedSlot | null, hourIndex: number, half: 0 | 1) {
		return selection?.hourIndex === hourIndex && selection?.half === half;
	}
	function highlightedSlotForUser(user_id: string): SelectedSlot | null {
		if (viewerUserId !== user_id) return null;
		return dragHoverSlot ?? hoverSlot ?? selectedSlot;
	}
	function slotIsHighlighted(user_id: string, hourIndex: number, half: 0 | 1) {
		const active = highlightedSlotForUser(user_id);
		return slotMatches(active, hourIndex, half);
	}
	function slotIsCurrent(hour: number, half: 0 | 1) {
		return currentHour === hour && currentHalf === half;
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

		const todoValue = getTodo(viewerUserId, hour, selectedSlot.half);
		if (todoValue !== null) {
			toggleTodo(viewerUserId, hour, selectedSlot.half);
			return true;
		}

		const habitName = getHabitTitle(viewerUserId, hour, selectedSlot.half);
		if ((habitName ?? '').trim().length > 0) return true;

		const title = getTitle(viewerUserId, hour, selectedSlot.half);
		if (title.trim().length > 0) return false;
		openEditor(viewerUserId, hour, selectedSlot.half);
		setSelectedSlot(null);
		return true;
	}

	function cleanupDragImage() {
		if (dragImageEl && dragImageEl.parentNode) {
			dragImageEl.parentNode.removeChild(dragImageEl);
		}
		dragImageEl = null;
	}
	function resetDragState() {
		draggingSlot = null;
		dragHoverSlot = null;
		cleanupDragImage();
	}

	// pointer down: clear selection immediately before drag/focus
	function handleSlotPointerDown(
		event: PointerEvent,
		user_id: string,
		hour: number,
		half: 0 | 1,
		hourIndex: number
	) {
		if (!canDragSlot(user_id, hour, half)) return;

		setSelectedSlot(null);
		hoverSlot = null;
		dragHoverSlot = null;
	}

	function handleSlotDragStart(
		event: DragEvent,
		user_id: string,
		hour: number,
		half: 0 | 1,
		hourIndex: number
	) {
		if (!canDragSlot(user_id, hour, half)) {
			event.preventDefault();
			return;
		}
		isDragging = true;
		suppressNextClick = true;
		setSelectedSlot(null);
		draggingSlot = { user_id, hour, half };
		dragHoverSlot = { hourIndex, half };
		if (event.dataTransfer) {
			event.dataTransfer.effectAllowed = 'move';
			event.dataTransfer.setData('text/plain', `${hour}-${half}`);
			const currentTarget = event.currentTarget as HTMLElement | null;
			const buttonEl = currentTarget?.querySelector('button');
			if (buttonEl) {
				const rect = buttonEl.getBoundingClientRect();
				if (typeof document !== 'undefined') {
					cleanupDragImage();
					const clone = buttonEl.cloneNode(true) as HTMLElement;
					const computed = getComputedStyle(buttonEl);
					clone.style.position = 'fixed';
					clone.style.top = '-9999px';
					clone.style.left = '-9999px';
					clone.style.width = `${rect.width}px`;
					clone.style.height = `${rect.height}px`;
					clone.style.pointerEvents = 'none';
					clone.style.margin = '0';
					clone.style.boxShadow = computed.boxShadow || '0 10px 25px rgba(15,15,15,0.15)';
					clone.style.borderRadius = computed.borderRadius;
					document.body.appendChild(clone);
					dragImageEl = clone;
					event.dataTransfer.setDragImage(clone, rect.width / 2, rect.height / 2);
				} else {
					event.dataTransfer.setDragImage(buttonEl, rect.width / 2, rect.height / 2);
				}
			}
		}
	}
	function handleSlotDragOver(event: DragEvent, user_id: string, half: 0 | 1, hourIndex: number) {
		if (!draggingSlot || draggingSlot.user_id !== user_id) return;
		event.preventDefault();
		event.stopPropagation();
		if (event.dataTransfer) event.dataTransfer.dropEffect = 'move';
		if (!slotMatches(dragHoverSlot, hourIndex, half)) {
			dragHoverSlot = { hourIndex, half };
		}
	}
	function handleSlotDrop(event: DragEvent, user_id: string, hour: number, half: 0 | 1) {
		if (!draggingSlot || draggingSlot.user_id !== user_id) return;
		event.preventDefault();
		event.stopPropagation();
		const source = draggingSlot;
		resetDragState();
		if (source.hour === hour && source.half === half) return;
		pendingMove = {
			user_id,
			fromHour: source.hour,
			fromHalf: source.half,
			toHour: hour,
			toHalf: half
		};
	}
	function handleSlotDragEnd() {
		resetDragState();
		isDragging = false;
		queueMicrotask(() => {
			suppressNextClick = false;
		});
	}
	function captureHoverSelection() {
		if (!viewerUserId || !hoverSlot) return false;
		setSelectedSlot(hoverSlot);
		hoverSlot = null;
		return true;
	}
	function handleSlotPointerEnter(user_id: string, hourIndex: number, half: 0 | 1) {
		if (!viewerUserId || viewerUserId !== user_id) return;
		hoverSlot = { hourIndex, half };
	}
	function handleSlotPointerLeave(user_id: string, hourIndex: number, half: 0 | 1) {
		if (!viewerUserId || viewerUserId !== user_id) return;
		if (hoverSlot && hoverSlot.hourIndex === hourIndex && hoverSlot.half === half) {
			hoverSlot = null;
		}
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
		captureHoverSelection();
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

	async function loadPlayerHistoryForUser(user_id: string) {
		const today = localToday();
		const lookbackStart = dateStringNDaysAgo(STREAK_LOOKBACK_DAYS);
		try {
			const { data: dayStats, error: dayErr } = await supabase
				.from('day_block_stats')
				.select('date, filled_blocks')
				.eq('user_id', user_id)
				.gte('date', lookbackStart)
				.order('date', { ascending: true });
			if (dayErr) throw dayErr;

			const summaries: DayCompletionSummary[] = [];
			for (const stat of dayStats ?? []) {
				const date = (stat.date as string | null) ?? null;
				if (!date || date === today) continue;
				const filled = Number(stat.filled_blocks ?? 0);
				if (Number.isNaN(filled)) continue;
				const missingBlocks = Math.max(0, TOTAL_BLOCKS_PER_DAY - filled);
				summaries.push({ date, missingBlocks });
			}

			const streak = calculateStreak(summaries);
			streakByUser = { ...streakByUser, [user_id]: streak };
		} catch (error) {
			console.error('load player history error', { user_id, error });
			streakByUser = { ...streakByUser, [user_id]: null };
		}
	}

	function openEditor(user_id: string, h: number, half01: 0 | 1) {
		if (viewerUserId !== user_id) return;
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
		hour: number,
		half: 0 | 1,
		habit: boolean
	) {
		const { user_id } = draft;
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
		const { error } = await supabase
			.from('hours')
			.upsert(hourPayload, { onConflict: 'day_id,hour,half' });

		if (error) {
			console.error('save error', error);
			return;
		}

		setTitle(user_id, hour, half, text, todo);

		if (habit && viewerUserId === user_id) {
			const { error: habitErr } = await supabase.from('habits').upsert(
				{
					user_id,
					name: text,
					hour: hour,
					half: half === 1
				},
				{ onConflict: 'user_id,hour,half' }
			);
			if (habitErr) {
				console.error('habit save error', habitErr);
			} else {
				setHabitTitle(user_id, hour, half, text);
			}

			await insertHabitHours(user_id, day_id, [{ hour: hour, half: half, name: text }]);
		}

		logOpen = false;
	}

	async function toggleTodo(user_id: string, hour: number, half: 0 | 1) {
		if (viewerUserId !== user_id) return;
		if (suppressNextClick) return;
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

	function cancelPendingMove() {
		if (isMoveSubmitting) return;
		pendingMove = null;
	}
	async function confirmPendingMove() {
		if (!pendingMove || isMoveSubmitting) return;
		isMoveSubmitting = true;
		try {
			const success = await moveSlot(pendingMove);
			if (success) pendingMove = null;
		} finally {
			isMoveSubmitting = false;
		}
	}
	async function moveSlot(move: PendingMove): Promise<boolean> {
		const { user_id, fromHour, fromHalf, toHour, toHalf } = move;
		if (viewerUserId !== user_id) return false;
		const day_id = dayIdByUser[user_id];
		if (!day_id) return false;
		if (!slotHasContent(user_id, fromHour, fromHalf)) return false;

		const sourceSlot = getSlot(user_id, fromHour, fromHalf);
		const sourceValue: SlotValue = {
			title: sourceSlot.title ?? '',
			todo: sourceSlot.todo
		};
		const destinationHadEntry = slotHasContent(user_id, toHour, toHalf);
		const sourceHabitName = (getHabitTitle(user_id, fromHour, fromHalf) ?? '').trim();
		const destinationHabitName = (getHabitTitle(user_id, toHour, toHalf) ?? '').trim();

		if (destinationHadEntry) {
			const { error: deleteDestErr } = await supabase
				.from('hours')
				.delete()
				.eq('day_id', day_id)
				.eq('hour', toHour)
				.eq('half', toHalf === 1);
			if (deleteDestErr) {
				console.error('slot move destination delete error', deleteDestErr);
				return false;
			}
		}

		const { error: updateErr } = await supabase
			.from('hours')
			.update({ hour: toHour, half: toHalf === 1 })
			.eq('day_id', day_id)
			.eq('hour', fromHour)
			.eq('half', fromHalf === 1);

		if (updateErr) {
			console.error('slot move error', updateErr);
			return false;
		}

		setTitle(user_id, toHour, toHalf, sourceValue.title, sourceValue.todo);
		setTitle(user_id, fromHour, fromHalf, '', null);

		if (destinationHabitName.length > 0) {
			const { error: deleteHabitErr } = await supabase
				.from('habits')
				.delete()
				.eq('user_id', user_id)
				.eq('hour', toHour)
				.eq('half', toHalf === 1);
			if (deleteHabitErr) {
				console.error('slot move destination habit delete error', deleteHabitErr);
			} else {
				setHabitTitle(user_id, toHour, toHalf, null);
			}
		}

		if (sourceHabitName.length > 0) {
			const { error: updateHabitErr } = await supabase
				.from('habits')
				.update({ hour: toHour, half: toHalf === 1 })
				.eq('user_id', user_id)
				.eq('hour', fromHour)
				.eq('half', fromHalf === 1);
			if (updateHabitErr) {
				console.error('habit move error', updateHabitErr);
			} else {
				setHabitTitle(user_id, fromHour, fromHalf, null);
				setHabitTitle(user_id, toHour, toHalf, sourceHabitName);
			}
		}

		return true;
	}

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
		if (lastPromptKey === key) return;

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
		const msLeft = minsToNext * 60_000 - (s * 1_000 + ms);
		return msLeft <= 0 ? 1_000 : msLeft;
	}

	function withinWindow(hour: number) {
		return hour >= START_HOUR && hour < END_HOUR;
	}

	function notifyCurrentSlot() {
		if (!viewerUserId || !('Notification' in window) || Notification.permission !== 'granted') {
			return;
		}

		const { hour, half } = slotInfoFromNow();
		if (!withinWindow(hour)) return;

		const blockLabel = half === 0 ? 'Block A' : 'Block B';
		const hourLabel = `${String(hour).padStart(2, '0')}:${half === 0 ? '00' : '30'}`;

		const rawTitle = getTitle(viewerUserId, hour, half);
		const titleTxt = (rawTitle ?? '').trim();

		const notifTitle = `${blockLabel} • ${hourLabel}`;
		const body = titleTxt ? `TODO: ${titleTxt}` : undefined;

		new Notification(notifTitle, {
			body,
			tag: `slot-${localToday()}-${hour}-${half}`,
			icon: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR4nGNgYAAAAAMAASsJTYQAAAAASUVORK5CYII=',
			requireInteraction: false,
			silent: false
		});
	}

	let notifTimer: number | null = null;
	function startHalfHourNotifier() {
		if (!ENABLE_NOTIFS) return;
		window.clearTimeout(notifTimer as unknown as number);

		const arm = async () => {
			const ok = await ensureNotifPermission();
			if (!ok) return;
			notifyCurrentSlot();
			window.clearTimeout(notifTimer as unknown as number);
			notifTimer = window.setTimeout(arm, msUntilNextBoundary());
		};

		notifTimer = window.setTimeout(arm, msUntilNextBoundary());
	}

	async function init() {
		try {
			const { data: authData, error: authErr } = await supabase.auth.getUser();
			if (authErr) throw authErr;
			viewerUserId = authData?.user?.id ?? null;
		} catch (authErr) {
			console.info('viewer not authenticated, continuing in read-only mode', authErr);
			viewerUserId = null;
		}
		if (!viewerUserId) {
			selectedSlot = null;
			hoverSlot = null;
		}

		try {
			const { data: rows, error: uerr } = await supabase
				.from('users')
				.select('id, display_name')
				.order('display_name', { ascending: true });
			if (uerr) throw uerr;

			people = (rows ?? []).map((r) => ({
				label: r.display_name as string,
				user_id: r.id as string
			}));

			updateTrackedPlayersFromPeople(people);
			startPlayerStatusWatchers(viewerUserId);
			startLocalPlayerPresenceIfTracked(viewerUserId);

			const perUserLoads = people.map(async ({ user_id }) => {
				const create = viewerUserId === user_id;
				const dayId = await getTodayDayIdForUser(user_id, create);
				dayIdByUser[user_id] = dayId;
				const tasks: Promise<void>[] = [loadHabitsForUser(user_id)];
				if (dayId) tasks.push(loadHoursForDay(user_id, dayId));
				await Promise.all(tasks);
				if (dayId) await ensureHabitHoursForDay(user_id, dayId);
			});

			const historyLoads = people.map(({ user_id }) => loadPlayerHistoryForUser(user_id));

			await Promise.all([...perUserLoads, ...historyLoads]);

			maybePromptForMissing();
			startHalfHourNotifier();
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
			currentMinute = now.getMinutes();
			currentHalf = now.getMinutes() < 30 ? 0 : 1;
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

	onDestroy(() => {
		stopPlayerStatusWatchers();
		stopLocalPlayerPresence?.();
	});
</script>

<div class="flex h-dvh w-full flex-col justify-center overflow-clip bg-stone-50 p-10">
	<div class="flex flex-row space-x-4">
		<div class="flex flex-col space-y-1">
			<div class="text-stone-50">T</div>
			{#each hours as h}
				<div
					class="flex h-7 items-center justify-center rounded px-1 text-stone-300"
					class:bg-stone-700={isCurrent(h)}
					class:text-white={isCurrent(h)}
				>
					{hh(h)}
				</div>
			{/each}
		</div>

		<div class="flex w-full flex-col">
			<div class="flex w-full flex-row gap-4">
				{#if isLoading}
					{#each loadingPlaceholderColumns as _}
						<div class="flex w-full flex-col space-y-1" aria-hidden="true">
							<div class="flex h-6 items-center gap-2">
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
						{@const trackedKey = getTrackedPlayerKeyForUser(person.user_id)}
						<div class="flex w-full flex-col space-y-1 transition-opacity">
							<div class="flex h-6 items-center gap-2">
								{#if trackedKey}
									<PlayerStatusTag
										label={playerDisplays[trackedKey]?.label ?? null}
										status={playerStatuses[trackedKey]}
										me={person.user_id === viewerUserId}
										streak={streakByUser[person.user_id] ?? null}
									/>
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
									<div
										class="hover:none flex h-7 w-full flex-row space-x-1"
										class:opacity-60={viewerUserId && viewerUserId !== person.user_id}
									>
										<div
											class="flex w-full min-w-0 bg-transparent"
											role="presentation"
											draggable={canDragSlot(person.user_id, h, 0)}
											onpointerdown={(e) =>
												handleSlotPointerDown(e, person.user_id, h, 0, hourIndex)}
											onpointerenter={() => handleSlotPointerEnter(person.user_id, hourIndex, 0)}
											onpointerleave={() => handleSlotPointerLeave(person.user_id, hourIndex, 0)}
											ondragstart={(event) => {
												handleSlotDragStart(event, person.user_id, h, 0, hourIndex);
											}}
											ondragover={(event) =>
												handleSlotDragOver(event, person.user_id, 0, hourIndex)}
											ondrop={(event) => handleSlotDrop(event, person.user_id, h, 0)}
											ondragend={handleSlotDragEnd}
										>
											<Slot
												title={getTitle(person.user_id, h, 0)}
												todo={getTodo(person.user_id, h, 0)}
												editable={viewerUserId === person.user_id}
												onSelect={() => openEditor(person.user_id, h, 0)}
												onToggleTodo={() => toggleTodo(person.user_id, h, 0)}
												habit={getHabitTitle(person.user_id, h, 0)}
												selected={slotIsHighlighted(person.user_id, hourIndex, 0)}
												isCurrent={slotIsCurrent(h, 0)}
											/>
										</div>
										<div
											class="flex w-full min-w-0 bg-transparent"
											role="presentation"
											draggable={canDragSlot(person.user_id, h, 1)}
											onpointerdown={(e) =>
												handleSlotPointerDown(e, person.user_id, h, 1, hourIndex)}
											onpointerenter={() => handleSlotPointerEnter(person.user_id, hourIndex, 1)}
											onpointerleave={() => handleSlotPointerLeave(person.user_id, hourIndex, 1)}
											ondragstart={(event) => {
												handleSlotDragStart(event, person.user_id, h, 1, hourIndex);
											}}
											ondragover={(event) =>
												handleSlotDragOver(event, person.user_id, 1, hourIndex)}
											ondrop={(event) => handleSlotDrop(event, person.user_id, h, 1)}
											ondragend={handleSlotDragEnd}
										>
											<Slot
												title={getTitle(person.user_id, h, 1)}
												todo={getTodo(person.user_id, h, 1)}
												editable={viewerUserId === person.user_id}
												onSelect={() => openEditor(person.user_id, h, 1)}
												onToggleTodo={() => toggleTodo(person.user_id, h, 1)}
												habit={getHabitTitle(person.user_id, h, 1)}
												selected={slotIsHighlighted(person.user_id, hourIndex, 1)}
												isCurrent={slotIsCurrent(h, 1)}
											/>
										</div>
									</div>
								{/each}
							{/if}
						</div>
					{/each}
				{/if}
			</div>
		</div>
	</div>
	{#if isNightWindow()}
		<div
			class="mt-1 flex h-7 w-full items-center justify-center rounded px-3 text-xs font-semibold tracking-wide text-stone-400 uppercase"
			class:bg-amber-200={isNightWindow}
			class:bg-stone-100={!isNightWindow}
			class:text-stone-900={isNightWindow}
		>
			{countdownText()}
		</div>
	{:else}
		<div
			class="mt-1 flex h-7 w-full items-center justify-center rounded px-3 text-xs font-semibold tracking-wide text-stone-400 uppercase"
			class:bg-stone-100={!isNightWindow}
		></div>
	{/if}
</div>

<LogModal
	open={logOpen}
	onClose={() => (logOpen = false)}
	onSave={saveLog}
	initialHour={draft.hour}
	initialHalf={draft.half}
/>

<ConfirmMoveModal
	open={pendingMove !== null}
	onCancel={cancelPendingMove}
	onConfirm={() => void confirmPendingMove()}
	slotLabel={pendingMoveSummary?.slotLabel ?? ''}
	fromLabel={pendingMoveSummary?.fromLabel ?? ''}
	toLabel={pendingMoveSummary?.toLabel ?? ''}
	destinationLabel={pendingMoveSummary?.destinationLabel ?? null}
	hasDestinationContent={pendingMoveSummary?.hasDestinationContent ?? false}
	isHabit={pendingMoveSummary?.isHabit ?? false}
	loading={isMoveSubmitting}
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
