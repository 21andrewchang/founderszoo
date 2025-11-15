<script lang="ts">
	import ConfirmMoveModal from '$lib/components/ConfirmMoveModal.svelte';
	import LogModal from '$lib/components/LogModal.svelte';
	import PlayerStatusTag from '$lib/components/PlayerStatusTag.svelte';
	import Slot from '$lib/components/Slot.svelte';
	import { scale, fly } from 'svelte/transition';
	import { watchPlayerStatus, trackPlayerPresence, type PlayerStatus } from '$lib/playerPresence';
	import { calculateStreak, type DayCompletionSummary, type PlayerStreak } from '$lib/streaks';
	import { TRACKED_PLAYERS, type TrackedPlayerKey } from '$lib/trackedPlayers';
	import { getContext, onDestroy, onMount } from 'svelte';
	import { supabase } from '$lib/supabaseClient';
	import type { Writable } from 'svelte/store';
	import type { Session } from '$lib/session';
	import { formatLocalTimestamp } from '$lib/time';

	type Person = { label: string; user_id: string };

	let people = $state<Person[]>([]);
	const session = getContext<Writable<Session>>('session');
	let isDragging = $state(false);
	let suppressNextClick = $state(false);

	type PlayerKey = TrackedPlayerKey;
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
	let showTimes = $state(false);

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
	const TOTAL_BLOCKS_PER_DAY = hours.length * 2; // 16 hours * 2 halves = 32 slots
	const STREAK_LOOKBACK_DAYS = 60;
	const DAY_MS = 86_400_000;
	const HABIT_STREAK_KEYS = ['read', 'gym', 'bored'] as const;
	type HabitKey = (typeof HABIT_STREAK_KEYS)[number];
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
	type PendingDelete = {
		user_id: string;
		hour: number;
		half: 0 | 1;
	};
	type CutSlot = {
		user_id: string;
		hour: number;
		half: 0 | 1;
		value: SlotValue;
		habitTitle: string | null;
	};

	const createEmptySlot = (): SlotValue => ({ title: '', todo: null });
	let slotsByUser = $state<Record<string, Record<number, SlotRow>>>({});
	let habitsByUser = $state<Record<string, Record<number, HabitSlotRow>>>({});
	let habitStreaksByUser = $state<Record<string, Record<HabitKey, PlayerStreak | null>>>({});
	let habitStreaksByUserExcludingToday = $state<
		Record<string, Record<HabitKey, PlayerStreak | null>>
	>({});
	let habitHasTodayEntryByUser = $state<Record<string, Record<HabitKey, boolean>>>({});

	let logOpen = $state(false);
	type TodoCarryoverPrompt = {
		user_id: string;
		prevHour: number;
		prevHalf: 0 | 1;
		currHour: number;
		currHalf: 0 | 1;
		title: string;
	};

	let todoCarryPrompt = $state<TodoCarryoverPrompt | null>(null);
	let isTodoCarrySubmitting = $state(false);
	type HabitPrompt = {
		user_id: string;
		habitHour: number;
		habitHalf: 0 | 1;
		currHour: number;
		currHalf: 0 | 1;
		habitName: string;
		habitKey: HabitKey | null;
	};
	let habitCheckPrompt = $state<HabitPrompt | null>(null);
	let isHabitPromptSubmitting = $state(false);
	function previousSlot(hour: number, half: 0 | 1): { hour: number; half: 0 | 1 } | null {
		if (half === 1) {
			// B → previous is same hour, A
			return { hour, half: 0 };
		}
		// A → previous is previous hour, B
		const prevHour = hour - 1;
		if (prevHour < START_HOUR) return null;
		return { hour: prevHour, half: 1 };
	}

	let draft = $state<{
		user_id: string | null;
		hour: number | null;
		half: 0 | 1 | null;
		title: string;
		todo: boolean | null;
	}>({
		user_id: null,
		hour: null,
		half: null,
		title: '',
		todo: null
	});
	let selectedSlot = $state<SelectedSlot | null>(null);
	let hjklSlot = $state<SelectedSlot | null>(null);
	let draggingSlot = $state<DraggingSlot | null>(null);
	let dragHoverSlot = $state<SelectedSlot | null>(null);
	let hoverSlot = $state<SelectedSlot | null>(null);
	let pendingMove = $state<PendingMove | null>(null);
	let pendingMoveSource = $state<'drag' | 'cut' | null>(null);
	let isMoveSubmitting = $state(false);
	let pendingDelete = $state<PendingDelete | null>(null);
	let isDeleteSubmitting = $state(false);
	let dragImageEl: HTMLElement | null = null;
	let cutSlot = $state<CutSlot | null>(null);
	const pendingMoveSummary = $derived.by(() => {
		if (!pendingMove) return null;
		const { user_id, fromHour, fromHalf, toHour, toHalf } = pendingMove;
		const sourceTitle = (getTitle(user_id, fromHour, fromHalf) ?? '').trim();
		const sourceHabit = (getHabitTitle(user_id, fromHour, fromHalf) ?? '').trim();
		const destinationTitle = (getTitle(user_id, toHour, toHalf) ?? '').trim();
		const destinationHabit = (getHabitTitle(user_id, toHour, toHalf) ?? '').trim();
		const destinationTodo = getTodo(user_id, toHour, toHalf);
		const destinationHasContent =
			destinationTitle.length > 0 || destinationHabit.length > 0 || destinationTodo !== null;
		const mode: 'swap' | 'move' = destinationHasContent ? 'swap' : 'move';
		return {
			slotLabel: sourceTitle || sourceHabit || 'this slot',
			fromLabel: formatSlotLabel(fromHour, fromHalf),
			toLabel: formatSlotLabel(toHour, toHalf),
			destinationLabel: destinationTitle || destinationHabit || null,
			hasDestinationContent: destinationHasContent,
			isHabit: sourceHabit.length > 0,
			mode
		};
	});
	const pendingDeleteSummary = $derived.by(() => {
		if (!pendingDelete) return null;
		const { user_id, hour, half } = pendingDelete;
		const title = (getTitle(user_id, hour, half) ?? '').trim();
		const habit = (getHabitTitle(user_id, hour, half) ?? '').trim();
		const todo = getTodo(user_id, hour, half);
		const hasContent = title.length > 0 || habit.length > 0 || todo !== null;
		return {
			slotLabel: title || habit || 'this slot',
			locationLabel: formatSlotLabel(hour, half),
			hasContent,
			isHabit: habit.length > 0
		};
	});

	const logModalHabitStreaks = $derived.by(() => {
		if (!viewerUserId) return emptyHabitStreakRecord();
		const h = draft.hour;
		const half = draft.half;
		if (h == null || half == null) {
			return habitStreaksForUser(viewerUserId);
		}
		return habitStreakRecordForSlot(viewerUserId, h, half);
	});

	const modalOverlayActive = $derived.by(
		() => Boolean(logOpen || habitCheckPrompt || todoCarryPrompt || pendingMove || pendingDelete)
	);

	// prevent re-prompting within same slot
	let lastPromptKey = $state<string | null>(null);

	const formatDateString = (date: Date) =>
		`${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
	const dateStringNDaysAgo = (days: number) => {
		const base = getNow();
		const d = new Date(base);
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
	function isCutSource(user_id: string, h: number, half01: 0 | 1) {
		return Boolean(
			cutSlot && cutSlot.user_id === user_id && cutSlot.hour === h && cutSlot.half === half01
		);
	}
	function slotIsCut(user_id: string, h: number, half01: 0 | 1) {
		return Boolean(
			cutSlot && cutSlot.user_id === user_id && cutSlot.hour === h && cutSlot.half === half01
		);
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
	type HabitDayStatus = { date: string; completed: boolean };
	function normalizeHabitName(value: string | null | undefined): HabitKey | null {
		const key = (value ?? '').trim().toLowerCase();
		return HABIT_STREAK_KEYS.includes(key as HabitKey) ? (key as HabitKey) : null;
	}
	function emptyHabitStreakRecord(): Record<HabitKey, PlayerStreak | null> {
		return HABIT_STREAK_KEYS.reduce(
			(acc, key) => {
				acc[key] = null;
				return acc;
			},
			{} as Record<HabitKey, PlayerStreak | null>
		);
	}
	function emptyHabitTodayEntryRecord(): Record<HabitKey, boolean> {
		return HABIT_STREAK_KEYS.reduce(
			(acc, key) => {
				acc[key] = false;
				return acc;
			},
			{} as Record<HabitKey, boolean>
		);
	}
	function habitStreaksForUser(user_id: string | null): Record<HabitKey, PlayerStreak | null> {
		if (!user_id) return emptyHabitStreakRecord();
		return habitStreaksByUser[user_id] ?? emptyHabitStreakRecord();
	}
	function parseHabitDate(dateStr: string): number | null {
		const parts = dateStr.split('-');
		if (parts.length !== 3) return null;
		const [yearStr, monthStr, dayStr] = parts;
		const year = Number(yearStr);
		const month = Number(monthStr);
		const day = Number(dayStr);
		if (Number.isNaN(year) || Number.isNaN(month) || Number.isNaN(day)) return null;
		const date = new Date();
		date.setFullYear(year, month - 1, day);
		date.setHours(0, 0, 0, 0);
		return date.getTime();
	}
	function calculateHabitStreak(records: HabitDayStatus[]): PlayerStreak | null {
		if (records.length === 0) return null;

		// Build date -> completed map and track bounds
		const byDate = new Map<string, boolean>();
		let earliestMs: number | null = null;
		let latestMs: number | null = null;

		for (const record of records) {
			const date = record.date;
			if (!date) continue;
			byDate.set(date, record.completed);

			const ms = parseHabitDate(date);
			if (ms === null) continue;
			earliestMs = earliestMs === null ? ms : Math.min(earliestMs, ms);
			latestMs = latestMs === null ? ms : Math.max(latestMs, ms);
		}

		if (byDate.size === 0 || earliestMs === null || latestMs === null) return null;

		const today = localToday();
		const todayMs = parseHabitDate(today);

		// Decide which day the streak is anchored on
		let anchorDateStr: string | null = null;
		let anchorMs: number | null = null;
		let targetCompleted: boolean | null = null;

		const todayCompleted = byDate.get(today);

		if (todayCompleted !== undefined && todayMs !== null) {
			// Today has an explicit entry (completed or missed) → include it
			anchorDateStr = today;
			anchorMs = todayMs;
			targetCompleted = todayCompleted;
		} else {
			// Today not done → ignore it, anchor on latest day < today
			let cursorMs = latestMs;
			while (true) {
				const cursorDate = formatDateString(new Date(cursorMs));

				// Only consider strictly before today
				if (cursorDate < today && byDate.has(cursorDate)) {
					anchorDateStr = cursorDate;
					anchorMs = cursorMs;
					targetCompleted = byDate.get(cursorDate)!;
					break;
				}

				cursorMs -= DAY_MS;
				if (cursorMs < earliestMs) break;
			}
			if (anchorDateStr === null || anchorMs === null || targetCompleted === null) {
				return null;
			}
		}

		// Walk backwards from the anchor while values match
		let streakLength = 0;
		let cursorMs2 = anchorMs;

		while (true) {
			const cursorDate = formatDateString(new Date(cursorMs2));
			const value = byDate.get(cursorDate);
			if (value === undefined || value !== targetCompleted) break;

			streakLength += 1;
			cursorMs2 -= DAY_MS;
			if (cursorMs2 < earliestMs) break;
		}

		return {
			kind: targetCompleted ? 'positive' : 'negative',
			length: streakLength,
			missesOnLatest: targetCompleted ? 0 : 1
		};
	}

	function habitStreakRecordForSlot(user_id: string, h: number, half01: 0 | 1): Record<HabitKey, PlayerStreak | null> {
		const record = habitStreaksByUser[user_id] ?? emptyHabitStreakRecord();
		const fallbackRecord = habitStreaksByUserExcludingToday[user_id] ?? record;
		const hasTodayEntry = habitHasTodayEntryByUser[user_id] ?? emptyHabitTodayEntryRecord();
		const slotElapsed = slotHasElapsed(h, half01);
		return HABIT_STREAK_KEYS.reduce((acc, key) => {
			const promptActive =
				habitCheckPrompt &&
				habitCheckPrompt.user_id === user_id &&
				habitCheckPrompt.habitHour === h &&
				habitCheckPrompt.habitHalf === half01 &&
				habitCheckPrompt.habitKey === key;
			if (promptActive) {
				acc[key] = (fallbackRecord ?? record)?.[key] ?? null;
				return acc;
			}
			const useCurrent = slotElapsed && hasTodayEntry[key];
			const source = useCurrent ? record : fallbackRecord;
			acc[key] = source?.[key] ?? null;
			return acc;
		}, {} as Record<HabitKey, PlayerStreak | null>);
	}

	function habitStreakForSlot(user_id: string, h: number, half01: 0 | 1): PlayerStreak | null {
		const habitName = getHabitTitle(user_id, h, half01);
		const key = normalizeHabitName(habitName);
		if (!key) return null;
		const view = habitStreakRecordForSlot(user_id, h, half01);
		return view[key] ?? null;
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
		if (isCutSource(user_id, h, half01)) return false;
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
	function cancelCutSlot() {
		cutSlot = null;
	}
	function cutSlotAt(user_id: string, hour: number, half: 0 | 1) {
		if (!viewerUserId || viewerUserId !== user_id) return false;
		const habitName = (getHabitTitle(user_id, hour, half) ?? '').trim();
		if (!slotHasContent(user_id, hour, half)) return false;
		if (habitName.length > 0) return false;
		const sourceValue = getSlot(user_id, hour, half);
		cutSlot = {
			user_id,
			hour,
			half,
			value: { title: sourceValue.title ?? '', todo: sourceValue.todo },
			habitTitle: habitName.length > 0 ? habitName : null
		};
		const hourIndex = getHourIndex(hour);
		if (hourIndex !== -1) {
			setSelectedSlot({ hourIndex, half });
		}
		return true;
	}
	function cutSelectedSlot() {
		if (!viewerUserId || !selectedSlot) return false;
		const hour = hours[selectedSlot.hourIndex];
		if (hour === undefined) return false;
		return cutSlotAt(viewerUserId, hour, selectedSlot.half);
	}
	function pasteCutSlotToTarget(hour: number, half: 0 | 1) {
		if (!cutSlot) return false;
		const { user_id, hour: fromHour, half: fromHalf } = cutSlot;
		if (hour === fromHour && half === fromHalf) {
			cancelCutSlot();
			return true;
		}
		const move: PendingMove = {
			user_id,
			fromHour,
			fromHalf,
			toHour: hour,
			toHalf: half
		};
		if (shouldConfirmMove(move)) {
			pendingMove = move;
			pendingMoveSource = 'cut';
		} else {
			pendingMoveSource = 'cut';
			void submitMove(move, 'cut');
		}
		return true;
	}
	function pasteCutSlotAtSelection() {
		if (!viewerUserId || !cutSlot || !selectedSlot) return false;
		const hour = hours[selectedSlot.hourIndex];
		if (hour === undefined) return false;
		return pasteCutSlotToTarget(hour, selectedSlot.half);
	}
	function maybeHandlePaste(user_id: string, hour: number, half: 0 | 1) {
		if (!viewerUserId || viewerUserId !== user_id) return false;
		if (!cutSlot || cutSlot.user_id !== user_id) return false;
		return pasteCutSlotToTarget(hour, half);
	}

	function moveSelectionVertical(delta: 1 | -1) {
		if (!viewerUserId || !selectedSlot) return false;
		const nextIndex = selectedSlot.hourIndex + delta;
		if (nextIndex < 0 || nextIndex >= hours.length) return false;
		setSelectedSlot({ hourIndex: nextIndex, half: selectedSlot.half });
		return true;
	}
	function promptDeleteSelectedSlot() {
		if (!viewerUserId || !selectedSlot) return false;
		const hour = hours[selectedSlot.hourIndex];
		if (hour === undefined) return false;
		if (!slotHasContent(viewerUserId, hour, selectedSlot.half)) return false;
		pendingDelete = {
			user_id: viewerUserId,
			hour,
			half: selectedSlot.half
		};
		return true;
	}

	function activateSelectedSlotFromKeyboard() {
		if (!viewerUserId || !selectedSlot) return false;
		const hour = hours[selectedSlot.hourIndex];
		if (hour === undefined) return false;
		if (maybeHandlePaste(viewerUserId, hour, selectedSlot.half)) return true;
		const todoValue = getTodo(viewerUserId, hour, selectedSlot.half);
		if (todoValue !== null) {
			void toggleTodo(viewerUserId, hour, selectedSlot.half);
			return true;
		}

		const habitName = getHabitTitle(viewerUserId, hour, selectedSlot.half);
		if ((habitName ?? '').trim().length > 0) return true;

		const title = getTitle(viewerUserId, hour, selectedSlot.half);
		if (title.trim().length > 0) return false;
		return true;
	}

	function openSelectedSlotEditorFromKeyboard(normal: boolean) {
		if (!viewerUserId || !selectedSlot) return false;
		const hour = hours[selectedSlot.hourIndex];
		if (hour === undefined) return false;
		if (maybeHandlePaste(viewerUserId, hour, selectedSlot.half)) return true;
		const habitName = getHabitTitle(viewerUserId, hour, selectedSlot.half);
		if ((habitName ?? '').trim().length > 0) return false;
		openEditor(viewerUserId, hour, selectedSlot.half, normal);
		return true;
	}
	function handleSlotSelect(user_id: string, hour: number, half: 0 | 1, normal: boolean) {
		if (maybeHandlePaste(user_id, hour, half)) return;
		openEditor(user_id, hour, half, normal);
	}
	function handleSlotToggle(user_id: string, hour: number, half: 0 | 1) {
		if (maybeHandlePaste(user_id, hour, half)) return;
		void toggleTodo(user_id, hour, half);
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
		const move: PendingMove = {
			user_id,
			fromHour: source.hour,
			fromHalf: source.half,
			toHour: hour,
			toHalf: half
		};
		if (shouldConfirmMove(move)) {
			pendingMove = move;
			pendingMoveSource = 'drag';
		} else {
			void submitMove(move, 'drag');
		}
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
		if (draggingSlot) return;
		setSelectedSlot({ hourIndex, half });
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
			if (cutSlot) {
				cancelCutSlot();
				event.preventDefault();
				return;
			}
			if (hjklSlot) {
				setSelectedSlot(hjklSlot);
				hjklSlot = null;
				event.preventDefault();
				return;
			}
			if (selectedSlot) {
				setSelectedSlot(null);
				event.preventDefault();
			}
			return;
		}
		if (!['h', 'j', 'k', 'l', 'Enter', 'i', 'n', 'd', 'x', 'p'].includes(normalized)) return;
		hoverSlot = null;
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
				hjklSlot = selectedSlot;
				handled = activateSelectedSlotFromKeyboard();
				break;
			case 'i':
				hjklSlot = selectedSlot;
				handled = openSelectedSlotEditorFromKeyboard(false);
				break;
			case 'n':
				hjklSlot = selectedSlot;
				handled = openSelectedSlotEditorFromKeyboard(true);
				break;
			case 'd':
				handled = promptDeleteSelectedSlot();
				break;
			case 'x':
				handled = cutSelectedSlot();
				break;
			case 'p':
				handled = pasteCutSlotAtSelection();
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
		const createdAt = formatLocalTimestamp(getNow());
		const { data: created, error: insErr } = await supabase
			.from('days')
			.insert({ user_id, date: today, created_at: createdAt })
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
	async function loadHabitStreaksForUser(user_id: string) {
		const lookbackStart = dateStringNDaysAgo(STREAK_LOOKBACK_DAYS);
		try {
			const { data, error } = await supabase
				.from('habit_day_status')
				.select('habit_name, day, completed')
				.eq('user_id', user_id)
				.gte('day', lookbackStart);
			if (error) throw error;
			const grouped = HABIT_STREAK_KEYS.reduce(
				(acc, key) => {
					acc[key] = [] as HabitDayStatus[];
					return acc;
				},
				{} as Record<HabitKey, HabitDayStatus[]>
			);
			for (const row of data ?? []) {
				const key = normalizeHabitName(row.habit_name as string | null);
				if (!key) continue;
				const day = row.day as string | null;
				if (!day) continue;
				const completed = Boolean(row.completed);
				grouped[key].push({
					date: day,
					completed
				});
			}
			const today = localToday();
			const streakRecord = HABIT_STREAK_KEYS.reduce(
				(acc, key) => {
					const summaries = grouped[key];
					acc[key] = summaries.length === 0 ? null : calculateHabitStreak(summaries);
					return acc;
				},
				{} as Record<HabitKey, PlayerStreak | null>
			);
			const streakRecordExcludingToday = HABIT_STREAK_KEYS.reduce(
				(acc, key) => {
					const summaries = grouped[key];
					const filtered = summaries.filter((record) => record.date !== today);
					acc[key] = filtered.length === 0 ? null : calculateHabitStreak(filtered);
					return acc;
				},
				{} as Record<HabitKey, PlayerStreak | null>
			);
			const hasToday = HABIT_STREAK_KEYS.reduce(
				(acc, key) => {
					acc[key] = grouped[key].some((record) => record.date === today);
					return acc;
				},
				{} as Record<HabitKey, boolean>
			);
			habitStreaksByUser = { ...habitStreaksByUser, [user_id]: streakRecord };
			habitStreaksByUserExcludingToday = {
				...habitStreaksByUserExcludingToday,
				[user_id]: streakRecordExcludingToday
			};
			habitHasTodayEntryByUser = { ...habitHasTodayEntryByUser, [user_id]: hasToday };
		} catch (error) {
			console.error('load habit streak error', { user_id, error });
			const empty = emptyHabitStreakRecord();
			habitStreaksByUser = { ...habitStreaksByUser, [user_id]: empty };
			habitStreaksByUserExcludingToday = { ...habitStreaksByUserExcludingToday, [user_id]: empty };
			habitHasTodayEntryByUser = {
				...habitHasTodayEntryByUser,
				[user_id]: emptyHabitTodayEntryRecord()
			};
		}
	}
	function slotHasElapsed(hour: number, half: 0 | 1) {
		if (currentHour < 0) return false;
		if (currentHour > hour) return true;
		if (currentHour === hour && currentHalf > half) return true;
		return false;
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

	let editorMode = $state(false);
	function openEditor(user_id: string, h: number, half01: 0 | 1, normal?: boolean) {
		if (viewerUserId !== user_id) return;
		const hourIndex = getHourIndex(h);
		if (hourIndex !== -1) {
			setSelectedSlot({ hourIndex, half: half01 });
		}
		const slot = getSlot(user_id, h, half01);
		draft = {
			user_id,
			hour: h,
			half: half01,
			title: slot.title ?? '',
			todo: slot.todo ?? null
		};
		editorMode = normal ?? editorMode;
		logOpen = true;
	}

	async function saveLog(text: string, todo: boolean | null, hour: number, half: 0 | 1) {
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

		logOpen = false;
	}

	async function toggleTodo(user_id: string, hour: number, half: 0 | 1) {
		if (viewerUserId !== user_id) return;
		if (suppressNextClick) return;
		const day_id = dayIdByUser[user_id];
		if (!day_id) return;
		const habitName = getHabitTitle(user_id, hour, half);
		const habitKey = normalizeHabitName(habitName);
		const isHabitSlot = habitKey !== null;
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
		if (isHabitSlot) {
			void loadHabitStreaksForUser(user_id);
		}
	}

	function cancelPendingMove() {
		if (isMoveSubmitting) return;
		pendingMove = null;
		pendingMoveSource = null;
	}
	async function confirmPendingMove() {
		if (!pendingMove) return;
		const move = pendingMove;
		const source = pendingMoveSource;
		const success = await submitMove(move, source);
		if (success) {
			pendingMove = null;
			pendingMoveSource = null;
		}
	}
	function shouldConfirmMove(move: PendingMove) {
		const { user_id, fromHour, fromHalf, toHour, toHalf } = move;
		const sourceHabitName = (getHabitTitle(user_id, fromHour, fromHalf) ?? '').trim();
		if (sourceHabitName.length > 0) return true;
		return slotHasContent(user_id, toHour, toHalf);
	}
	async function submitMove(move: PendingMove, source: 'drag' | 'cut' | null = null): Promise<boolean> {
		isMoveSubmitting = true;
		try {
			const success = await moveSlot(move);
			if (success && source === 'cut') {
				if (viewerUserId === move.user_id) {
					const hourIndex = getHourIndex(move.toHour);
					if (hourIndex !== -1) {
						setSelectedSlot({ hourIndex, half: move.toHalf });
					}
				}
				cancelCutSlot();
			}
			if (success && pendingMoveSource === source) {
				pendingMoveSource = null;
			}
			return success;
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
	const destinationSlotValue = destinationHadEntry ? getSlot(user_id, toHour, toHalf) : null;
	const destinationValue: SlotValue | null = destinationSlotValue
		? { title: destinationSlotValue.title ?? '', todo: destinationSlotValue.todo }
		: null;
	const destinationHasHoursContent =
		destinationValue !== null &&
		((destinationValue.title ?? '').trim().length > 0 || destinationValue.todo !== null);
	const sourceHabitName = (getHabitTitle(user_id, fromHour, fromHalf) ?? '').trim();
	const destinationHabitName = (getHabitTitle(user_id, toHour, toHalf) ?? '').trim();

	if (destinationHasHoursContent) {
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
	if (destinationHasHoursContent && destinationValue) {
		const { error: swapInsertErr } = await supabase
			.from('hours')
			.upsert(
				{
					day_id,
					hour: fromHour,
					half: fromHalf === 1,
					title: destinationValue.title ?? '',
					todo: destinationValue.todo
				},
				{ onConflict: 'day_id,hour,half' }
			);
		if (swapInsertErr) {
			console.error('slot swap insert error', swapInsertErr);
		}
		setTitle(user_id, fromHour, fromHalf, destinationValue.title ?? '', destinationValue.todo);
	} else {
		setTitle(user_id, fromHour, fromHalf, '', null);
	}

	if (destinationHabitName.length > 0) {
		const { error: deleteHabitErr } = await supabase
			.from('habits')
			.delete()
			.eq('user_id', user_id)
			.eq('hour', toHour)
			.eq('half', toHalf === 1);
		if (deleteHabitErr) {
			console.error('slot move destination habit delete error', deleteHabitErr);
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
		}
	}

	if (destinationHabitName.length > 0) {
		const { error: insertHabitErr } = await supabase
			.from('habits')
			.upsert(
				{
					user_id,
					name: destinationHabitName,
					hour: fromHour,
					half: fromHalf === 1
				},
				{ onConflict: 'user_id,hour,half' }
			);
		if (insertHabitErr) {
			console.error('habit swap insert error', insertHabitErr);
		}
	}

	const nextDestinationHabit = sourceHabitName.length > 0 ? sourceHabitName : null;
	const nextSourceHabit = destinationHabitName.length > 0 ? destinationHabitName : null;
	setHabitTitle(user_id, toHour, toHalf, nextDestinationHabit);
	setHabitTitle(user_id, fromHour, fromHalf, nextSourceHabit);

	return true;
	}

	function cancelPendingDelete() {
		if (isDeleteSubmitting) return;
		pendingDelete = null;
	}
	async function confirmPendingDelete() {
		if (!pendingDelete || isDeleteSubmitting) return;
		isDeleteSubmitting = true;
		try {
			const success = await deleteSlot(pendingDelete);
			if (success) pendingDelete = null;
		} finally {
			isDeleteSubmitting = false;
		}
	}
	async function deleteSlot(action: PendingDelete): Promise<boolean> {
		const { user_id, hour, half } = action;
		if (viewerUserId !== user_id) return false;
		const day_id = dayIdByUser[user_id];
		if (day_id) {
			const { error } = await supabase
				.from('hours')
				.delete()
				.eq('day_id', day_id)
				.eq('hour', hour)
				.eq('half', half === 1);
			if (error) {
				console.error('slot delete error', error);
				return false;
			}
		}

		setTitle(user_id, hour, half, '', null);
		return true;
	}

	function slotKey(u: string, date: string, h: number, half: 0 | 1) {
		return `${u}|${date}|${h}|${half}`;
	}

	function maybePromptForMissing() {
		if (!viewerUserId || logOpen || todoCarryPrompt || habitCheckPrompt) return;

		const date = localToday();
		const h = currentHour;
		const half = currentHalf;

		if (h < START_HOUR || h >= END_HOUR) return;

		// If the current slot already has *anything*, don't prompt
		if (slotHasContent(viewerUserId, h, half)) return;

		const key = slotKey(viewerUserId, date, h, half);
		if (lastPromptKey === key) return;

		// 1) Check if previous slot was an *unfinished* TODO
		const prev = previousSlot(h, half);
		if (prev) {
			const { hour: prevHour, half: prevHalf } = prev;
			const prevTodo = getTodo(viewerUserId, prevHour, prevHalf);
			const prevTitle = getTitle(viewerUserId, prevHour, prevHalf).trim();
			const prevHabitName = (getHabitTitle(viewerUserId, prevHour, prevHalf) ?? '').trim();
			const prevHabitKey = normalizeHabitName(prevHabitName);

			if (prevHabitKey && prevTodo === false) {
				habitCheckPrompt = {
					user_id: viewerUserId,
					habitHour: prevHour,
					habitHalf: prevHalf,
					currHour: h,
					currHalf: half,
					habitName: prevHabitName || prevTitle,
					habitKey: prevHabitKey
				};
				lastPromptKey = key;
				return;
			}

			// Only prompt if previous slot is a TODO that is still unfinished (todo === false)
			if (prevTodo === false && prevTitle.length > 0) {
				todoCarryPrompt = {
					user_id: viewerUserId,
					prevHour,
					prevHalf,
					currHour: h,
					currHalf: half,
					title: prevTitle
				};
				lastPromptKey = key; // avoid re-prompting for this slot
				return;
			}
		}

		// 2) Normal behavior: if current slot is empty, open the editor
		const t = getTitle(viewerUserId, h, half);
		if (!t || t.trim() === '') {
			openEditor(viewerUserId, h, half, false);
			lastPromptKey = key;
		}
	}

	async function markPreviousTodoCompletedAndOpenCurrent() {
		if (!todoCarryPrompt) return;
		if (isTodoCarrySubmitting) return;
		isTodoCarrySubmitting = true;

		const { user_id, prevHour, prevHalf, currHour, currHalf } = todoCarryPrompt;
		try {
			const day_id = dayIdByUser[user_id];
			if (!day_id) return;

			const prevSlot = getSlot(user_id, prevHour, prevHalf);

			// Mark previous as completed (todo = true)
			const { error } = await supabase.from('hours').upsert(
				{
					day_id,
					hour: prevHour,
					half: prevHalf === 1,
					title: prevSlot.title ?? '',
					todo: true
				},
				{ onConflict: 'day_id,hour,half' }
			);

			if (error) {
				console.error('mark previous todo completed error', error);
				return;
			}

			setTodo(user_id, prevHour, prevHalf, true);

			// Close prompt and open editor for the current slot
			todoCarryPrompt = null;
			openEditor(user_id, currHour, currHalf, false);
		} finally {
			isTodoCarrySubmitting = false;
		}
	}

	async function continuePreviousTodoIntoCurrent() {
		if (!todoCarryPrompt) return;
		if (isTodoCarrySubmitting) return;
		isTodoCarrySubmitting = true;

		const { user_id, prevHour, prevHalf, currHour, currHalf, title } = todoCarryPrompt;
		try {
			const day_id = dayIdByUser[user_id];
			if (!day_id) return;

			const prevSlot = getSlot(user_id, prevHour, prevHalf);

			// 1) Turn previous into a normal slot (todo = null, keep title)
			{
				const { error } = await supabase.from('hours').upsert(
					{
						day_id,
						hour: prevHour,
						half: prevHalf === 1,
						title: prevSlot.title ?? '',
						todo: null
					},
					{ onConflict: 'day_id,hour,half' }
				);
				if (error) {
					console.error('clear previous todo error', error);
					return;
				}
				setTodo(user_id, prevHour, prevHalf, null);
			}

			// 2) Copy into current slot as a new TODO
			{
				const { error } = await supabase.from('hours').upsert(
					{
						day_id,
						hour: currHour,
						half: currHalf === 1,
						title,
						todo: false
					},
					{ onConflict: 'day_id,hour,half' }
				);
				if (error) {
					console.error('create continued todo in current slot error', error);
					return;
				}
				setTitle(user_id, currHour, currHalf, title, false);
			}

			todoCarryPrompt = null;
			// You can choose whether to auto-open the editor here.
			// Spec says just copy it, so no openEditor() call.
		} finally {
			isTodoCarrySubmitting = false;
		}
	}

	function cancelTodoCarryPrompt() {
		if (isTodoCarrySubmitting) return;
		todoCarryPrompt = null;
	}

	async function resolveHabitPrompt(completed: boolean) {
		if (!habitCheckPrompt || isHabitPromptSubmitting) return;
		isHabitPromptSubmitting = true;

		const { user_id, habitHour, habitHalf, currHour, currHalf, habitKey } = habitCheckPrompt;
		try {
			const day_id = dayIdByUser[user_id];
			if (!day_id) return;
			const slot = getSlot(user_id, habitHour, habitHalf);
			const { error } = await supabase.from('hours').upsert(
				{
					day_id,
					hour: habitHour,
					half: habitHalf === 1,
					title: slot.title ?? '',
					todo: completed
				},
				{ onConflict: 'day_id,hour,half' }
			);
			if (error) {
				console.error('habit prompt update error', error);
				return;
			}
			setTodo(user_id, habitHour, habitHalf, completed);
			habitCheckPrompt = null;
			void loadHabitStreaksForUser(user_id);
		} finally {
			isHabitPromptSubmitting = false;
		}
		openEditor(user_id, currHour, currHalf, false);
	}

	function updateCurrentTime() {
		const now = getNow();
		currentHour = now.getHours();
		currentMinute = now.getMinutes();
		currentHalf = now.getMinutes() < 30 ? 0 : 1;
		maybePromptForMissing();
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
	function msUntilNextMinute() {
		const now = getNow();
		const elapsed = now.getSeconds() * 1_000 + now.getMilliseconds();
		const remaining = 60_000 - elapsed;
		return remaining <= 0 ? 1_000 : remaining;
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
	let clockTimer: number | null = null;
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
	function scheduleClockTick() {
		window.clearTimeout(clockTimer as unknown as number);
		const delay = msUntilNextMinute();
		clockTimer = window.setTimeout(() => {
			updateCurrentTime();
			scheduleClockTick();
		}, delay);
	}
	function stopClockTick() {
		window.clearTimeout(clockTimer as unknown as number);
		clockTimer = null;
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
			cancelCutSlot();
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
				const tasks: Promise<void>[] = [
					loadHabitsForUser(user_id),
					loadHabitStreaksForUser(user_id)
				];
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
		updateCurrentTime();
		scheduleClockTick();
		init();
		const keyHandler = (event: KeyboardEvent) => handleGlobalKeydown(event);
		window.addEventListener('keydown', keyHandler);
		requestAnimationFrame(() => (showTimes = true));
		return () => {
			stopClockTick();
			window.removeEventListener('keydown', keyHandler);
		};
	});

	onDestroy(() => {
		stopPlayerStatusWatchers();
		stopLocalPlayerPresence?.();
	});
</script>

<div class="flex h-dvh w-full flex-col justify-center overflow-clip bg-white p-10 pt-20 select-none">
	<div class="flex flex-row space-x-4">
		{#if isLoading}
			<div class="flex flex-col space-y-1">
				<div class="text-stone-50">T</div>
				{#each hours as h, i}
					<div class="relative flex h-7 w-7 items-center justify-center"></div>
				{/each}
			</div>
		{:else}
			<div class="flex flex-col space-y-1">
				<div class="text-stone-50">T</div>
				{#each hours as h, i}
					<div class="relative flex h-7 w-7 items-center justify-center">
						{#if showTimes}
							<div
								class="z-20 flex h-7 items-center justify-center rounded px-1 text-stone-300"
								in:fly|global={{ x: 8, duration: 400, delay: 40 * i + 200 }}
							>
								{hh(h)}
							</div>
						{/if}
						{#if isCurrent(h)}
							<div
								class="absolute h-7 w-7 rounded-md bg-stone-700"
								in:scale|global={{ start: 0.6, duration: 100, delay: 1000 }}
							></div>
						{/if}
					</div>
				{/each}
			</div>
		{/if}

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
									{@const slotIsCutA = slotIsCut(person.user_id, h, 0)}
									{@const slotIsCutB = slotIsCut(person.user_id, h, 1)}
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
												onPrimaryAction={() => maybeHandlePaste(person.user_id, h, 0)}
												onSelect={() => handleSlotSelect(person.user_id, h, 0, false)}
												onToggleTodo={() => handleSlotToggle(person.user_id, h, 0)}
												habit={getHabitTitle(person.user_id, h, 0)}
												habitStreak={habitStreakForSlot(person.user_id, h, 0)}
												selected={slotIsHighlighted(person.user_id, hourIndex, 0)}
												isCurrent={slotIsCurrent(h, 0)}
												isCut={slotIsCutA}
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
												onPrimaryAction={() => maybeHandlePaste(person.user_id, h, 1)}
												onSelect={() => handleSlotSelect(person.user_id, h, 1, false)}
												onToggleTodo={() => handleSlotToggle(person.user_id, h, 1)}
												habit={getHabitTitle(person.user_id, h, 1)}
												habitStreak={habitStreakForSlot(person.user_id, h, 1)}
												selected={slotIsHighlighted(person.user_id, hourIndex, 1)}
												isCurrent={slotIsCurrent(h, 1)}
												isCut={slotIsCutB}
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

{#if modalOverlayActive}
	<div class="pointer-events-none fixed inset-0 z-40 bg-black/40" aria-hidden="true"></div>
{/if}

<LogModal
	normal={editorMode}
	open={logOpen}
	onClose={() => (logOpen = false)}
	onSave={saveLog}
	initialHour={draft.hour}
	initialHalf={draft.half}
	initialTitle={draft.title}
	initialTodo={draft.todo}
	habitStreaks={logModalHabitStreaks}
/>

{#if habitCheckPrompt}
	<div class="fixed inset-0 z-60 flex items-center justify-center">
		<div class="w-full max-w-sm rounded-lg bg-white p-4 shadow-lg">
			<div class="text-xs font-semibold tracking-wide text-stone-500 uppercase">
				Habit check
			</div>
			<div class="mt-1 text-sm font-medium text-stone-900">
				Did you complete {habitCheckPrompt.habitName}?
			</div>

			<div class="mt-4 flex justify-end gap-2">
				<button
					type="button"
					class="rounded-md border border-stone-300 px-3 py-1 text-xs font-medium text-stone-700 hover:bg-stone-100 disabled:opacity-60"
					onclick={() => void resolveHabitPrompt(false)}
					disabled={isHabitPromptSubmitting}
				>
					No
				</button>
				<button
					type="button"
					class="rounded-md bg-stone-900 px-3 py-1 text-xs font-semibold text-white hover:bg-stone-800 disabled:opacity-60"
					onclick={() => void resolveHabitPrompt(true)}
					disabled={isHabitPromptSubmitting}
				>
					Yes
				</button>
			</div>
		</div>
	</div>
{/if}

{#if todoCarryPrompt}
	<div class="fixed inset-0 z-60 flex items-center justify-center">
		<div class="w-full max-w-sm rounded-lg bg-white p-4 shadow-lg">
			<div class="text-xs font-semibold tracking-wide text-stone-500 uppercase">
				Previous block TODO
			</div>
			<div class="mt-1 text-sm font-medium text-stone-900">Did you complete this?</div>
			<div class="mt-2 truncate text-sm text-stone-700">
				{todoCarryPrompt?.title}
			</div>

			<div class="mt-4 flex justify-end gap-2">
				<button
					type="button"
					class="rounded-md border border-stone-300 px-3 py-1 text-xs font-medium text-stone-700 hover:bg-stone-100"
					onclick={continuePreviousTodoIntoCurrent}
					disabled={isTodoCarrySubmitting}
				>
					Continue this block
				</button>
				<button
					type="button"
					class="rounded-md bg-stone-900 px-3 py-1 text-xs font-semibold text-white hover:bg-stone-800 disabled:opacity-60"
					onclick={markPreviousTodoCompletedAndOpenCurrent}
					disabled={isTodoCarrySubmitting}
				>
					Mark done
				</button>
			</div>

			<button
				type="button"
				class="mt-2 text-xs text-stone-400 hover:text-stone-600"
				onclick={cancelTodoCarryPrompt}
				disabled={isTodoCarrySubmitting}
			>
				Cancel
			</button>
		</div>
	</div>
{/if}
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
	mode={pendingMoveSummary?.mode ?? 'move'}
	loading={isMoveSubmitting}
/>
<ConfirmMoveModal
	open={pendingDelete !== null}
	onCancel={cancelPendingDelete}
	onConfirm={() => void confirmPendingDelete()}
	slotLabel={pendingDeleteSummary?.slotLabel ?? ''}
	fromLabel={pendingDeleteSummary?.locationLabel ?? ''}
	toLabel={pendingDeleteSummary?.locationLabel ?? ''}
	destinationLabel={null}
	hasDestinationContent={pendingDeleteSummary?.hasContent ?? false}
	isHabit={pendingDeleteSummary?.isHabit ?? false}
	mode="delete"
	loading={isDeleteSubmitting}
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
