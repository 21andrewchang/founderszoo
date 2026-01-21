<script lang="ts">
	import ConfirmMoveModal from '$lib/components/ConfirmMoveModal.svelte';
	import LogModal from '$lib/components/LogModal.svelte';
	import PlayerStatusTag from '$lib/components/PlayerStatusTag.svelte';
	import Block from '$lib/components/Block.svelte';
	import { scale, fly } from 'svelte/transition';
	import { watchPlayerStatus, trackPlayerPresence, type PlayerStatus } from '$lib/playerPresence';
	import { calculateStreak, type DayCompletionSummary, type PlayerStreak } from '$lib/streaks';
	import { TRACKED_PLAYERS, type TrackedPlayerKey } from '$lib/trackedPlayers';
	import { getContext, onDestroy, onMount } from 'svelte';
	import { supabase } from '$lib/supabaseClient';
	import type { Writable } from 'svelte/store';
	import type { Session } from '$lib/session';
	import { formatLocalTimestamp } from '$lib/time';
	import type { RealtimeChannel, RealtimePostgresChangesPayload } from '@supabase/supabase-js';

	type Person = { label: string; user_id: string };

	let people = $state<Person[]>([]);
	const session = getContext<Writable<Session>>('session');
	const activeDayDateStore = getContext<Writable<string | null>>('activeDayDate');
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
	const TOTAL_BLOCKS_PER_DAY = hours.length * 2;
	const STREAK_LOOKBACK_DAYS = 60;
	const DAY_MS = 86_400_000;
	const MONTHS = [
		'January',
		'February',
		'March',
		'April',
		'May',
		'June',
		'July',
		'August',
		'September',
		'October',
		'November',
		'December'
	];
	const HABIT_STREAK_KEYS = ['read', 'gym', 'bored', 'wake'] as const;
	type HabitKey = (typeof HABIT_STREAK_KEYS)[number];
	const loadingPlaceholderColumns = Array.from({ length: 2 });
	const hh = (n: number) => n.toString().padStart(2, '0');
	const blockLabelText = (half: 0 | 1) => (half === 0 ? 'Block A' : 'Block B');
	const blockTimeLabel = (hour: number, half: 0 | 1) => `${hh(hour)}:${half === 0 ? '00' : '30'}`;
	const formatBlockLabel = (hour: number, half: 0 | 1) =>
		`${blockTimeLabel(hour, half)} (${blockLabelText(half)})`;

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
	let activeDayDateByUser = $state<Record<string, string | null>>({});
	let spectatorDate = $state<string | null>(null);
	let isLoading = $state(true);

	type ReviewCategoryBreakdown = {
		key: 'body' | 'social' | 'work' | 'admin';
		label: string;
		percent: number;
		hours: number;
	};
	type ReviewStats = {
		planned: number;
		completed: number;
		productiveHours: number;
		score: number;
		categoryBreakdown: ReviewCategoryBreakdown[];
	};
	let reviewOpen = $state(false);
	let reviewStats = $state<ReviewStats | null>(null);
	let reviewDayDate = $state<string | null>(null);
	let reviewSubmitting = $state(false);
	let hideCursor = $state(false);
	let lastPointerX = 0;
	let lastPointerY = 0;
	let hasPointer = false;
	let lastKeyAt = 0;

	function setCursorHidden(hidden: boolean) {
		hideCursor = hidden;
		if (typeof document !== 'undefined') {
			document.body.classList.toggle('cursor-hidden', hidden);
		}
	}

	type BugChecklistItem = {
		id: string;
		label: string;
		done: boolean;
	};
	let bugsOpen = $state(false);
	let bugChecklist = $state<BugChecklistItem[]>([
		{ id: 'habit-labels', label: 'Habit labels show for all users', done: false },
		{ id: 'habit-enter', label: 'Enter toggles habit completion', done: false },
		{ id: 'habit-delete', label: 'Deleting habit clears today block', done: false },
		{
			id: 'status-cycle',
			label: 'Block status cycles planned → in progress → complete',
			done: false
		}
	]);
	function toggleBugChecklistItem(id: string) {
		bugChecklist = bugChecklist.map((item) =>
			item.id === id ? { ...item, done: !item.done } : item
		);
	}

	type BlockCategory = 'body' | 'social' | 'work' | 'admin' | null;
	type BlockValue = { title: string; status: boolean | null; category: BlockCategory };
	type BlockRow = { first: BlockValue; second: BlockValue };
	type HabitBlockRow = { first: string | null; second: string | null };
	type SelectedBlock = { hourIndex: number; half: 0 | 1 };
	type DraggingBlock = { user_id: string; hour: number; half: 0 | 1 };
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
	type CutBlock = {
		user_id: string;
		hour: number;
		half: 0 | 1;
		value: BlockValue;
		habitTitle: string | null;
	};
	type ShiftEntry = {
		index: number;
		hour: number;
		half: 0 | 1;
		title: string;
		status: boolean | null;
		category: BlockCategory | null;
		habitName: string | null;
		hasHabit: boolean;
	};
	type ShiftMove = {
		fromIndex: number;
		toIndex: number;
		entry: ShiftEntry;
	};
	type HourRowPayload = {
		day_id: string;
		hour: number;
		half: boolean;
		title: string | null;
		status: boolean | null;
		category?: BlockCategory | null;
	};
	type HoursRealtimeState = {
		channel: RealtimeChannel;
		day_id: string;
	};
	type SelectedBlockRowPayload = {
		id: string;
		selected_block_hour: number | null;
		selected_block_half: boolean | number | null;
	};

	const createEmptyBlock = (): BlockValue => ({ title: '', status: null, category: null });

	function getDisplayTitle(user_id: string, h: number, half01: 0 | 1) {
		const title = getTitle(user_id, h, half01).trim();
		if (title.length > 0) return title;
		return (getHabitTitle(user_id, h, half01) ?? '').trim();
	}
	let blocksByUser = $state<Record<string, Record<number, BlockRow>>>({});
	let habitsByUser = $state<Record<string, Record<number, HabitBlockRow>>>({});
	let habitStreaksByUser = $state<Record<string, Record<HabitKey, PlayerStreak | null>>>({});
	let habitStreaksByUserExcludingToday = $state<
		Record<string, Record<HabitKey, PlayerStreak | null>>
	>({});
	let habitHasTodayEntryByUser = $state<Record<string, Record<HabitKey, boolean>>>({});

	let logOpen = $state(false);
	type BlockCarryoverPrompt = {
		user_id: string;
		prevHour: number;
		prevHalf: 0 | 1;
		currHour: number;
		currHalf: 0 | 1;
		title: string;
	};
	type PlannedPrompt = {
		user_id: string;
		prevHour: number;
		prevHalf: 0 | 1;
		currHour: number;
		currHalf: 0 | 1;
		title: string;
	};

	let carryoverPrompt = $state<BlockCarryoverPrompt | null>(null);
	let plannedPrompt = $state<PlannedPrompt | null>(null);
	let isCarryoverSubmitting = $state(false);
	let isPlannedSubmitting = $state(false);
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
	const hoursRealtimeByUser: Record<string, HoursRealtimeState | null> = {};
	let remoteSelectedBlocks = $state<Record<string, SelectedBlock | null>>({});
	const selectedBlockRealtimeByUser: Record<string, RealtimeChannel | null> = {};
	let lastBroadcastedSelectionKey: string | null = null;
	function previousBlock(hour: number, half: 0 | 1): { hour: number; half: 0 | 1 } | null {
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
		status: boolean | null;
		category: BlockCategory | null;
	}>({
		user_id: null,
		hour: null,
		half: null,
		title: '',
		status: null,
		category: null
	});
	let selectedBlock = $state<SelectedBlock | null>(null);
	let hjklBlock = $state<SelectedBlock | null>(null);
	let draggingBlock = $state<DraggingBlock | null>(null);
	let dragHoverBlock = $state<SelectedBlock | null>(null);
	let hoverBlock = $state<SelectedBlock | null>(null);
	let suppressHoverSelection = $state(false);
	let pendingMove = $state<PendingMove | null>(null);
	let pendingMoveSource = $state<'drag' | 'cut' | null>(null);
	let isMoveSubmitting = $state(false);
	let pendingDelete = $state<PendingDelete | null>(null);
	let isDeleteSubmitting = $state(false);
	let isShiftSubmitting = $state(false);
	let commandCount = $state<number | null>(null);
	let pendingG = $state(false);
	let dragImageEl: HTMLElement | null = null;
	let cutBlock = $state<CutBlock | null>(null);
	const pendingMoveSummary = $derived.by(() => {
		if (!pendingMove) return null;
		const { user_id, fromHour, fromHalf, toHour, toHalf } = pendingMove;
		const sourceTitle = getDisplayTitle(user_id, fromHour, fromHalf);
		const sourceHabit = (getHabitTitle(user_id, fromHour, fromHalf) ?? '').trim();
		const destinationTitle = getDisplayTitle(user_id, toHour, toHalf);
		const destinationHabit = (getHabitTitle(user_id, toHour, toHalf) ?? '').trim();
		const destinationHasContent = destinationTitle.length > 0 || destinationHabit.length > 0;
		const mode: 'swap' | 'move' = destinationHasContent ? 'swap' : 'move';
		return {
			blockLabel: sourceTitle || sourceHabit || 'this block',
			fromLabel: formatBlockLabel(fromHour, fromHalf),
			toLabel: formatBlockLabel(toHour, toHalf),
			destinationLabel: destinationTitle || destinationHabit || null,
			hasDestinationContent: destinationHasContent,
			isHabit: sourceHabit.length > 0,
			mode
		};
	});
	const pendingDeleteSummary = $derived.by(() => {
		if (!pendingDelete) return null;
		const { user_id, hour, half } = pendingDelete;
		const title = getDisplayTitle(user_id, hour, half);
		const habit = (getHabitTitle(user_id, hour, half) ?? '').trim();
		const hasContent = title.length > 0 || habit.length > 0;
		return {
			blockLabel: title || habit || 'this block',
			locationLabel: formatBlockLabel(hour, half),
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
		return habitStreakRecordForBlock(viewerUserId, h, half);
	});

	const modalOverlayActive = $derived.by(() =>
		Boolean(
			logOpen ||
				habitCheckPrompt ||
				carryoverPrompt ||
				plannedPrompt ||
				pendingMove ||
				pendingDelete ||
				reviewOpen
		)
	);

	// prevent re-prompting within same block
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
	const addDaysToDateString = (dateStr: string, days: number) => {
		const baseMs = parseHabitDate(dateStr);
		if (baseMs === null) return localToday();
		const d = new Date(baseMs);
		d.setDate(d.getDate() + days);
		return formatDateString(d);
	};
	const displayDateForUser = (user_id: string) => {
		if (!viewerUserId) return localToday();
		return activeDayDateByUser[user_id] ?? localToday();
	};
	const canShowReviewDayButton = () => {
		if (!viewerUserId) return false;
		if (!isNightWindow()) return false;
		const activeDayDate = activeDayDateByUser[viewerUserId];
		if (activeDayDate === undefined || activeDayDate === null) return false;
		const yesterday = dateStringNDaysAgo(1);
		return activeDayDate === yesterday;
	};

	function syncActiveDayDateStore(dateStr: string | null) {
		activeDayDateStore?.set(dateStr ?? localToday());
	}

	async function setActiveDayDateForViewer(dateStr: string) {
		if (!viewerUserId) return;
		if (!dateStr) return;
		const current = activeDayDateByUser[viewerUserId] ?? localToday();
		if (current === dateStr) return;
		activeDayDateByUser = { ...activeDayDateByUser, [viewerUserId]: dateStr };
		syncActiveDayDateStore(dateStr);
		const { error } = await supabase
			.from('users')
			.update({ active_day_date: dateStr })
			.eq('id', viewerUserId);
		if (error) {
			console.error('active day update error', error);
			return;
		}
		const dayId = await getDayIdForUser(viewerUserId, dateStr, true);
		dayIdByUser = { ...dayIdByUser, [viewerUserId]: dayId };
		if (dayId) {
			await loadHoursForDay(viewerUserId, dayId);
		} else {
			blocksByUser = { ...blocksByUser, [viewerUserId]: {} };
		}
	}

	function weekKeyForDate(dateStr: string) {
		const ms = parseHabitDate(dateStr);
		if (ms === null) return null;
		const date = new Date(ms);
		const monthKey = (MONTHS[date.getMonth()] ?? MONTHS[0]).toLowerCase();
		const weekIndex = Math.min(4, Math.max(1, Math.ceil(date.getDate() / 7)));
		return `${monthKey}-week${weekIndex}`;
	}

	function isPlanningForTomorrow() {
		if (!viewerUserId) return false;
		const activeDayDate = activeDayDateByUser[viewerUserId];
		if (!activeDayDate) return false;
		return activeDayDate > localToday();
	}

	$effect(() => {
		if (!viewerUserId) return;
		const desiredDate = $activeDayDateStore;
		if (!desiredDate) return;
		const current = activeDayDateByUser[viewerUserId] ?? localToday();
		if (desiredDate === current) return;
		void setActiveDayDateForViewer(desiredDate);
	});

	async function weeklyHowForDate(dateStr: string) {
		const weekKey = weekKeyForDate(dateStr);
		if (!weekKey) return '';
		try {
			const { data, error } = await supabase
				.from('goals')
				.select('how')
				.eq('goal_key', weekKey)
				.maybeSingle();
			if (error) throw error;
			return (data?.how ?? '').toString().trim();
		} catch (error) {
			console.error('weekly how load error', error);
			return '';
		}
	}

	async function scheduleWeeklyHowSessions(user_id: string, dateStr: string, day_id: string) {
		const how = (await weeklyHowForDate(dateStr)).trim();
		if (!how) return;

		const totalBlocks = hours.length * 2;
		const reserved = new Set<number>();
		for (let hourIndex = 0; hourIndex < hours.length; hourIndex += 1) {
			for (const half of [0, 1] as const) {
				if (!blockHasContent(user_id, hours[hourIndex], half)) continue;
				reserved.add(blockIndex(hourIndex, half));
			}
		}

		const sessions: number[] = [];
		for (let idx = 0; idx <= totalBlocks - 3 && sessions.length < 2; idx += 1) {
			const indices = [idx, idx + 1, idx + 2];
			const isOpen = indices.every((runIndex) => {
				if (runIndex >= totalBlocks) return false;
				if (reserved.has(runIndex)) return false;
				const { hour, half } = blockFromIndex(runIndex);
				if (hour === undefined) return false;
				return !blockHasContent(user_id, hour, half);
			});
			if (!isOpen) continue;
			sessions.push(idx);
			for (const runIndex of indices) reserved.add(runIndex);
		}

		if (sessions.length === 0) return;

		const payload = [] as {
			day_id: string;
			hour: number;
			half: boolean;
			title: string;
			status: boolean | null;
			category: BlockCategory | null;
		}[];
		for (const startIndex of sessions) {
			for (let offset = 0; offset < 3; offset += 1) {
				const { hour, half } = blockFromIndex(startIndex + offset);
				if (hour === undefined) continue;
				payload.push({
					day_id,
					hour,
					half: half === 1,
					title: how,
					status: null,
					category: null
				});
			}
		}
		if (payload.length === 0) return;

		const { error } = await supabase
			.from('hours')
			.upsert(payload, { onConflict: 'day_id,hour,half' });
		if (error) {
			console.error('weekly how schedule error', error);
			return;
		}
		for (const entry of payload) {
			setTitle(user_id, entry.hour, entry.half ? 1 : 0, how, null, null);
		}
	}

	function ensureBlockRow(user_id: string, h: number): BlockRow {
		blocksByUser[user_id] ??= {};
		blocksByUser[user_id][h] ??= { first: createEmptyBlock(), second: createEmptyBlock() };
		return blocksByUser[user_id][h];
	}
	function setTitle(
		user_id: string,
		h: number,
		half01: 0 | 1,
		text: string,
		status?: boolean | null,
		category?: BlockCategory | null
	) {
		const row = ensureBlockRow(user_id, h);
		if (half01 === 0) {
			row.first.title = text;
			if (status !== undefined) row.first.status = status;
			if (category !== undefined) row.first.category = category;
			if (category === undefined && text.trim().length === 0 && status === null) {
				row.first.category = null;
			}
		} else {
			row.second.title = text;
			if (status !== undefined) row.second.status = status;
			if (category !== undefined) row.second.category = category;
			if (category === undefined && text.trim().length === 0 && status === null) {
				row.second.category = null;
			}
		}
	}

	function setStatus(user_id: string, h: number, half01: 0 | 1, value: boolean | null) {
		const row = ensureBlockRow(user_id, h);
		if (half01 === 0) row.first.status = value;
		else row.second.status = value;
	}

	function getBlock(user_id: string, h: number, half01: 0 | 1): BlockValue {
		const row = blocksByUser[user_id]?.[h];
		if (!row) return createEmptyBlock();
		return half01 === 0 ? row.first : row.second;
	}
	function isCutSource(user_id: string, h: number, half01: 0 | 1) {
		return Boolean(
			cutBlock && cutBlock.user_id === user_id && cutBlock.hour === h && cutBlock.half === half01
		);
	}
	function blockIsCut(user_id: string, h: number, half01: 0 | 1) {
		return Boolean(
			cutBlock && cutBlock.user_id === user_id && cutBlock.hour === h && cutBlock.half === half01
		);
	}

	function getTitle(user_id: string, h: number, half01: 0 | 1) {
		return getBlock(user_id, h, half01).title ?? '';
	}

	function getStatus(user_id: string, h: number, half01: 0 | 1) {
		return getBlock(user_id, h, half01).status ?? null;
	}

	function setCategory(user_id: string, h: number, half01: 0 | 1, value: BlockCategory | null) {
		const row = ensureBlockRow(user_id, h);
		if (half01 === 0) row.first.category = value;
		else row.second.category = value;
	}

	function getCategory(user_id: string, h: number, half01: 0 | 1) {
		return getBlock(user_id, h, half01).category ?? null;
	}

	function ensureHabitRow(user_id: string, h: number): HabitBlockRow {
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

	function reviewStatsForUser(user_id: string): ReviewStats {
		let planned = 0;
		let completed = 0;
		const categoryCounts = { body: 0, social: 0, work: 0, admin: 0 };
		for (const hour of hours) {
			for (const half of [0, 1] as const) {
				const title = (getTitle(user_id, hour, half) ?? '').trim();
				const habit = (getHabitTitle(user_id, hour, half) ?? '').trim();
				if (title.length > 0 || habit.length > 0) planned += 1;
				if (getStatus(user_id, hour, half) === true) completed += 1;
				if (title.length > 0) {
					const category = getCategory(user_id, hour, half);
					if (category && category in categoryCounts) {
						categoryCounts[category as keyof typeof categoryCounts] += 1;
					}
				}
			}
		}
		const totalCategories = Object.values(categoryCounts).reduce((sum, value) => sum + value, 0);
		const categoryBreakdown: ReviewCategoryBreakdown[] = (
			[
				{ key: 'body', label: 'Body' },
				{ key: 'social', label: 'Social' },
				{ key: 'work', label: 'Work' },
				{ key: 'admin', label: 'Admin' }
			] as const
		).map((entry) => ({
			...entry,
			percent:
				totalCategories === 0 ? 0 : Math.round((categoryCounts[entry.key] / totalCategories) * 100),
			hours: Math.round((categoryCounts[entry.key] / 2) * 10) / 10
		}));

		const score = planned === 0 ? 0 : Math.round((completed / planned) * 100);
		return {
			planned,
			completed,
			productiveHours: completed / 2,
			score,
			categoryBreakdown
		};
	}

	function formatProductiveHours(value: number) {
		const rounded = Math.round(value * 10) / 10;
		return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
	}

	function reviewScoreColor(score: number) {
		if (score >= 75) return 'bg-emerald-700';
		if (score >= 50) return 'bg-emerald-500';
		if (score >= 25) return 'bg-emerald-300';
		return 'bg-stone-500';
	}

	function openReviewDay(user_id: string) {
		if (!viewerUserId || viewerUserId !== user_id) return;
		reviewStats = reviewStatsForUser(user_id);
		reviewDayDate = displayDateForUser(user_id);
		reviewOpen = true;
	}

	function closeReviewDay() {
		reviewOpen = false;
		reviewStats = null;
		reviewDayDate = null;
	}

	async function startNextDayPlanning() {
		if (!viewerUserId || reviewSubmitting) return;
		reviewSubmitting = true;
		const currentDate = displayDateForUser(viewerUserId);
		const nextDate = addDaysToDateString(currentDate, 1);
		try {
			const { error } = await supabase
				.from('users')
				.update({ active_day_date: nextDate })
				.eq('id', viewerUserId);
			if (error) throw error;
			activeDayDateByUser = { ...activeDayDateByUser, [viewerUserId]: nextDate };
			syncActiveDayDateStore(nextDate);
			const dayId = await getDayIdForUser(viewerUserId, nextDate, true);
			dayIdByUser = { ...dayIdByUser, [viewerUserId]: dayId };
			if (dayId) {
				await loadHoursForDay(viewerUserId, dayId);
				await scheduleWeeklyHowSessions(viewerUserId, nextDate, dayId);
			} else {
				blocksByUser = { ...blocksByUser, [viewerUserId]: {} };
			}
			closeReviewDay();
		} catch (error) {
			console.error('start next day error', error);
		} finally {
			reviewSubmitting = false;
		}
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

	function habitStreakRecordForBlock(
		user_id: string,
		h: number,
		half01: 0 | 1
	): Record<HabitKey, PlayerStreak | null> {
		const record = habitStreaksByUser[user_id] ?? emptyHabitStreakRecord();
		const fallbackRecord = habitStreaksByUserExcludingToday[user_id] ?? record;
		const hasTodayEntry = habitHasTodayEntryByUser[user_id] ?? emptyHabitTodayEntryRecord();
		const blockElapsed = blockHasElapsed(h, half01);
		const blockStatus = getStatus(user_id, h, half01);
		const blockCompleted = blockStatus === true;
		return HABIT_STREAK_KEYS.reduce(
			(acc, key) => {
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
				const useCurrent = blockCompleted || (blockElapsed && hasTodayEntry[key]);
				const source = useCurrent ? record : fallbackRecord;
				let value = source?.[key] ?? null;
				if (blockCompleted && !blockElapsed) {
					const base = fallbackRecord?.[key] ?? null;
					const baseLen = base && base.kind === 'positive' ? base.length : 0;
					value = {
						kind: 'positive',
						length: Math.max(1, baseLen + 1),
						missesOnLatest: 0
					};
				}
				acc[key] = value;
				return acc;
			},
			{} as Record<HabitKey, PlayerStreak | null>
		);
	}

	function habitStreakForBlock(user_id: string, h: number, half01: 0 | 1): PlayerStreak | null {
		const habitName = getHabitTitle(user_id, h, half01);
		const key = normalizeHabitName(habitName);
		if (!key) return null;
		const view = habitStreakRecordForBlock(user_id, h, half01);
		return view[key] ?? null;
	}

	function getHourIndex(value: number) {
		return hours.findIndex((hour) => hour === value);
	}

	function clampHourIndex(idx: number) {
		return Math.max(0, Math.min(hours.length - 1, idx));
	}
	function blockIsEmpty(user_id: string, h: number, half01: 0 | 1) {
		return getDisplayTitle(user_id, h, half01).length === 0;
	}
	function blockHasContent(user_id: string, h: number, half01: 0 | 1) {
		const title = getTitle(user_id, h, half01).trim();
		const habitName = (getHabitTitle(user_id, h, half01) ?? '').trim();
		return title.length > 0 || habitName.length > 0;
	}
	function maxBlockCountFor(user_id: string | null, h: number, half01: 0 | 1) {
		if (!user_id) return 1;
		const hourIndex = getHourIndex(h);
		if (hourIndex === -1) return 1;
		const totalBlocks = hours.length * 2;
		let maxCount = 1;
		for (let offset = 1; offset <= 2; offset += 1) {
			const nextIndex = blockIndex(hourIndex, half01) + offset;
			if (nextIndex >= totalBlocks) return maxCount;
			const { hour: nextHour, half: nextHalf } = blockFromIndex(nextIndex);
			if (nextHour === undefined) return maxCount;
			if (blockHasContent(user_id, nextHour, nextHalf)) return maxCount;
			maxCount += 1;
		}
		return maxCount;
	}
	function blockRunRange(user_id: string, h: number, half01: 0 | 1) {
		const title = getTitle(user_id, h, half01).trim();
		const habitName = (getHabitTitle(user_id, h, half01) ?? '').trim();
		const hourIndex = getHourIndex(h);
		if (!title || habitName.length > 0 || hourIndex === -1) {
			const startIndex = hourIndex === -1 ? 0 : blockIndex(hourIndex, half01);
			return { startIndex, endIndex: startIndex };
		}
		const totalBlocks = hours.length * 2;
		const startIndex = blockIndex(hourIndex, half01);
		const matches = (index: number) => {
			const { hour, half } = blockFromIndex(index);
			if (hour === undefined) return false;
			const nextTitle = getTitle(user_id, hour, half).trim();
			const nextHabit = (getHabitTitle(user_id, hour, half) ?? '').trim();
			if (!nextTitle || nextHabit.length > 0) return false;
			return nextTitle === title;
		};
		let first = startIndex;
		while (first - 1 >= 0 && matches(first - 1)) {
			first -= 1;
		}
		let last = startIndex;
		while (last + 1 < totalBlocks && matches(last + 1)) {
			last += 1;
		}
		return { startIndex: first, endIndex: last };
	}
	function blockRunInfo(user_id: string, h: number, half01: 0 | 1) {
		const { startIndex, endIndex } = blockRunRange(user_id, h, half01);
		const hourIndex = getHourIndex(h);
		if (hourIndex === -1) return { length: 1, isLast: true };
		const currentIndex = blockIndex(hourIndex, half01);
		return { length: endIndex - startIndex + 1, isLast: currentIndex === endIndex };
	}
	function blockRunLength(user_id: string | null, h: number, half01: 0 | 1) {
		if (!user_id) return 1;
		return blockRunInfo(user_id, h, half01).length;
	}
	function blockShowsStatus(user_id: string, h: number, half01: 0 | 1) {
		const habitName = (getHabitTitle(user_id, h, half01) ?? '').trim();
		if (habitName.length > 0) return false;
		const title = getTitle(user_id, h, half01).trim();
		if (!title) return false;
		return blockRunInfo(user_id, h, half01).isLast;
	}

	function canDragBlock(user_id: string, h: number, half01: 0 | 1) {
		if (!viewerUserId || viewerUserId !== user_id) return false;
		if (isCutSource(user_id, h, half01)) return false;
		return blockHasContent(user_id, h, half01);
	}
	function setSelectedBlock(next: SelectedBlock | null) {
		if (!viewerUserId) {
			selectedBlock = null;
			return;
		}
		if (next === null) {
			selectedBlock = null;
			void broadcastSelectedBlock(null);
			return;
		}
		const clamped: SelectedBlock = {
			hourIndex: clampHourIndex(next.hourIndex),
			half: next.half === 1 ? 1 : 0
		};
		selectedBlock = clamped;
		void broadcastSelectedBlock(clamped);
	}
	function ensureSelectionExists() {
		if (!viewerUserId || selectedBlock) return;
		const { hour, half } = blockInfoFromNow();
		const idx = getHourIndex(hour);
		setSelectedBlock({
			hourIndex: idx === -1 ? 0 : idx,
			half
		});
	}
	function blockMatches(selection: SelectedBlock | null, hourIndex: number, half: 0 | 1) {
		return selection?.hourIndex === hourIndex && selection?.half === half;
	}
	function highlightedBlockForUser(user_id: string): SelectedBlock | null {
		if (viewerUserId === user_id) {
			return dragHoverBlock ?? hoverBlock ?? selectedBlock;
		}
		return remoteSelectedBlocks[user_id] ?? null;
	}
	function blockIsHighlighted(user_id: string, hourIndex: number, half: 0 | 1) {
		const active = highlightedBlockForUser(user_id);
		return blockMatches(active, hourIndex, half);
	}
	function blockIsCurrent(hour: number, half: 0 | 1) {
		return currentHour === hour && currentHalf === half;
	}
	function isTypingTarget(target: EventTarget | null) {
		if (!(target instanceof HTMLElement)) return false;
		const tag = target.tagName;
		if (tag === 'INPUT' || tag === 'TEXTAREA') return true;
		if (target.isContentEditable) return true;
		return !!target.closest('input, textarea, [contenteditable="true"]');
	}
	function blockIndex(hourIndex: number, half: 0 | 1) {
		return hourIndex * 2 + half;
	}
	function blockFromIndex(index: number) {
		const hourIndex = Math.floor(index / 2);
		const half = (index % 2) as 0 | 1;
		const hour = hours[hourIndex];
		return { hourIndex, half, hour };
	}
	function moveSelectionLeft() {
		if (!viewerUserId || !selectedBlock) return false;
		if (selectedBlock.half === 0) return true;
		setSelectedBlock({ hourIndex: selectedBlock.hourIndex, half: 0 });
		return true;
	}
	function moveSelectionRight() {
		if (!viewerUserId || !selectedBlock) return false;
		if (selectedBlock.half === 1) return true;
		setSelectedBlock({ hourIndex: selectedBlock.hourIndex, half: 1 });
		return true;
	}
	function cancelCutBlock() {
		cutBlock = null;
	}
	function cutBlockAt(user_id: string, hour: number, half: 0 | 1) {
		if (!viewerUserId || viewerUserId !== user_id) return false;
		const habitName = (getHabitTitle(user_id, hour, half) ?? '').trim();
		if (!blockHasContent(user_id, hour, half)) return false;
		if (habitName.length > 0) return false;
		cancelCutBlock();
		const sourceValue = getBlock(user_id, hour, half);
		cutBlock = {
			user_id,
			hour,
			half,
			value: {
				title: sourceValue.title ?? '',
				status: sourceValue.status,
				category: sourceValue.category ?? null
			},
			habitTitle: habitName.length > 0 ? habitName : null
		};
		const hourIndex = getHourIndex(hour);
		if (hourIndex !== -1) {
			setSelectedBlock({ hourIndex, half });
		}
		return true;
	}
	function cutSelectedBlock() {
		if (!viewerUserId || !selectedBlock) return false;
		const hour = hours[selectedBlock.hourIndex];
		if (hour === undefined) return false;
		return cutBlockAt(viewerUserId, hour, selectedBlock.half);
	}
	function pasteCutBlockToTarget(hour: number, half: 0 | 1) {
		if (!cutBlock) return false;
		const { user_id, hour: fromHour, half: fromHalf } = cutBlock;
		if (hour === fromHour && half === fromHalf) {
			cancelCutBlock();
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
	function pasteCutBlockAtSelection() {
		if (!viewerUserId || !cutBlock || !selectedBlock) return false;
		const hour = hours[selectedBlock.hourIndex];
		if (hour === undefined) return false;
		return pasteCutBlockToTarget(hour, selectedBlock.half);
	}
	function maybeHandlePaste(user_id: string, hour: number, half: 0 | 1) {
		if (!viewerUserId || viewerUserId !== user_id) return false;
		if (!cutBlock || cutBlock.user_id !== user_id) return false;
		return pasteCutBlockToTarget(hour, half);
	}

	function moveSelectionVertical(delta: 1 | -1, count = 1) {
		if (!viewerUserId || !selectedBlock) return false;
		const step = delta * Math.max(1, count);
		const nextIndex = selectedBlock.hourIndex + step;
		if (nextIndex < 0 || nextIndex >= hours.length) return false;
		setSelectedBlock({ hourIndex: nextIndex, half: selectedBlock.half });
		return true;
	}
	function selectFirstBlock() {
		if (!selectedBlock) return false;
		setSelectedBlock({ hourIndex: 0, half: selectedBlock.half });
		return true;
	}
	function selectLastBlock() {
		if (!selectedBlock) return false;
		setSelectedBlock({ hourIndex: hours.length - 1, half: selectedBlock.half });
		return true;
	}
	function selectMiddleBlock() {
		if (!selectedBlock) return false;
		const middleIndex = Math.floor(hours.length / 2);
		setSelectedBlock({ hourIndex: middleIndex, half: selectedBlock.half });
		return true;
	}
	function promptDeleteSelectedBlock() {
		if (!viewerUserId || !selectedBlock) return false;
		const hour = hours[selectedBlock.hourIndex];
		if (hour === undefined) return false;
		if (!blockHasContent(viewerUserId, hour, selectedBlock.half)) return false;
		pendingDelete = {
			user_id: viewerUserId,
			hour,
			half: selectedBlock.half
		};
		return true;
	}

	function activateSelectedBlockFromKeyboard() {
		if (!viewerUserId || !selectedBlock) return false;
		const hour = hours[selectedBlock.hourIndex];
		if (hour === undefined) return false;
		if (maybeHandlePaste(viewerUserId, hour, selectedBlock.half)) return true;
		const habitName = (getHabitTitle(viewerUserId, hour, selectedBlock.half) ?? '').trim();
		const title = getTitle(viewerUserId, hour, selectedBlock.half).trim();
		if (!title && !habitName) return true;
		void cycleStatus(viewerUserId, hour, selectedBlock.half);
		return true;
	}

	function openSelectedBlockEditorFromKeyboard(normal: boolean) {
		if (!viewerUserId || !selectedBlock) return false;
		const hour = hours[selectedBlock.hourIndex];
		if (hour === undefined) return false;
		if (maybeHandlePaste(viewerUserId, hour, selectedBlock.half)) return true;
		const habitName = getHabitTitle(viewerUserId, hour, selectedBlock.half);
		if ((habitName ?? '').trim().length > 0) return false;
		openEditor(viewerUserId, hour, selectedBlock.half, normal);
		return true;
	}
	function collectShiftEntries(user_id: string, startIndex: number) {
		const entries: ShiftEntry[] = [];
		const totalBlocks = hours.length * 2;
		for (let idx = startIndex; idx < totalBlocks; idx += 1) {
			const { hour, half } = blockFromIndex(idx);
			if (hour === undefined) continue;
			const title = getTitle(user_id, hour, half);
			const status = getStatus(user_id, hour, half);

			const habitName = getHabitTitle(user_id, hour, half);
			const hasHabit = (habitName ?? '').trim().length > 0;
			const hasContent = getDisplayTitle(user_id, hour, half).length > 0;

			if (!hasContent) continue;
			entries.push({
				index: idx,
				hour,
				half,
				title: title ?? '',
				status: status ?? null,
				category: getCategory(user_id, hour, half),
				habitName,
				hasHabit
			});
		}
		return entries;
	}
	function maxFixedContentIndex(user_id: string, startIndex: number) {
		let lastFixed = -1;
		for (let idx = 0; idx < startIndex; idx += 1) {
			const { hour, half } = blockFromIndex(idx);
			if (hour === undefined) continue;
			if (blockHasContent(user_id, hour, half)) {
				lastFixed = idx;
			}
		}
		return lastFixed;
	}
	async function shiftBlocksOnce(
		user_id: string,
		startIndex: number,
		direction: 1 | -1,
		confirmOverflow: boolean
	) {
		const day_id = dayIdByUser[user_id];
		if (!day_id) return false;
		const totalBlocks = hours.length * 2;
		const entries = collectShiftEntries(user_id, startIndex);
		if (entries.length === 0) return false;
		const includeHabits = false;
		const movableEntries = entries.filter((entry) => includeHabits || !entry.hasHabit);
		if (movableEntries.length === 0) return false;
		const lockedHabits = new Set(
			entries.filter((entry) => entry.hasHabit && !includeHabits).map((entry) => entry.index)
		);
		const lastFixed = maxFixedContentIndex(user_id, startIndex);
		const moves: ShiftMove[] = [];
		const overflow: ShiftEntry[] = [];
		const occupiedTargets = new Set<number>();
		const orderedEntries = [...movableEntries].sort((a, b) =>
			direction === 1 ? b.index - a.index : a.index - b.index
		);
		for (const entry of orderedEntries) {
			let target = entry.index + direction;
			while (lockedHabits.has(target) || occupiedTargets.has(target)) {
				target += direction;
			}
			if (direction === -1 && target <= lastFixed) {
				target = entry.index;
			}
			if (target < 0) return false;
			if (target >= totalBlocks) {
				overflow.push(entry);
				continue;
			}
			if (target === entry.index) {
				occupiedTargets.add(target);
				continue;
			}
			moves.push({ fromIndex: entry.index, toIndex: target, entry });
			occupiedTargets.add(target);
		}
		if (confirmOverflow && direction === 1 && overflow.length > 0) {
			const ok = window.confirm(
				`Shifting will delete ${overflow.length} block${overflow.length === 1 ? '' : 's'}. Continue?`
			);
			if (!ok) return false;
		}
		const clearEntries = [...overflow, ...moves.map((move) => move.entry)];
		const movedSelection = moves.find((move) => move.fromIndex === startIndex);
		for (const entry of clearEntries) {
			setTitle(user_id, entry.hour, entry.half, '', null, null);
			if (entry.hasHabit) setHabitTitle(user_id, entry.hour, entry.half, null);
		}
		for (const move of moves) {
			const { hour: toHour, half: toHalf } = blockFromIndex(move.toIndex);
			if (toHour === undefined) continue;
			const habitName = move.entry.habitName ?? null;
			const baseTitle = move.entry.title ?? '';
			const resolvedTitle = baseTitle.trim().length > 0 ? baseTitle : (habitName ?? '');
			setTitle(
				user_id,
				toHour,
				toHalf,
				resolvedTitle,
				move.entry.status ?? null,
				move.entry.category
			);
			if (move.entry.hasHabit) {
				setHabitTitle(user_id, toHour, toHalf, habitName ?? null);
			}
		}
		if (viewerUserId === user_id && movedSelection) {
			const { hourIndex, half } = blockFromIndex(movedSelection.toIndex);
			if (hourIndex >= 0 && hourIndex < hours.length) {
				setSelectedBlock({ hourIndex, half });
			}
		}
		if (clearEntries.length > 0) {
			const deletions = await Promise.all(
				clearEntries.map((entry) =>
					supabase
						.from('hours')
						.delete()
						.eq('day_id', day_id)
						.eq('hour', entry.hour)
						.eq('half', entry.half === 1)
				)
			);
			const deleteErr = deletions.find((result) => result.error)?.error;
			if (deleteErr) {
				console.error('shift blocks delete error', deleteErr);
			}
		}
		const updates = new Map<
			string,
			{
				day_id: string;
				hour: number;
				half: boolean;
				title: string;
				status: boolean | null;
				category: BlockCategory | null;
			}
		>();
		for (const move of moves) {
			const { hour: toHour, half: toHalf } = blockFromIndex(move.toIndex);
			if (toHour === undefined) continue;
			const habitName = move.entry.habitName ?? null;
			const baseTitle = move.entry.title ?? '';
			const resolvedTitle = baseTitle.trim().length > 0 ? baseTitle : (habitName ?? '');
			const hasHoursContent = resolvedTitle.trim().length > 0 || move.entry.hasHabit;
			if (!hasHoursContent) continue;
			updates.set(`${toHour}-${toHalf}`, {
				day_id,
				hour: toHour,
				half: toHalf === 1,
				title: resolvedTitle,
				status: move.entry.status,
				category: move.entry.category ?? null
			});
		}
		if (updates.size > 0) {
			const { error: upsertErr } = await supabase
				.from('hours')
				.upsert([...updates.values()], { onConflict: 'day_id,hour,half' });
			if (upsertErr) {
				console.error('shift blocks error', upsertErr);
			}
		}
		return true;
	}

	async function shiftBlocksFromIndex(
		user_id: string,
		startIndex: number,
		direction: 1 | -1,
		steps = 1
	) {
		if (isShiftSubmitting) return false;
		isShiftSubmitting = true;
		try {
			for (let step = 0; step < steps; step += 1) {
				const ok = await shiftBlocksOnce(user_id, startIndex, direction, step === 0);
				if (!ok) return false;
			}
			return true;
		} finally {
			isShiftSubmitting = false;
		}
	}

	async function shiftSelection(direction: 1 | -1) {
		if (!viewerUserId || !selectedBlock) return false;
		const startIndex = blockIndex(selectedBlock.hourIndex, selectedBlock.half);
		return shiftBlocksFromIndex(viewerUserId, startIndex, direction, 1);
	}
	function handleBlockSelect(user_id: string, hour: number, half: 0 | 1, normal: boolean) {
		if (maybeHandlePaste(user_id, hour, half)) return;
		openEditor(user_id, hour, half, normal);
	}
	function handleBlockCycle(user_id: string, hour: number, half: 0 | 1) {
		if (maybeHandlePaste(user_id, hour, half)) return;
		void cycleStatus(user_id, hour, half);
	}

	function cleanupDragImage() {
		if (dragImageEl && dragImageEl.parentNode) {
			dragImageEl.parentNode.removeChild(dragImageEl);
		}
		dragImageEl = null;
	}
	function resetDragState() {
		draggingBlock = null;
		dragHoverBlock = null;
		cleanupDragImage();
	}

	// pointer down: clear selection immediately before drag/focus
	function handleBlockPointerDown(
		event: PointerEvent,
		user_id: string,
		hour: number,
		half: 0 | 1,
		hourIndex: number
	) {
		if (!canDragBlock(user_id, hour, half)) return;

		setSelectedBlock(null);
		hoverBlock = null;
		dragHoverBlock = null;
	}

	function handleBlockDragStart(
		event: DragEvent,
		user_id: string,
		hour: number,
		half: 0 | 1,
		hourIndex: number
	) {
		if (!canDragBlock(user_id, hour, half)) {
			event.preventDefault();
			return;
		}
		isDragging = true;
		suppressNextClick = true;
		setSelectedBlock(null);
		draggingBlock = { user_id, hour, half };
		dragHoverBlock = { hourIndex, half };
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
	function handleBlockDragOver(event: DragEvent, user_id: string, half: 0 | 1, hourIndex: number) {
		if (!draggingBlock || draggingBlock.user_id !== user_id) return;
		event.preventDefault();
		event.stopPropagation();
		if (event.dataTransfer) event.dataTransfer.dropEffect = 'move';
		if (!blockMatches(dragHoverBlock, hourIndex, half)) {
			dragHoverBlock = { hourIndex, half };
		}
	}
	function handleBlockDrop(event: DragEvent, user_id: string, hour: number, half: 0 | 1) {
		if (!draggingBlock || draggingBlock.user_id !== user_id) return;
		event.preventDefault();
		event.stopPropagation();
		const source = draggingBlock;
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
	function handleBlockDragEnd() {
		resetDragState();
		isDragging = false;
		queueMicrotask(() => {
			suppressNextClick = false;
		});
	}
	function captureHoverSelection() {
		if (!viewerUserId || !hoverBlock) return false;
		setSelectedBlock(hoverBlock);
		hoverBlock = null;
		return true;
	}

	function handleBlockPointerEnter(user_id: string, hourIndex: number, half: 0 | 1) {
		if (!viewerUserId || viewerUserId !== user_id) return;
		if (suppressHoverSelection) return;
		hoverBlock = { hourIndex, half };
		if (draggingBlock) return;
		setSelectedBlock({ hourIndex, half });
	}
	function handleBlockPointerLeave(user_id: string, hourIndex: number, half: 0 | 1) {
		if (!viewerUserId || viewerUserId !== user_id) return;
		if (hoverBlock && hoverBlock.hourIndex === hourIndex && hoverBlock.half === half) {
			hoverBlock = null;
		}
	}

	function handleGlobalKeydown(event: KeyboardEvent) {
		if (!viewerUserId || logOpen) return;
		if (event.metaKey || event.ctrlKey || event.altKey) return;
		if (isTypingTarget(event.target)) return;
		const key = event.key;
		const normalized = key.length === 1 ? key.toLowerCase() : key;
		if (normalized === 'Escape') {
			if (cutBlock) {
				cancelCutBlock();
				event.preventDefault();
				return;
			}
			return;
		}
		if (key.length === 1 && key >= '0' && key <= '9') {
			if (key === '0' && commandCount === null) return;
			commandCount = (commandCount ?? 0) * 10 + Number(key);
			pendingG = false;
			event.preventDefault();
			return;
		}
		if (!['h', 'j', 'k', 'l', 'g', 'm', '>', '<', 'Enter', 'i', 'd', 'x', 'p'].includes(normalized))
			return;
		hoverBlock = null;
		ensureSelectionExists();
		if (!selectedBlock) return;
		let handled = false;
		switch (normalized) {
			case 'h':
				handled = moveSelectionLeft();
				break;
			case 'l':
				handled = moveSelectionRight();
				break;
			case 'j': {
				const count = commandCount ?? 1;
				handled = moveSelectionVertical(1, count);
				break;
			}
			case 'k': {
				const count = commandCount ?? 1;
				handled = moveSelectionVertical(-1, count);
				break;
			}
			case 'g':
				if (key === 'G') {
					handled = selectLastBlock();
					pendingG = false;
				} else if (pendingG) {
					handled = selectFirstBlock();
					pendingG = false;
				} else {
					pendingG = true;
				}
				break;
			case 'm':
				if (key === 'M') {
					handled = selectMiddleBlock();
				}
				break;
			case '>':
				handled = true;
				void shiftSelection(1);
				break;
			case '<':
				handled = true;
				void shiftSelection(-1);
				break;
			case 'Enter':
				hjklBlock = selectedBlock;
				handled = activateSelectedBlockFromKeyboard();
				break;
			case 'i':
				hjklBlock = selectedBlock;
				handled = openSelectedBlockEditorFromKeyboard(false);
				break;
			case 'd':
				handled = promptDeleteSelectedBlock();
				break;
			case 'x':
				handled = cutSelectedBlock();
				break;
			case 'p':
				handled = pasteCutBlockAtSelection();
				break;
		}
		if ((normalized === 'j' || normalized === 'k') && commandCount !== null) {
			commandCount = null;
		}
		if (handled) {
			pendingG = false;
			event.preventDefault();
		} else if (normalized !== 'g') {
			pendingG = false;
		}
	}

	async function getDayIdForUser(user_id: string, dateStr: string, createIfMissing: boolean) {
		const { data: found, error: findErr } = await supabase
			.from('days')
			.select('id')
			.eq('user_id', user_id)
			.eq('date', dateStr)
			.maybeSingle();
		if (findErr) throw findErr;
		if (found?.id) return found.id as string;
		if (!createIfMissing) return null;
		const createdAt = formatLocalTimestamp(getNow());
		const { data: created, error: insErr } = await supabase
			.from('days')
			.insert({ user_id, date: dateStr, created_at: createdAt })
			.select('id')
			.single();
		if (insErr) throw insErr;
		return created.id as string;
	}

	async function loadHoursForDay(user_id: string, day_id: string) {
		const { data, error } = await supabase
			.from('hours')
			.select('hour, half, title, status, category')
			.eq('day_id', day_id);
		if (error) throw error;
		const next: Record<number, BlockRow> = {};
		for (const r of data ?? []) {
			const h = r.hour as number;
			const half01 = (r.half ? 1 : 0) as 0 | 1;
			const blockValue: BlockValue = {
				title: r.title ?? '',
				status: r.status as boolean | null,
				category: (r.category as BlockCategory | null) ?? null
			};
			next[h] ??= { first: createEmptyBlock(), second: createEmptyBlock() };
			if (half01 === 0) next[h].first = blockValue;
			else next[h].second = blockValue;
		}
		blocksByUser[user_id] = next;
	}
	function applyRealtimeBlockValue(
		user_id: string,
		hour: number,
		half01: 0 | 1,
		value: BlockValue | null
	) {
		if (value === null) {
			setTitle(user_id, hour, half01, '', null, null);
			return;
		}
		setTitle(
			user_id,
			hour,
			half01,
			value.title ?? '',
			value.status ?? null,
			value.category ?? null
		);
	}
	function handleHoursRealtimeChange(
		user_id: string,
		day_id: string,
		payload: RealtimePostgresChangesPayload<HourRowPayload>
	) {
		const payloadRow = (payload.new ?? payload.old) as HourRowPayload | null;
		const payloadDayId = payloadRow?.day_id ?? null;
		if (payloadDayId && payloadDayId !== day_id) return;
		const reloadSnapshot = () => {
			if (!day_id) return;
			void (async () => {
				try {
					await loadHoursForDay(user_id, day_id);
				} catch (error) {
					console.error('realtime hours reload error', { user_id, day_id, error });
				}
			})();
		};
		const event = payload.eventType;
		if (event === 'DELETE') {
			const oldRow = payload.old;
			if (!oldRow) {
				reloadSnapshot();
				return;
			}
			const hour = Number(oldRow.hour);
			if (Number.isNaN(hour) || oldRow.half == null) {
				reloadSnapshot();
				return;
			}
			const half = oldRow.half ? 1 : 0;
			applyRealtimeBlockValue(user_id, hour, half, null);
			return;
		}
		const row = payload.new;
		if (!row) {
			reloadSnapshot();
			return;
		}
		const hour = Number(row.hour);
		if (Number.isNaN(hour) || row.half == null) {
			reloadSnapshot();
			return;
		}
		const half = row.half ? 1 : 0;
		const oldRow = payload.old as HourRowPayload | null | undefined;
		if (!oldRow) {
			reloadSnapshot();
			return;
		}
		const oldHour = Number(oldRow.hour);
		const oldHalfValue = oldRow.half;
		if (Number.isNaN(oldHour) || oldHalfValue == null) {
			reloadSnapshot();
			return;
		}
		const oldHalf = oldHalfValue ? 1 : 0;
		if (oldHour !== hour || oldHalf !== half) {
			reloadSnapshot();
			return;
		}

		const blockValue: BlockValue = {
			title: row.title ?? '',
			status: (row.status as boolean | null) ?? null,
			category: (row.category as BlockCategory | null) ?? null
		};
		applyRealtimeBlockValue(user_id, hour, half, blockValue);
	}
	function teardownHoursRealtime(user_id: string) {
		const current = hoursRealtimeByUser[user_id];
		if (!current) return;
		current.channel.unsubscribe();
		hoursRealtimeByUser[user_id] = null;
	}
	function ensureHoursRealtime(user_id: string, day_id: string | null) {
		const existing = hoursRealtimeByUser[user_id];
		if (viewerUserId && user_id === viewerUserId) {
			if (existing) teardownHoursRealtime(user_id);
			return;
		}
		if (!day_id) {
			if (existing) teardownHoursRealtime(user_id);
			return;
		}
		if (existing && existing.day_id === day_id) return;
		if (existing) teardownHoursRealtime(user_id);
		const channel = supabase.channel(`hours:${user_id}:${day_id}`);
		channel.on('postgres_changes', { event: '*', schema: 'public', table: 'hours' }, (payload) =>
			handleHoursRealtimeChange(
				user_id,
				day_id,
				payload as RealtimePostgresChangesPayload<HourRowPayload>
			)
		);
		channel.subscribe();
		hoursRealtimeByUser[user_id] = { channel, day_id };
	}
	function teardownSelectedBlockRealtime(user_id: string) {
		const current = selectedBlockRealtimeByUser[user_id];
		if (!current) return;
		current.unsubscribe();
		selectedBlockRealtimeByUser[user_id] = null;
	}
	function updateRemoteSelectionState(user_id: string, block: SelectedBlock | null) {
		remoteSelectedBlocks = { ...remoteSelectedBlocks, [user_id]: block };
	}
	function selectionFromDbValues(hourValue: unknown, halfValue: unknown): SelectedBlock | null {
		const hour = Number(hourValue);
		if (!Number.isFinite(hour)) return null;
		const hourIndex = getHourIndex(hour);
		if (hourIndex === -1) return null;
		if (halfValue === null || halfValue === undefined) return null;
		const halfNumber = Number(halfValue);
		const half = halfNumber === 1 ? 1 : 0;
		return { hourIndex, half };
	}
	function applyRemoteSelectionFromDb(user_id: string, hourValue: unknown, halfValue: unknown) {
		const block = selectionFromDbValues(hourValue, halfValue);
		updateRemoteSelectionState(user_id, block);
	}
	function handleSelectedBlockRealtime(
		user_id: string,
		payload: RealtimePostgresChangesPayload<SelectedBlockRowPayload>
	) {
		const row = (payload.new ?? payload.old) as SelectedBlockRowPayload | null;
		if (!row || row.id !== user_id) return;
		applyRemoteSelectionFromDb(user_id, row.selected_block_hour, row.selected_block_half);
	}
	function ensureSelectedBlockRealtime(user_id: string) {
		const existing = selectedBlockRealtimeByUser[user_id];
		if (viewerUserId && user_id === viewerUserId) {
			if (existing) teardownSelectedBlockRealtime(user_id);
			return;
		}
		if (existing) return;
		const channel = supabase.channel(`selected-block:${user_id}`);
		channel.on('postgres_changes', { event: '*', schema: 'public', table: 'users' }, (payload) =>
			handleSelectedBlockRealtime(
				user_id,
				payload as RealtimePostgresChangesPayload<SelectedBlockRowPayload>
			)
		);
		channel.subscribe();
		selectedBlockRealtimeByUser[user_id] = channel;
	}
	async function broadcastSelectedBlock(selection: SelectedBlock | null) {
		if (!viewerUserId) return;
		const hour =
			selection && selection.hourIndex >= 0 && selection.hourIndex < hours.length
				? hours[selection.hourIndex]
				: null;
		const halfValue = selection ? (selection.half === 1 ? true : false) : null;
		const key = hour === null || halfValue === null ? 'null' : `${hour}-${halfValue ? 1 : 0}`;
		if (lastBroadcastedSelectionKey === key) return;
		const previousKey = lastBroadcastedSelectionKey;
		lastBroadcastedSelectionKey = key;
		const { error } = await supabase
			.from('users')
			.update({
				selected_block_hour: hour,
				selected_block_half: halfValue
			})
			.eq('id', viewerUserId);
		if (error) {
			console.error('selected block update error', error);
			lastBroadcastedSelectionKey = previousKey;
		}
	}
	function teardownAllRealtime() {
		for (const userId of Object.keys(hoursRealtimeByUser)) {
			teardownHoursRealtime(userId);
		}
		for (const userId of Object.keys(selectedBlockRealtimeByUser)) {
			teardownSelectedBlockRealtime(userId);
		}
	}
	async function loadHabitsForUser(user_id: string) {
		const { data, error } = await supabase
			.from('habits')
			.select('hour, half, name')
			.eq('user_id', user_id);
		if (error) throw error;
		const next: Record<number, HabitBlockRow> = {};
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
	function blockHasElapsed(hour: number, half: 0 | 1) {
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
			setSelectedBlock({ hourIndex, half: half01 });
		}
		const block = getBlock(user_id, h, half01);
		draft = {
			user_id,
			hour: h,
			half: half01,
			title: block.title ?? '',
			status: block.status ?? null,
			category: block.category ?? null
		};
		editorMode = normal ?? editorMode;
		logOpen = true;
	}

	function closeLogModal() {
		logOpen = false;
		if (!viewerUserId) return;
		hoverBlock = null;
		suppressHoverSelection = true;
	}

	async function saveLog(
		text: string,
		status: boolean | null,
		hour: number,
		half: 0 | 1,
		blockCount: number,
		category: BlockCategory | null
	) {
		const { user_id } = draft;
		if (!user_id || hour == null || half == null) return;
		const day_id = dayIdByUser[user_id];
		if (!day_id) return;

		const hourIndex = getHourIndex(hour);
		if (hourIndex === -1) return;
		const totalBlocks = hours.length * 2;
		const isNewBlock = (draft.title ?? '').trim().length === 0;
		const maxCount = maxBlockCountFor(user_id, hour, half);
		const desiredCount = isNewBlock ? Math.min(blockCount, maxCount) : 1;
		const targets: { hour: number; half: 0 | 1 }[] = [];
		const trimmedTitle = text.trim();
		let resolvedCategory = category;
		if (!resolvedCategory && trimmedTitle) {
			const prevIndex = blockIndex(hourIndex, half) - 1;
			if (prevIndex >= 0) {
				const { hour: prevHour, half: prevHalf } = blockFromIndex(prevIndex);
				if (prevHour !== undefined) {
					const prevTitle = getTitle(user_id, prevHour, prevHalf).trim();
					if (prevTitle === trimmedTitle) {
						resolvedCategory = getCategory(user_id, prevHour, prevHalf);
					}
				}
			}
		}
		for (let offset = 0; offset < desiredCount; offset += 1) {
			const nextIndex = blockIndex(hourIndex, half) + offset;
			if (nextIndex >= totalBlocks) break;
			const { hour: nextHour, half: nextHalf } = blockFromIndex(nextIndex);
			if (nextHour === undefined) break;
			if (offset > 0 && blockHasContent(user_id, nextHour, nextHalf)) break;
			targets.push({ hour: nextHour, half: nextHalf });
		}
		if (targets.length === 0) return;

		const payload = targets.map((target) => ({
			day_id,
			hour: target.hour,
			half: target.half === 1,
			title: text,
			status,
			category: resolvedCategory
		}));
		const { error } = await supabase
			.from('hours')
			.upsert(payload, { onConflict: 'day_id,hour,half' });

		if (error) {
			console.error('save error', error);
			return;
		}

		for (const target of targets) {
			setTitle(user_id, target.hour, target.half, text, status, resolvedCategory);
		}
		if (viewerUserId && user_id === viewerUserId) {
			if (hourIndex !== -1) {
				setSelectedBlock({ hourIndex, half });
				hoverBlock = null;
				suppressHoverSelection = true;
			}
		}

		closeLogModal();
	}

	async function cycleStatus(user_id: string, hour: number, half: 0 | 1) {
		if (viewerUserId !== user_id) return;
		if (suppressNextClick) return;
		const day_id = dayIdByUser[user_id];
		if (!day_id) return;
		const habitName = (getHabitTitle(user_id, hour, half) ?? '').trim();
		const isHabitBlock = habitName.length > 0;
		const block = getBlock(user_id, hour, half);
		if (isHabitBlock) {
			const nextStatus = block.status === true ? false : true;
			const resolvedTitle = (block.title ?? '').trim() || habitName;
			const { error } = await supabase.from('hours').upsert(
				{
					day_id,
					hour,
					half: half === 1,
					title: resolvedTitle,
					status: nextStatus,
					habit: true
				},
				{ onConflict: 'day_id,hour,half' }
			);
			if (error) {
				console.error('cycle habit status error', error);
				return;
			}
			setTitle(user_id, hour, half, resolvedTitle, nextStatus);
			void loadHabitStreaksForUser(user_id);
			return;
		}
		const title = (block.title ?? '').trim();
		if (!title) return;
		const nextStatus = block.status === null ? false : block.status === false ? true : null;
		const hourIndex = getHourIndex(hour);
		if (hourIndex === -1) return;
		const { startIndex, endIndex } = blockRunRange(user_id, hour, half);
		const updates = [] as {
			day_id: string;
			hour: number;
			half: boolean;
			title: string;
			status: boolean | null;
		}[];
		for (let idx = startIndex; idx <= endIndex; idx += 1) {
			const { hour: targetHour, half: targetHalf } = blockFromIndex(idx);
			if (targetHour === undefined) break;
			const targetTitle = getTitle(user_id, targetHour, targetHalf).trim();
			if (targetTitle !== title) continue;
			updates.push({
				day_id,
				hour: targetHour,
				half: targetHalf === 1,
				title: targetTitle,
				status: nextStatus
			});
		}
		if (updates.length === 0) return;
		const { error } = await supabase.from('hours').upsert(updates, {
			onConflict: 'day_id,hour,half'
		});
		if (error) {
			console.error('cycle status error', error);
			return;
		}
		for (const update of updates) {
			setStatus(user_id, update.hour, update.half ? 1 : 0, nextStatus);
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
		return blockHasContent(user_id, toHour, toHalf);
	}
	async function submitMove(
		move: PendingMove,
		source: 'drag' | 'cut' | null = null
	): Promise<boolean> {
		isMoveSubmitting = true;
		try {
			const success = await moveBlock(move);
			if (success && source === 'cut') {
				if (viewerUserId === move.user_id) {
					const hourIndex = getHourIndex(move.toHour);
					if (hourIndex !== -1) {
						setSelectedBlock({ hourIndex, half: move.toHalf });
					}
				}
				cancelCutBlock();
			}
			if (success && pendingMoveSource === source) {
				pendingMoveSource = null;
			}
			return success;
		} finally {
			isMoveSubmitting = false;
		}
	}
	async function moveBlock(move: PendingMove): Promise<boolean> {
		const { user_id, fromHour, fromHalf, toHour, toHalf } = move;
		if (viewerUserId !== user_id) return false;
		const day_id = dayIdByUser[user_id];
		if (!day_id) return false;
		if (!blockHasContent(user_id, fromHour, fromHalf)) return false;

		const sourceBlock = getBlock(user_id, fromHour, fromHalf);
		const sourceValue: BlockValue = {
			title: sourceBlock.title ?? '',
			status: sourceBlock.status,
			category: sourceBlock.category ?? null
		};
		const destinationHadEntry = blockHasContent(user_id, toHour, toHalf);
		const destinationBlockValue = destinationHadEntry ? getBlock(user_id, toHour, toHalf) : null;
		const destinationValue: BlockValue | null = destinationBlockValue
			? {
					title: destinationBlockValue.title ?? '',
					status: destinationBlockValue.status,
					category: destinationBlockValue.category ?? null
				}
			: null;
		const destinationHasHoursContent =
			destinationValue !== null && (destinationValue.title ?? '').trim().length > 0;
		const sourceHabitName = (getHabitTitle(user_id, fromHour, fromHalf) ?? '').trim();
		const destinationHabitName = (getHabitTitle(user_id, toHour, toHalf) ?? '').trim();

		const { error: deleteDestErr } = await supabase
			.from('hours')
			.delete()
			.eq('day_id', day_id)
			.eq('hour', toHour)
			.eq('half', toHalf === 1);
		if (deleteDestErr) {
			console.error('block move destination delete error', deleteDestErr);
			return false;
		}

		const { error: updateErr } = await supabase
			.from('hours')
			.update({ hour: toHour, half: toHalf === 1 })
			.eq('day_id', day_id)
			.eq('hour', fromHour)
			.eq('half', fromHalf === 1);

		if (updateErr) {
			console.error('block move error', updateErr);
			return false;
		}

		setTitle(user_id, toHour, toHalf, sourceValue.title, sourceValue.status, sourceValue.category);
		if (destinationHasHoursContent && destinationValue) {
			const { error: swapInsertErr } = await supabase.from('hours').upsert(
				{
					day_id,
					hour: fromHour,
					half: fromHalf === 1,
					title: destinationValue.title ?? '',
					status: destinationValue.status,
					category: destinationValue.category ?? null
				},
				{ onConflict: 'day_id,hour,half' }
			);
			if (swapInsertErr) {
				console.error('block swap insert error', swapInsertErr);
			}
			setTitle(
				user_id,
				fromHour,
				fromHalf,
				destinationValue.title ?? '',
				destinationValue.status,
				destinationValue.category ?? null
			);
		} else {
			setTitle(user_id, fromHour, fromHalf, '', null, null);
		}

		if (destinationHabitName.length > 0) {
			const { error: deleteHabitErr } = await supabase
				.from('habits')
				.delete()
				.eq('user_id', user_id)
				.eq('hour', toHour)
				.eq('half', toHalf === 1);
			if (deleteHabitErr) {
				console.error('block move destination habit delete error', deleteHabitErr);
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
			const { error: insertHabitErr } = await supabase.from('habits').upsert(
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
			const success = await deleteBlock(pendingDelete);
			if (success) pendingDelete = null;
		} finally {
			isDeleteSubmitting = false;
		}
	}
	async function deleteBlock(action: PendingDelete): Promise<boolean> {
		const { user_id, hour, half } = action;
		if (viewerUserId !== user_id) return false;
		const day_id = dayIdByUser[user_id];
		const title = (getTitle(user_id, hour, half) ?? '').trim();
		const status = getStatus(user_id, hour, half);
		const hourIndex = getHourIndex(hour);
		const totalBlocks = hours.length * 2;
		if (day_id) {
			const { error } = await supabase
				.from('hours')
				.delete()
				.eq('day_id', day_id)
				.eq('hour', hour)
				.eq('half', half === 1);
			if (error) {
				console.error('block delete error', error);
				return false;
			}
			if (title && hourIndex !== -1) {
				const currentIndex = blockIndex(hourIndex, half);
				const prevIndex = currentIndex - 1;
				const nextIndex = currentIndex + 1;
				if (prevIndex >= 0 && nextIndex < totalBlocks) {
					const prevBlock = blockFromIndex(prevIndex);
					const nextBlock = blockFromIndex(nextIndex);
					if (prevBlock.hour !== undefined && nextBlock.hour !== undefined) {
						const prevTitle = (getTitle(user_id, prevBlock.hour, prevBlock.half) ?? '').trim();
						const nextTitle = (getTitle(user_id, nextBlock.hour, nextBlock.half) ?? '').trim();
						const isMiddleOfRun = prevTitle === title && nextTitle === title;

						if (isMiddleOfRun) {
							const { error: completeErr } = await supabase.from('hours').upsert(
								{
									day_id,
									hour: prevBlock.hour,
									half: prevBlock.half === 1,
									title: prevTitle,
									status: true
								},
								{ onConflict: 'day_id,hour,half' }
							);
							if (completeErr) {
								console.error('block delete split error', completeErr);
							} else {
								setStatus(user_id, prevBlock.hour, prevBlock.half, true);
							}
						}
					}
				}
			}
		}

		setTitle(user_id, hour, half, '', null);
		return true;
	}

	function blockKey(u: string, date: string, h: number, half: 0 | 1) {
		return `${u}|${date}|${h}|${half}`;
	}

	function maybePromptForMissing() {
		return;
	}

	async function markPreviousBlockCompleteAndOpenCurrent() {
		if (!carryoverPrompt) return;
		if (isCarryoverSubmitting) return;
		isCarryoverSubmitting = true;

		const { user_id, prevHour, prevHalf, currHour, currHalf } = carryoverPrompt;
		try {
			const day_id = dayIdByUser[user_id];
			if (!day_id) return;

			const prevBlock = getBlock(user_id, prevHour, prevHalf);

			// Mark previous as completed (status = true)
			const { error } = await supabase.from('hours').upsert(
				{
					day_id,
					hour: prevHour,
					half: prevHalf === 1,
					title: prevBlock.title ?? '',
					status: true
				},
				{ onConflict: 'day_id,hour,half' }
			);

			if (error) {
				console.error('mark previous status completed error', error);
				return;
			}

			setStatus(user_id, prevHour, prevHalf, true);

			// Close prompt and open editor for the current block
			carryoverPrompt = null;
			openEditor(user_id, currHour, currHalf, false);
		} finally {
			isCarryoverSubmitting = false;
		}
	}

	async function continuePreviousBlockIntoCurrent() {
		if (!carryoverPrompt) return;
		if (isCarryoverSubmitting) return;
		isCarryoverSubmitting = true;

		const { user_id, prevHour, prevHalf, currHour, currHalf, title } = carryoverPrompt;
		try {
			const day_id = dayIdByUser[user_id];
			if (!day_id) return;

			const prevBlock = getBlock(user_id, prevHour, prevHalf);

			// 1) Mark the entire run in progress (status = false)
			{
				const { startIndex, endIndex } = blockRunRange(user_id, prevHour, prevHalf);
				const updates = [] as {
					day_id: string;
					hour: number;
					half: boolean;
					title: string;
					status: boolean | null;
				}[];
				for (let idx = startIndex; idx <= endIndex; idx += 1) {
					const { hour, half } = blockFromIndex(idx);
					if (hour === undefined) break;
					const nextTitle = getTitle(user_id, hour, half).trim();
					if (nextTitle !== title) continue;
					updates.push({
						day_id,
						hour,
						half: half === 1,
						title: nextTitle,
						status: false
					});
				}
				if (updates.length > 0) {
					const { error } = await supabase.from('hours').upsert(updates, {
						onConflict: 'day_id,hour,half'
					});
					if (error) {
						console.error('mark run in progress error', error);
						return;
					}
					for (const update of updates) {
						setStatus(user_id, update.hour, update.half ? 1 : 0, false);
					}
				}
			}

			const currTitle = (getTitle(user_id, currHour, currHalf) ?? '').trim();
			const currStatus = getStatus(user_id, currHour, currHalf);
			const currHabit = (getHabitTitle(user_id, currHour, currHalf) ?? '').trim();
			const hasCurrentContent = currTitle.length > 0 || currHabit.length > 0;
			if (hasCurrentContent && currTitle.length > 0 && currHabit.length === 0) {
				const currHourIndex = getHourIndex(currHour);
				if (currHourIndex !== -1) {
					const currIndex = blockIndex(currHourIndex, currHalf);
					const shifted = await shiftBlocksFromIndex(user_id, currIndex, 1);
					if (!shifted) {
						return;
					}
				}
			}

			// 2) Copy into current block as in progress
			{
				const { error } = await supabase.from('hours').upsert(
					{
						day_id,
						hour: currHour,
						half: currHalf === 1,
						title,
						status: false,
						category: prevBlock.category ?? null
					},
					{ onConflict: 'day_id,hour,half' }
				);
				if (error) {
					console.error('create continued status in current block error', error);
					return;
				}
				setTitle(user_id, currHour, currHalf, title, false, prevBlock.category ?? null);
			}

			carryoverPrompt = null;
			// You can choose whether to auto-open the editor here.
			// Spec says just copy it, so no openEditor() call.
		} finally {
			isCarryoverSubmitting = false;
		}
	}

	function cancelCarryoverPrompt() {
		if (isCarryoverSubmitting) return;
		carryoverPrompt = null;
	}

	function cancelPlannedPrompt() {
		if (isPlannedSubmitting) return;
		plannedPrompt = null;
	}

	function openEditorIfEmpty(user_id: string, hour: number, half: 0 | 1) {
		if (!blockHasContent(user_id, hour, half)) {
			openEditor(user_id, hour, half, false);
		}
	}

	async function markPlannedComplete() {
		if (!plannedPrompt || isPlannedSubmitting) return;
		isPlannedSubmitting = true;
		const { user_id, prevHour, prevHalf, currHour, currHalf, title } = plannedPrompt;
		try {
			const day_id = dayIdByUser[user_id];
			if (!day_id) return;
			const { startIndex, endIndex } = blockRunRange(user_id, prevHour, prevHalf);
			const updates = [] as {
				day_id: string;
				hour: number;
				half: boolean;
				title: string;
				status: boolean | null;
			}[];
			for (let idx = startIndex; idx <= endIndex; idx += 1) {
				const { hour, half } = blockFromIndex(idx);
				if (hour === undefined) break;
				const nextTitle = getTitle(user_id, hour, half).trim();
				if (nextTitle !== title) continue;
				updates.push({
					day_id,
					hour,
					half: half === 1,
					title: nextTitle,
					status: true
				});
			}
			if (updates.length > 0) {
				const { error } = await supabase.from('hours').upsert(updates, {
					onConflict: 'day_id,hour,half'
				});
				if (error) {
					console.error('planned complete error', error);
					return;
				}
				for (const update of updates) {
					setStatus(user_id, update.hour, update.half ? 1 : 0, true);
				}
			}
			plannedPrompt = null;
			openEditorIfEmpty(user_id, currHour, currHalf);
		} finally {
			isPlannedSubmitting = false;
		}
	}

	async function markPlannedInProgress() {
		if (!plannedPrompt || isPlannedSubmitting) return;
		isPlannedSubmitting = true;
		const { user_id, prevHour, prevHalf, currHour, currHalf, title } = plannedPrompt;
		try {
			const day_id = dayIdByUser[user_id];
			if (!day_id) return;
			const { startIndex, endIndex } = blockRunRange(user_id, prevHour, prevHalf);
			const updates = [] as {
				day_id: string;
				hour: number;
				half: boolean;
				title: string;
				status: boolean | null;
			}[];
			for (let idx = startIndex; idx <= endIndex; idx += 1) {
				const { hour, half } = blockFromIndex(idx);
				if (hour === undefined) break;
				const nextTitle = getTitle(user_id, hour, half).trim();
				if (nextTitle !== title) continue;
				updates.push({
					day_id,
					hour,
					half: half === 1,
					title: nextTitle,
					status: false
				});
			}
			if (updates.length > 0) {
				const { error } = await supabase.from('hours').upsert(updates, {
					onConflict: 'day_id,hour,half'
				});
				if (error) {
					console.error('planned in-progress error', error);
					return;
				}
				for (const update of updates) {
					setStatus(user_id, update.hour, update.half ? 1 : 0, false);
				}
			}

			const currHasContent = blockHasContent(user_id, currHour, currHalf);
			const currHourIndex = getHourIndex(currHour);
			const currentIndex = currHourIndex === -1 ? -1 : blockIndex(currHourIndex, currHalf);
			const isCurrentInRun = currentIndex >= startIndex && currentIndex <= endIndex;
			const isCurrentPlannedBlock = currHour === prevHour && currHalf === prevHalf;
			if (currHasContent && !isCurrentPlannedBlock && !isCurrentInRun) {
				if (currHourIndex !== -1) {
					const shifted = await shiftBlocksFromIndex(user_id, currentIndex, 1, 1);
					if (!shifted) return;
				}
			}

			if (!isCurrentInRun) {
				const { error: currentErr } = await supabase.from('hours').upsert(
					{
						day_id,
						hour: currHour,
						half: currHalf === 1,
						title,
						status: false
					},
					{ onConflict: 'day_id,hour,half' }
				);
				if (currentErr) {
					console.error('planned continue error', currentErr);
					return;
				}
				setTitle(user_id, currHour, currHalf, title, false);
			}

			plannedPrompt = null;
		} finally {
			isPlannedSubmitting = false;
		}
	}

	async function startPlannedNow() {
		if (!plannedPrompt || isPlannedSubmitting) return;
		isPlannedSubmitting = true;
		const { user_id, prevHour, prevHalf, currHour, currHalf, title } = plannedPrompt;
		try {
			const day_id = dayIdByUser[user_id];
			if (!day_id) return;
			const { startIndex, endIndex } = blockRunRange(user_id, prevHour, prevHalf);
			const runLength = endIndex - startIndex + 1;
			const deletions = [] as { hour: number; half: 0 | 1 }[];
			for (let idx = startIndex; idx <= endIndex; idx += 1) {
				const { hour, half } = blockFromIndex(idx);
				if (hour === undefined) break;
				deletions.push({ hour, half });
			}
			if (deletions.length > 0) {
				const results = await Promise.all(
					deletions.map((target) =>
						supabase
							.from('hours')
							.delete()
							.eq('day_id', day_id)
							.eq('hour', target.hour)
							.eq('half', target.half === 1)
					)
				);
				const deleteErr = results.find((result) => result.error)?.error;
				if (deleteErr) {
					console.error('planned delete error', deleteErr);
					return;
				}
				for (const target of deletions) {
					setTitle(user_id, target.hour, target.half, '', null);
				}
			}
			const currHourIndex = getHourIndex(currHour);
			if (currHourIndex === -1) return;
			const currIndex = blockIndex(currHourIndex, currHalf);
			const shifted = await shiftBlocksFromIndex(user_id, currIndex, 1, runLength);
			if (!shifted) return;
			const totalBlocks = hours.length * 2;
			const targets: { hour: number; half: 0 | 1 }[] = [];
			for (let idx = currIndex; idx < totalBlocks && targets.length < runLength; idx += 1) {
				const { hour, half } = blockFromIndex(idx);
				if (hour === undefined) break;
				if (blockHasContent(user_id, hour, half)) continue;
				targets.push({ hour, half });
			}
			if (targets.length === 0) return;
			const payload = targets.map((target) => ({
				day_id,
				hour: target.hour,
				half: target.half === 1,
				title,
				status: false
			}));
			const { error } = await supabase.from('hours').upsert(payload, {
				onConflict: 'day_id,hour,half'
			});
			if (error) {
				console.error('planned start now error', error);
				return;
			}
			for (const target of targets) {
				setTitle(user_id, target.hour, target.half, title, false);
			}
			plannedPrompt = null;
		} finally {
			isPlannedSubmitting = false;
		}
	}

	async function resolveHabitPrompt(completed: boolean) {
		if (!habitCheckPrompt || isHabitPromptSubmitting) return;
		isHabitPromptSubmitting = true;

		const { user_id, habitHour, habitHalf, currHour, currHalf, habitKey, habitName } =
			habitCheckPrompt;
		try {
			const day_id = dayIdByUser[user_id];
			if (!day_id) return;
			const block = getBlock(user_id, habitHour, habitHalf);
			const resolvedTitle = (block.title ?? '').trim() || habitName;
			const { error } = await supabase.from('hours').upsert(
				{
					day_id,
					hour: habitHour,
					half: habitHalf === 1,
					title: resolvedTitle,
					status: completed,
					habit: true
				},
				{ onConflict: 'day_id,hour,half' }
			);
			if (error) {
				console.error('habit prompt update error', error);
				return;
			}
			setTitle(user_id, habitHour, habitHalf, resolvedTitle, completed);
			habitCheckPrompt = null;
			void loadHabitStreaksForUser(user_id);
		} finally {
			isHabitPromptSubmitting = false;
		}
		openEditor(user_id, currHour, currHalf, false);
	}

	async function refreshSpectatorDay(dateStr: string) {
		const perUserLoads = people.map(async ({ user_id }) => {
			const dayId = await getDayIdForUser(user_id, dateStr, false);
			dayIdByUser[user_id] = dayId;
			if (dayId) {
				await loadHoursForDay(user_id, dayId);
			} else {
				blocksByUser = { ...blocksByUser, [user_id]: {} };
			}
			ensureHoursRealtime(user_id, dayId);
		});
		await Promise.all(perUserLoads);
	}

	function shouldAutoSwitchDay() {
		if (!viewerUserId) return false;
		const activeDayDate = activeDayDateByUser[viewerUserId];
		if (activeDayDate === undefined || activeDayDate === null) return false;
		const yesterday = dateStringNDaysAgo(1);
		const should = currentHour >= START_HOUR && activeDayDate === yesterday;
		console.log('shouldAutoSwitchDay check', {
			currentHour,
			START_HOUR,
			activeDayDate,
			localToday: localToday(),
			yesterday,
			should,
			viewerUserId: viewerUserId?.slice(0, 8)
		});
		return should;
	}

	async function autoSwitchDayIfNeeded() {
		const should = shouldAutoSwitchDay();
		console.log('autoSwitchDayIfNeeded', { should, reviewOpen });
		if (!should) return;
		if (reviewOpen) return;
		await startNextDayPlanning();
	}

	function updateCurrentTime() {
		const now = getNow();
		currentHour = now.getHours();
		currentMinute = now.getMinutes();
		currentHalf = now.getMinutes() < 30 ? 0 : 1;
		void autoSwitchDayIfNeeded();
		maybePromptForMissing();
		if (!viewerUserId) {
			const today = localToday();
			if (!spectatorDate) {
				spectatorDate = today;
			} else if (spectatorDate !== today) {
				spectatorDate = today;
				void refreshSpectatorDay(today);
			}
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

	function blockInfoFromNow() {
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

	function notifyCurrentBlock() {
		if (!viewerUserId || !('Notification' in window) || Notification.permission !== 'granted') {
			return;
		}

		const { hour, half } = blockInfoFromNow();
		if (!withinWindow(hour)) return;

		const blockLabel = half === 0 ? 'Block A' : 'Block B';
		const hourLabel = `${String(hour).padStart(2, '0')}:${half === 0 ? '00' : '30'}`;

		const rawTitle = getTitle(viewerUserId, hour, half);
		const titleTxt = (rawTitle ?? '').trim();

		const notifTitle = `${blockLabel} • ${hourLabel}`;
		const body = titleTxt ? `TODO: ${titleTxt}` : undefined;

		new Notification(notifTitle, {
			body,
			tag: `block-${localToday()}-${hour}-${half}`,
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
			notifyCurrentBlock();
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
		lastBroadcastedSelectionKey = null;
		if (!viewerUserId) {
			selectedBlock = null;
			hoverBlock = null;
			cancelCutBlock();
		}

		try {
			const { data: rows, error: uerr } = await supabase
				.from('users')
				.select('id, display_name, selected_block_hour, selected_block_half, active_day_date')
				.order('display_name', { ascending: true });
			if (uerr) throw uerr;

			const nextActiveDayDates: Record<string, string | null> = {};
			people = (rows ?? []).map((r) => {
				const user_id = r.id as string;
				applyRemoteSelectionFromDb(user_id, r.selected_block_hour, r.selected_block_half);
				nextActiveDayDates[user_id] = (r.active_day_date as string | null) ?? null;
				return {
					label: r.display_name as string,
					user_id
				};
			});
			activeDayDateByUser = nextActiveDayDates;
			if (viewerUserId && !nextActiveDayDates[viewerUserId]) {
				const today = localToday();
				nextActiveDayDates[viewerUserId] = today;
				activeDayDateByUser = { ...nextActiveDayDates };
				const { error } = await supabase
					.from('users')
					.update({ active_day_date: today })
					.eq('id', viewerUserId);
				if (error) console.error('active day update error', error);
			}
			if (viewerUserId) {
				syncActiveDayDateStore(activeDayDateByUser[viewerUserId] ?? localToday());
			}

			updateTrackedPlayersFromPeople(people);
			startPlayerStatusWatchers(viewerUserId);
			startLocalPlayerPresenceIfTracked(viewerUserId);
			for (const person of people) {
				ensureSelectedBlockRealtime(person.user_id);
			}

			const perUserLoads = people.map(async ({ user_id }) => {
				const dateStr = displayDateForUser(user_id);
				const create = viewerUserId === user_id && Boolean(viewerUserId);
				const dayId = await getDayIdForUser(user_id, dateStr, create);
				dayIdByUser[user_id] = dayId;
				const tasks: Promise<void>[] = [
					loadHabitsForUser(user_id),
					loadHabitStreaksForUser(user_id)
				];
				if (dayId) tasks.push(loadHoursForDay(user_id, dayId));
				await Promise.all(tasks);
				ensureHoursRealtime(user_id, dayId);
			});

			const historyLoads = people.map(({ user_id }) => loadPlayerHistoryForUser(user_id));

			await Promise.all([...perUserLoads, ...historyLoads]);

			updateCurrentTime();
			void autoSwitchDayIfNeeded();
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
		const keyHandler = (event: KeyboardEvent) => {
			lastKeyAt = Date.now();
			setCursorHidden(true);
			handleGlobalKeydown(event);
		};
		const pointerHandler = (event: PointerEvent) => {
			if (suppressHoverSelection) suppressHoverSelection = false;
			const now = Date.now();
			const { clientX, clientY } = event;
			const moved = !hasPointer || Math.hypot(clientX - lastPointerX, clientY - lastPointerY) > 2;
			lastPointerX = clientX;
			lastPointerY = clientY;
			hasPointer = true;
			if (event.type === 'pointerdown') {
				setCursorHidden(false);
				return;
			}
			if (!moved) return;
			if (now - lastKeyAt < 150) return;
			setCursorHidden(false);
		};
		window.addEventListener('keydown', keyHandler);
		window.addEventListener('pointermove', pointerHandler);
		window.addEventListener('pointerdown', pointerHandler);
		requestAnimationFrame(() => (showTimes = true));
		return () => {
			stopClockTick();
			window.removeEventListener('keydown', keyHandler);
			window.removeEventListener('pointermove', pointerHandler);
			window.removeEventListener('pointerdown', pointerHandler);
			setCursorHidden(false);
		};
	});

	onDestroy(() => {
		stopPlayerStatusWatchers();
		stopLocalPlayerPresence?.();
		teardownAllRealtime();
	});
</script>

<div
	class="relative flex h-dvh w-full flex-col justify-center overflow-clip bg-white p-10 select-none"
	class:cursor-none={hideCursor}
>
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
									<div class="loading-block flex w-full rounded-md bg-stone-100"></div>
									<div class="loading-block flex w-full rounded-md bg-stone-100"></div>
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
										<div class="loading-block flex w-full rounded-md bg-stone-100"></div>
										<div class="loading-block flex w-full rounded-md bg-stone-100"></div>
									</div>
								{/each}
							{:else}
								{#each hours as h, hourIndex}
									{@const blockIsCutA = blockIsCut(person.user_id, h, 0)}
									{@const blockIsCutB = blockIsCut(person.user_id, h, 1)}
									<div
										class="hover:none flex h-7 w-full flex-row space-x-1"
										class:opacity-60={viewerUserId && viewerUserId !== person.user_id}
									>
										<div
											class="flex w-full min-w-0 bg-transparent"
											role="presentation"
											draggable={canDragBlock(person.user_id, h, 0)}
											onpointerdown={(e) =>
												handleBlockPointerDown(e, person.user_id, h, 0, hourIndex)}
											onpointerenter={() => handleBlockPointerEnter(person.user_id, hourIndex, 0)}
											onpointerleave={() => handleBlockPointerLeave(person.user_id, hourIndex, 0)}
											ondragstart={(event) => {
												handleBlockDragStart(event, person.user_id, h, 0, hourIndex);
											}}
											ondragover={(event) =>
												handleBlockDragOver(event, person.user_id, 0, hourIndex)}
											ondrop={(event) => handleBlockDrop(event, person.user_id, h, 0)}
											ondragend={handleBlockDragEnd}
										>
											<Block
												title={getTitle(person.user_id, h, 0)}
												status={getStatus(person.user_id, h, 0)}
												category={getCategory(person.user_id, h, 0)}
												showStatus={blockShowsStatus(person.user_id, h, 0)}
												editable={viewerUserId === person.user_id}
												onPrimaryAction={() => maybeHandlePaste(person.user_id, h, 0)}
												onSelect={() => handleBlockSelect(person.user_id, h, 0, false)}
												onCycleStatus={() => handleBlockCycle(person.user_id, h, 0)}
												habit={getHabitTitle(person.user_id, h, 0)}
												habitStreak={habitStreakForBlock(person.user_id, h, 0)}
												selected={blockIsHighlighted(person.user_id, hourIndex, 0)}
												isCurrent={blockIsCurrent(h, 0)}
												isCut={blockIsCutA}
											/>
										</div>
										<div
											class="flex w-full min-w-0 bg-transparent"
											role="presentation"
											draggable={canDragBlock(person.user_id, h, 1)}
											onpointerdown={(e) =>
												handleBlockPointerDown(e, person.user_id, h, 1, hourIndex)}
											onpointerenter={() => handleBlockPointerEnter(person.user_id, hourIndex, 1)}
											onpointerleave={() => handleBlockPointerLeave(person.user_id, hourIndex, 1)}
											ondragstart={(event) => {
												handleBlockDragStart(event, person.user_id, h, 1, hourIndex);
											}}
											ondragover={(event) =>
												handleBlockDragOver(event, person.user_id, 1, hourIndex)}
											ondrop={(event) => handleBlockDrop(event, person.user_id, h, 1)}
											ondragend={handleBlockDragEnd}
										>
											<Block
												title={getTitle(person.user_id, h, 1)}
												status={getStatus(person.user_id, h, 1)}
												category={getCategory(person.user_id, h, 1)}
												showStatus={blockShowsStatus(person.user_id, h, 1)}
												editable={viewerUserId === person.user_id}
												onPrimaryAction={() => maybeHandlePaste(person.user_id, h, 1)}
												onSelect={() => handleBlockSelect(person.user_id, h, 1, false)}
												onCycleStatus={() => handleBlockCycle(person.user_id, h, 1)}
												habit={getHabitTitle(person.user_id, h, 1)}
												habitStreak={habitStreakForBlock(person.user_id, h, 1)}
												selected={blockIsHighlighted(person.user_id, hourIndex, 1)}
												isCurrent={blockIsCurrent(h, 1)}
												isCut={blockIsCutB}
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
	{#if canShowReviewDayButton()}
		<div class="pointer-events-none absolute bottom-6 left-0 flex w-full justify-center">
			<button
				in:fly={{ y: 12, duration: 220 }}
				class="pointer-events-auto rounded-full border border-stone-300 px-4 py-2 text-[10px] font-semibold tracking-wide text-stone-700 uppercase hover:bg-stone-100"
				onclick={() => viewerUserId && openReviewDay(viewerUserId)}
			>
				Review day
			</button>
		</div>
	{/if}
</div>

{#if modalOverlayActive}
	<div class="pointer-events-none fixed inset-0 z-40 bg-black/40" aria-hidden="true"></div>
{/if}

{#if reviewOpen}
	<div class="fixed inset-0 z-[1900] flex items-center justify-center">
		<div class="w-full max-w-sm rounded-lg bg-white p-4 shadow-lg">
			<div class="flex items-start justify-between">
				<div>
					<div class="text-xs font-semibold tracking-wide text-stone-500 uppercase">Summary</div>
					{#if reviewDayDate}
						<div class="mt-1 text-sm font-medium text-stone-900">{reviewDayDate}</div>
					{/if}
				</div>
				<div class="flex flex-col items-end gap-1">
					<div
						class={`flex items-center justify-center rounded-md p-2 text-xs font-medium text-white ${reviewScoreColor(
							reviewStats?.score ?? 0
						)}`}
					>
						{reviewStats?.score ?? 0}
					</div>
				</div>
			</div>
			<div class="mt-4 space-y-2 text-sm text-stone-700">
				<div class="flex items-center justify-between">
					<span>Tasks planned</span>
					<span class="font-semibold text-stone-900">{reviewStats?.planned ?? 0}</span>
				</div>
				<div class="flex items-center justify-between">
					<span>Tasks completed</span>
					<span class="font-semibold text-stone-900">{reviewStats?.completed ?? 0}</span>
				</div>
				<div class="flex items-center justify-between">
					<span>Productive hours</span>
					<span class="font-semibold text-stone-900">
						{formatProductiveHours(reviewStats?.productiveHours ?? 0)}
					</span>
				</div>
			</div>
			<div class="mt-4">
				<div class="text-[11px] font-semibold tracking-wide text-stone-500 uppercase">
					Category breakdown
				</div>
				<div class="mt-2 space-y-1 text-sm text-stone-700">
					{#each reviewStats?.categoryBreakdown ?? [] as category}
						<div class="flex items-center justify-between">
							<span>{category.label}</span>
							<span class="font-semibold text-stone-900">
								{category.percent}% · {formatProductiveHours(category.hours)}h
							</span>
						</div>
					{/each}
				</div>
			</div>
			<div class="mt-4 flex justify-end gap-2">
				<button
					type="button"
					class="rounded-md border border-stone-300 px-3 py-1 text-xs font-medium text-stone-700 hover:bg-stone-100 disabled:opacity-60"
					onclick={closeReviewDay}
					disabled={reviewSubmitting}
				>
					Close
				</button>
				<button
					type="button"
					class="rounded-md bg-stone-900 px-3 py-1 text-xs font-semibold text-white hover:bg-stone-800 disabled:opacity-60"
					onclick={() => void startNextDayPlanning()}
					disabled={reviewSubmitting}
				>
					Start next day
				</button>
			</div>
		</div>
	</div>
{/if}

<LogModal
	normal={editorMode}
	open={logOpen}
	onClose={closeLogModal}
	onSave={saveLog}
	initialHour={draft.hour}
	initialHalf={draft.half}
	initialTitle={draft.title}
	initialStatus={draft.status}
	initialCategory={draft.category}
	habitStreaks={logModalHabitStreaks}
	maxBlockCountFor={(hour, half) => maxBlockCountFor(viewerUserId, hour, half)}
	runLengthFor={(hour, half) => blockRunLength(viewerUserId, hour, half)}
/>

{#if habitCheckPrompt}
	<div class="fixed inset-0 z-[1900] flex items-center justify-center">
		<div class="w-full max-w-sm rounded-lg bg-white p-4 shadow-lg">
			<div class="text-xs font-semibold tracking-wide text-stone-500 uppercase">Habit check</div>
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

{#if carryoverPrompt}
	<div class="fixed inset-0 z-[1900] flex items-center justify-center">
		<div class="w-full max-w-sm rounded-lg bg-white p-4 shadow-lg">
			<div class="text-xs font-semibold tracking-wide text-stone-500 uppercase">
				Previous block in progress
			</div>
			<div class="mt-1 text-sm font-medium text-stone-900">Did you complete this?</div>
			<div class="mt-2 truncate text-sm text-stone-700">
				{carryoverPrompt?.title}
			</div>

			<div class="mt-4 flex justify-end gap-2">
				<button
					type="button"
					class="rounded-md border border-stone-300 px-3 py-1 text-xs font-medium text-stone-700 hover:bg-stone-100"
					onclick={continuePreviousBlockIntoCurrent}
					disabled={isCarryoverSubmitting}
				>
					In progress
				</button>
				<button
					type="button"
					class="rounded-md bg-stone-900 px-3 py-1 text-xs font-semibold text-white hover:bg-stone-800 disabled:opacity-60"
					onclick={markPreviousBlockCompleteAndOpenCurrent}
					disabled={isCarryoverSubmitting}
				>
					Complete
				</button>
			</div>

			<button
				type="button"
				class="mt-2 text-xs text-stone-400 hover:text-stone-600"
				onclick={cancelCarryoverPrompt}
				disabled={isCarryoverSubmitting}
			>
				Cancel
			</button>
		</div>
	</div>
{/if}
{#if plannedPrompt}
	<div class="fixed inset-0 z-[1900] flex items-center justify-center">
		<div class="w-full max-w-sm rounded-lg bg-white p-4 shadow-lg">
			<div class="text-xs font-semibold tracking-wide text-stone-500 uppercase">Planned block</div>
			<div class="mt-1 text-sm font-medium text-stone-900">Did you start this?</div>
			<div class="mt-2 truncate text-sm text-stone-700">{plannedPrompt?.title}</div>

			<div class="mt-4 flex flex-wrap justify-end gap-2">
				<button
					type="button"
					class="rounded-md border border-stone-300 px-3 py-1 text-xs font-medium text-stone-700 hover:bg-stone-100"
					onclick={() => void markPlannedComplete()}
					disabled={isPlannedSubmitting}
				>
					Completed
				</button>
				<button
					type="button"
					class="rounded-md border border-stone-300 px-3 py-1 text-xs font-medium text-stone-700 hover:bg-stone-100"
					onclick={() => void markPlannedInProgress()}
					disabled={isPlannedSubmitting}
				>
					In progress
				</button>
				<button
					type="button"
					class="rounded-md bg-stone-900 px-3 py-1 text-xs font-semibold text-white hover:bg-stone-800 disabled:opacity-60"
					onclick={() => void startPlannedNow()}
					disabled={isPlannedSubmitting}
				>
					Start now
				</button>
			</div>

			<button
				type="button"
				class="mt-2 text-xs text-stone-400 hover:text-stone-600"
				onclick={cancelPlannedPrompt}
				disabled={isPlannedSubmitting}
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
	blockLabel={pendingMoveSummary?.blockLabel ?? ''}
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
	blockLabel={pendingDeleteSummary?.blockLabel ?? ''}
	fromLabel={pendingDeleteSummary?.locationLabel ?? ''}
	toLabel={pendingDeleteSummary?.locationLabel ?? ''}
	destinationLabel={null}
	hasDestinationContent={pendingDeleteSummary?.hasContent ?? false}
	isHabit={pendingDeleteSummary?.isHabit ?? false}
	mode="delete"
	loading={isDeleteSubmitting}
/>

<style>
	.loading-block,
	.loading-sheen {
		position: relative;
		overflow: hidden;
	}

	.loading-block::after,
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
		animation: block-sheen 0.5s linear infinite;
	}

	@keyframes block-sheen {
		100% {
			transform: translateX(100%);
		}
	}
</style>
