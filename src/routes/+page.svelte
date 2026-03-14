<script lang="ts">
	import ConfirmMoveModal from '$lib/components/ConfirmMoveModal.svelte';
	import LogModal from '$lib/components/LogModal.svelte';
	import PlayerStatusTag from '$lib/components/PlayerStatusTag.svelte';
	import Block from '$lib/components/Block.svelte';
	import SettingsModal from '$lib/components/SettingsModal.svelte';
	import { scale, fly } from 'svelte/transition';
	import { watchPlayerStatus, trackPlayerPresence, type PlayerStatus } from '$lib/playerPresence';
	import type { PlayerStreak } from '$lib/streaks';
	import { TRACKED_PLAYERS, type TrackedPlayerKey } from '$lib/trackedPlayers';
	import { getContext, onDestroy, onMount } from 'svelte';
	import { supabase } from '$lib/supabaseClient';
	import type { Writable } from 'svelte/store';
	import { get } from 'svelte/store';
	import type { Session } from '$lib/session';
	import { formatLocalTimestamp } from '$lib/time';
	import type { RealtimeChannel, RealtimePostgresChangesPayload } from '@supabase/supabase-js';
	import { fetchCompletionByDate } from '$lib/heatmap';
	import { heatmapStore } from '$lib/heatmapStore';
	import { page } from '$app/stores';

	type Person = { label: string; user_id: string };
	type SummaryCategoryKey = 'body' | 'rest' | 'work' | 'admin' | 'bad';
	type SummaryCategory = {
		key: SummaryCategoryKey;
		label: string;
		percent: number;
		hours: number;
	};
	type SummaryStats = {
		planned: number;
		completed: number;
		productiveHours: number;
		score: number;
		categoryBreakdown: SummaryCategory[];
	};

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
	let settingsOpen = $state(false);
	let singlePlayerMode = $state(false);
	let singlePlayerLoadedFor = $state<string | null>(null);
	const HEATMAP_REFRESH_EVENT = 'heatmap-refresh';
	const EVENT_MODAL_OPEN_EVENT = 'event-modal-open';
	let completionRefreshTimeout: number | null = null;

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

	const START_HOUR = 6;
	const END_HOUR = START_HOUR + 16;
	const hours = Array.from({ length: END_HOUR - START_HOUR }, (_, i) => START_HOUR + i);
	const TOTAL_BLOCKS_PER_DAY = hours.length * 2;
	const STREAK_LOOKBACK_DAYS = 365;
	const COMPLETION_STREAK_LOOKBACK_DAYS = 365;
	const COMPLETION_STREAK_THRESHOLD = 0.75;
	const STREAK_TOP_BRACKET_PCT = Math.round(COMPLETION_STREAK_THRESHOLD * 100);
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
	const isSinglePlayerView = $derived.by(() => Boolean(viewerUserId && singlePlayerMode));
	const visiblePeople = $derived.by(() => {
		if (!viewerUserId || !singlePlayerMode) return people;
		return people.filter((person) => person.user_id === viewerUserId);
	});

	const singlePlayerStorageKey = (userId: string) => `fz.singlePlayer.${userId}`;

	$effect(() => {
		if (typeof window === 'undefined') return;
		if (!viewerUserId) {
			singlePlayerLoadedFor = null;
			singlePlayerMode = false;
			return;
		}
		if (singlePlayerLoadedFor === viewerUserId) return;
		const stored = window.localStorage.getItem(singlePlayerStorageKey(viewerUserId));
		singlePlayerMode = stored === 'true';
		singlePlayerLoadedFor = viewerUserId;
	});

	$effect(() => {
		if (typeof window === 'undefined') return;
		if (!viewerUserId) {
			upcomingEvents = [];
			return;
		}
		void loadUpcomingEvents(viewerUserId);
	});

	$effect(() => {
		if (typeof window === 'undefined') return;
		if (!viewerUserId) return;
		if (singlePlayerLoadedFor !== viewerUserId) return;
		window.localStorage.setItem(
			singlePlayerStorageKey(viewerUserId),
			singlePlayerMode ? 'true' : 'false'
		);
	});

	let reviewSubmitting = $state(false);
	let hideCursor = $state(false);
	let lastPointerX = 0;
	let lastPointerY = 0;
	let hasPointer = false;
	let lastKeyAt = 0;

	type UpcomingEvent = {
		id: string;
		title: string;
		due_date: string;
	};
	let upcomingEvents = $state<UpcomingEvent[]>([]);
	let upcomingEventsLoading = $state(false);

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

	type BlockCategory = 'body' | 'rest' | 'work' | 'admin' | 'bad' | null;
	type BlockValue = { title: string; status: boolean | null; category: BlockCategory };
	type BlockRow = { first: BlockValue; second: BlockValue };
	type HabitEntry = {
		id: string;
		name: string;
		repeatDays: number[];
		category: BlockCategory | null;
		createdAtMs: number;
	};
	type HabitSaveConfig = { id: string | null; repeatDays: number[] };
	type HabitBlockRow = { first: HabitEntry | null; second: HabitEntry | null };
	type SelectedBlock = { hourIndex: number; half: 0 | 1 };
	type DraggingBlock = { user_id: string; hour: number; half: 0 | 1 };

	type UndoEntry = {
		user_id: string;
		day_id: string;
		hour: number;
		half: 0 | 1;
		before: BlockValue | null;
		hadRow: boolean;
		habit: HabitEntry | null;
	};
	type UndoAction = { entries: UndoEntry[] };

	const normalizeBlockCategory = (value: unknown): BlockCategory | null => {
		if (value === 'social') return 'rest';
		if (value === 'body' || value === 'rest' || value === 'work' || value === 'admin') {
			return value;
		}
		if (value === 'bad') return 'bad';
		return null;
	};
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
		habit: HabitEntry | null;
	};
	type CopyBlock = {
		user_id: string;
		hour: number;
		half: 0 | 1;
		value: BlockValue;
	};
	type PendingCopy = {
		user_id: string;
		fromHour: number;
		fromHalf: 0 | 1;
		toHour: number;
		toHalf: 0 | 1;
		value: BlockValue;
	};
	type ShiftEntry = {
		index: number;
		hour: number;
		half: 0 | 1;
		title: string;
		status: boolean | null;
		category: BlockCategory | null;
		habit: HabitEntry | null;
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
	type HabitStatusRowPayload = {
		user_id: string;
		habit_id: string;
		day: string;
		completed: boolean;
	};
	type HabitRowPayload = {
		id: string;
		user_id: string;
		hour: number;
		half: boolean;
		name: string | null;
		repeat_days: number[] | null;
		category: string | null;
		created_at: string | null;
	};
	type HoursRealtimeState = {
		channel: RealtimeChannel;
		day_id: string;
	};
	type SelectedBlockRowPayload = {
		id: string;
		selected_block_hour: number | null;
		selected_block_half: boolean | number | null;
		current_streak?: number | null;
		best_streak?: number | null;
	};

	const createEmptyBlock = (): BlockValue => ({ title: '', status: null, category: null });

	function getDisplayTitle(user_id: string, h: number, half01: 0 | 1) {
		const title = getTitle(user_id, h, half01).trim();
		if (title.length > 0) return title;
		return (getHabitTitle(user_id, h, half01) ?? '').trim();
	}
	let blocksByUser = $state<Record<string, Record<number, BlockRow>>>({});
	let habitsByUser = $state<Record<string, Record<number, HabitBlockRow>>>({});
	let habitStatusByUser = $state<Record<string, Record<string, HabitDayStatus[]>>>({});
	let undoStacksByDate = $state<Record<string, UndoAction[]>>({});
	let lastUndoDate = $state<string | null>(null);

	let logOpen = $state(false);
	let logEventMode = $state(false);
	let logDueDate = $state('');
	let logEventId = $state<string | null>(null);
	let focusPane = $state<'grid' | 'upcoming'>('grid');
	let upcomingSelectionIndex = $state<number | null>(null);
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
	const hoursRealtimeByUser: Record<string, HoursRealtimeState | null> = {};
	const habitsRealtimeByUser: Record<string, RealtimeChannel | null> = {};
	const habitStatusRealtimeByUser: Record<string, RealtimeChannel | null> = {};
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
		habit: HabitEntry | null;
	}>({
		user_id: null,
		hour: null,
		half: null,
		title: '',
		status: null,
		category: null,
		habit: null
	});
	let selectedBlock = $state<SelectedBlock | null>(null);
	let hjklBlock = $state<SelectedBlock | null>(null);
	let badStatusShake = $state<{
		user_id: string;
		hour: number;
		half: 0 | 1;
		nonce: number;
	} | null>(null);
	let draggingBlock = $state<DraggingBlock | null>(null);
	let dragHoverBlock = $state<SelectedBlock | null>(null);
	let hoverBlock = $state<SelectedBlock | null>(null);
	let suppressHoverSelection = $state(false);
	let pendingMove = $state<PendingMove | null>(null);
	let pendingMoveSource = $state<'drag' | 'cut' | null>(null);
	let isMoveSubmitting = $state(false);
	let pendingCopy = $state<PendingCopy | null>(null);
	let isCopySubmitting = $state(false);
	let pendingDelete = $state<PendingDelete | null>(null);
	let isDeleteSubmitting = $state(false);
	let pendingEventDelete = $state<UpcomingEvent | null>(null);
	let isEventDeleteSubmitting = $state(false);
	let cutEvent = $state<UpcomingEvent | null>(null);
	let cutEventSourceDate = $state<string | null>(null);
	let isShiftSubmitting = $state(false);
	let commandCount = $state<number | null>(null);
	let pendingG = $state(false);
	let pendingCalendarG = $state(false);
	let pendingCalendarTimeout: number | null = null;
	let dragImageEl: HTMLElement | null = null;
	let cutBlock = $state<CutBlock | null>(null);
	let copyBlock = $state<CopyBlock | null>(null);
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
	const pendingCopySummary = $derived.by(() => {
		if (!pendingCopy) return null;
		const { user_id, fromHour, fromHalf, toHour, toHalf } = pendingCopy;
		const sourceTitle = getDisplayTitle(user_id, fromHour, fromHalf);
		const destinationTitle = getDisplayTitle(user_id, toHour, toHalf);
		const destinationHabit = (getHabitTitle(user_id, toHour, toHalf) ?? '').trim();
		const destinationHasContent = destinationTitle.length > 0 || destinationHabit.length > 0;
		return {
			blockLabel: sourceTitle || 'this block',
			fromLabel: formatBlockLabel(fromHour, fromHalf),
			toLabel: formatBlockLabel(toHour, toHalf),
			destinationLabel: destinationTitle || destinationHabit || null,
			hasDestinationContent: destinationHasContent,
			isHabit: false,
			mode: 'copy' as const
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

	const modalOverlayActive = $derived.by(() =>
		Boolean(
			logOpen ||
				carryoverPrompt ||
				plannedPrompt ||
				pendingMove ||
				pendingCopy ||
				pendingDelete ||
				pendingEventDelete
		)
	);

	// prevent re-prompting within same block
	let lastPromptKey = $state<string | null>(null);

	const formatDateString = (date: Date) =>
		`${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
	const formatDisplayDate = (
		dateStr: string,
		options: Intl.DateTimeFormatOptions = { month: 'short', day: 'numeric' }
	) => {
		const parsed = parseHabitDate(dateStr);
		if (parsed === null) return dateStr;
		return new Date(parsed).toLocaleDateString(undefined, options);
	};
	const daysUntilLabel = (dateStr: string) => {
		const parsed = parseHabitDate(dateStr);
		const todayMs = parseHabitDate(localToday());
		if (parsed === null || todayMs === null) return '';
		const diffDays = Math.round((parsed - todayMs) / DAY_MS);
		const safeDays = Math.max(0, diffDays);
		if (safeDays > 7) {
			const weeks = Math.floor(safeDays / 7);
			const days = safeDays % 7;
			const weekLabel = `${weeks} week${weeks === 1 ? '' : 's'}`;
			if (days === 0) return weekLabel;
			const dayLabel = `${days} day${days === 1 ? '' : 's'}`;
			return `${weekLabel} ${dayLabel}`;
		}
		return `${safeDays} day${safeDays === 1 ? '' : 's'}`;
	};

	const isMilestoneEvent = (event: UpcomingEvent) => event.id.startsWith('milestone-');
	const clampUpcomingIndex = (index: number) =>
		Math.max(0, Math.min(upcomingEvents.length - 1, index));
	const focusUpcoming = (index?: number) => {
		if (!isSinglePlayerView) return;
		focusPane = 'upcoming';
		hoverBlock = null;
		if (upcomingEvents.length === 0) {
			upcomingSelectionIndex = null;
			return;
		}
		if (typeof index === 'number') {
			upcomingSelectionIndex = clampUpcomingIndex(index);
			return;
		}
		if (upcomingSelectionIndex === null) {
			upcomingSelectionIndex = 0;
		}
	};
	const focusGrid = () => {
		focusPane = 'grid';
	};
	const moveUpcomingSelection = (delta: 1 | -1) => {
		if (upcomingEvents.length === 0) return false;
		const current = upcomingSelectionIndex ?? 0;
		upcomingSelectionIndex = clampUpcomingIndex(current + delta);
		return true;
	};
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

	const HEATMAP_LOOKBACK_DAYS = 365;
	const HEATMAP_HOURS_BATCH_SIZE = 25;
	const CALENDAR_WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
	const SUMMARY_CATEGORY_COLORS: Record<SummaryCategoryKey, string> = {
		admin: 'var(--summary-admin)',
		body: 'var(--summary-body)',
		rest: 'var(--summary-rest)',
		work: 'var(--summary-work)',
		bad: 'var(--summary-bad)'
	};
	const SUMMARY_CATEGORY_CLASSES: Record<SummaryCategoryKey, string> = {
		admin: 'text-amber-900/30',
		body: 'text-rose-300',
		rest: 'text-violet-300',
		work: 'text-slate-300',
		bad: 'text-rose-500'
	};
	const initialHeatmap = ($page.data?.heatmapByDate as Record<string, number> | null) ?? {};

	let heatmapOpen = $state(false);
	let heatmapLoading = $state(Object.keys(initialHeatmap).length === 0);
	let heatmapAnimated = $state(false);
	let heatmapByDate = $state<Record<string, number>>(initialHeatmap);
	let calendarLockedDate = $state<string | null>(null);
	let calendarHoverDate = $state<string | null>(null);
	let calendarMonthIndex = $state<number>(new Date().getMonth());
	let calendarYear = $state<number>(new Date().getFullYear());
	let calendarSummary = $state<SummaryStats | null>(null);
	let calendarSummaryDate = $state<string | null>(null);
	let calendarSummaryLabel = $state<string | null>(null);
	let calendarSummaryLoading = $state(false);
	let calendarSummaryRequestId = 0;
	let calendarHoverPosition = $state<{ x: number; y: number } | null>(null);
	let calendarActiveGroupIndex = $state(0);
	let calendarScrollEl = $state<HTMLDivElement | null>(null);
	let calendarGroupEls = $state<(HTMLDivElement | null)[]>([]);
	let calendarWeekEls = $state<(HTMLDivElement | null)[]>([]);
	let calendarScrollDirection = $state<1 | -1 | 0>(0);
	let calendarSnapDisabled = $state(false);
	let calendarDidInitialScroll = $state(false);
	let calendarAutoScroll = $state(false);
	let calendarGroupObserver: IntersectionObserver | null = null;
	let calendarVisibleMonth = $state<{ monthIndex: number; year: number } | null>(null);
	let calendarScrollSnapTimer: number | null = null;
	let calendarEventIndex = $state<number | null>(null);

	function parseLocalDate(dateStr: string): Date | null {
		const [yearStr, monthStr, dayStr] = dateStr.split('-');
		const year = Number(yearStr);
		const month = Number(monthStr);
		const day = Number(dayStr);
		if (
			Number.isNaN(year) ||
			Number.isNaN(month) ||
			Number.isNaN(day) ||
			month < 1 ||
			month > 12 ||
			day < 1 ||
			day > 31
		) {
			return null;
		}
		return new Date(year, month - 1, day);
	}

	function addMonthsToDateString(dateStr: string, months: number) {
		const parsed = parseLocalDate(dateStr);
		if (!parsed) return localToday();
		const day = parsed.getDate();
		parsed.setMonth(parsed.getMonth() + months);
		if (parsed.getDate() !== day) {
			parsed.setDate(0);
		}
		return formatDateString(parsed);
	}

	function heatmapColorClass(pct: number | null) {
		if (pct === null || Number.isNaN(pct)) return 'bg-white';
		if (pct >= 75) return 'bg-green-800';
		if (pct >= 50) return 'bg-green-500';
		if (pct >= 25) return 'bg-green-200';
		return 'bg-white';
	}

	function formatProductiveHours(value: number) {
		const rounded = Math.round(value * 10) / 10;
		return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
	}

	function summaryPieStyle(summary: SummaryStats | null) {
		if (!summary) return 'background: conic-gradient(var(--summary-empty) 0% 100%);';
		let offset = 0;
		const segments = summary.categoryBreakdown
			.filter((entry) => entry.percent > 0)
			.map((entry) => {
				const start = offset;
				offset += entry.percent;
				const color = SUMMARY_CATEGORY_COLORS[entry.key] ?? 'var(--summary-empty)';
				return `${color} ${start}% ${offset}%`;
			});
		if (segments.length === 0) {
			return 'background: conic-gradient(var(--summary-empty) 0% 100%);';
		}
		return `background: conic-gradient(${segments.join(', ')});`;
	}

	function computeSummaryStats(
		hours: { title: string | null; status: boolean | null; category: string | null }[],
		habitCompleted = 0
	): SummaryStats {
		let planned = 0;
		let completed = 0;
		const categoryCounts: Record<SummaryCategoryKey, number> = {
			body: 0,
			rest: 0,
			work: 0,
			admin: 0,
			bad: 0
		};
		for (const row of hours) {
			const title = (row.title ?? '').trim();
			const category = row.category as SummaryCategoryKey | null;
			if (title.length > 0) planned += 1;
			if (title.length > 0 && row.status !== false) completed += 1;
			if (title.length > 0 && category) {
				categoryCounts[category] += 1;
			}
		}
		const totalCategories = Object.values(categoryCounts).reduce((sum, value) => sum + value, 0);
		const totalCompleted = completed + habitCompleted;
		const categoryBreakdown: SummaryCategory[] = (
			[
				{ key: 'body', label: 'Body' },
				{ key: 'rest', label: 'Rest' },
				{ key: 'work', label: 'Work' },
				{ key: 'admin', label: 'Admin' },
				{ key: 'bad', label: 'Bad' }
			] as const
		).map((entry) => ({
			...entry,
			percent:
				totalCategories === 0 ? 0 : Math.round((categoryCounts[entry.key] / totalCategories) * 100),
			hours: Math.round((categoryCounts[entry.key] / 2) * 10) / 10
		}));
		const score = Math.max(
			0,
			Math.min(100, Math.round((totalCompleted / TOTAL_BLOCKS_PER_DAY) * 100))
		);
		return {
			planned,
			completed: totalCompleted,
			productiveHours: totalCompleted / 2,
			score,
			categoryBreakdown
		};
	}

	function buildCalendarWeekRange(baseDateStr: string, monthsCount: number) {
		const parsed = parseLocalDate(baseDateStr) ?? new Date();
		const startMonth = new Date(parsed.getFullYear(), parsed.getMonth(), 1);
		const startWeekday = (startMonth.getDay() + 6) % 7;
		const start = new Date(startMonth);
		start.setDate(startMonth.getDate() - startWeekday);
		const lastMonth = new Date(startMonth);
		lastMonth.setMonth(startMonth.getMonth() + monthsCount - 1);
		const lastDay = new Date(lastMonth.getFullYear(), lastMonth.getMonth() + 1, 0);
		const lastWeekday = (lastDay.getDay() + 6) % 7;
		const end = new Date(lastDay);
		end.setDate(lastDay.getDate() + (6 - lastWeekday));
		const weeks: Date[][] = [];
		let cursor = new Date(start);
		while (cursor <= end) {
			const days: Date[] = [];
			for (let i = 0; i < 7; i += 1) {
				days.push(new Date(cursor));
				cursor.setDate(cursor.getDate() + 1);
			}
			weeks.push(days);
		}
		return weeks;
	}

	function chunkWeeks(weeks: Date[][], chunkSize: number) {
		const groups: Date[][][] = [];
		for (let i = 0; i < weeks.length; i += chunkSize) {
			groups.push(weeks.slice(i, i + chunkSize));
		}
		return groups;
	}

	function calendarGroupMonthInfo(group: Date[][]) {
		type MonthTally = { monthIndex: number; year: number; dayCount: number };
		const totals = new Map<string, MonthTally>();

		for (const week of group) {
			for (const day of week) {
				const key = `${day.getFullYear()}-${day.getMonth()}`;
				const entry = totals.get(key) ?? {
					monthIndex: day.getMonth(),
					year: day.getFullYear(),
					dayCount: 0
				};
				entry.dayCount += 1;
				totals.set(key, entry);
			}
		}

		let best: MonthTally | null = null;
		for (const entry of totals.values()) {
			if (!best || entry.dayCount > best.dayCount) {
				best = entry;
			}
		}

		if (best) {
			return { monthIndex: best.monthIndex, year: best.year };
		}

		const fallbackDay = group[Math.floor(group.length / 2)]?.[3] ?? group[0]?.[0];
		if (!fallbackDay) {
			return { monthIndex: calendarMonthIndex, year: calendarYear };
		}
		return { monthIndex: fallbackDay.getMonth(), year: fallbackDay.getFullYear() };
	}

	function calendarGroupMonthTotals(group: Date[][]) {
		type MonthTally = { monthIndex: number; year: number; dayCount: number; rowCount: number };
		const totals = new Map<string, MonthTally>();
		for (const week of group) {
			const weekMonths = new Set<string>();
			for (const day of week) {
				const key = `${day.getFullYear()}-${day.getMonth()}`;
				const entry = totals.get(key) ?? {
					monthIndex: day.getMonth(),
					year: day.getFullYear(),
					dayCount: 0,
					rowCount: 0
				};
				entry.dayCount += 1;
				totals.set(key, entry);
				weekMonths.add(key);
			}
			for (const key of weekMonths) {
				const entry = totals.get(key);
				if (entry) entry.rowCount += 1;
			}
		}
		return Array.from(totals.values()).sort((a, b) => {
			if (a.year !== b.year) return a.year - b.year;
			return a.monthIndex - b.monthIndex;
		});
	}

	function calendarGroupLabel(group: Date[][]) {
		const info = calendarGroupMonthInfo(group);
		return `${MONTHS[info.monthIndex] ?? MONTHS[0]} ${info.year}`;
	}

	function setCalendarMonthFromDate(dateStr: string) {
		const parsed = parseLocalDate(dateStr);
		if (!parsed) return;
		calendarMonthIndex = parsed.getMonth();
		calendarYear = parsed.getFullYear();
	}

	async function loadCalendarSummary(dateStr: string) {
		if (!viewerUserId) return;
		const requestId = (calendarSummaryRequestId += 1);
		calendarSummaryLoading = true;
		calendarSummaryDate = dateStr;
		calendarSummaryLabel = heatmapDateLabel(dateStr);
		try {
			let habitCompleted = 0;
			const { data: habitRows, error: habitError } = await supabase
				.from('habit_day_status')
				.select('completed')
				.eq('user_id', viewerUserId)
				.eq('day', dateStr)
				.eq('completed', true);
			if (habitError) throw habitError;
			habitCompleted = (habitRows ?? []).length;

			const { data: dayRow, error: dayError } = await supabase
				.from('days')
				.select('id')
				.eq('user_id', viewerUserId)
				.eq('date', dateStr)
				.maybeSingle();
			if (dayError) throw dayError;
			let rows: { title: string | null; status: boolean | null; category: string | null }[] = [];
			if (dayRow?.id) {
				const { data: hoursRows, error: hoursError } = await supabase
					.from('hours')
					.select('title, status, category')
					.eq('day_id', dayRow.id as string);
				if (hoursError) throw hoursError;
				rows = (hoursRows ?? []) as typeof rows;
			}
			if (requestId !== calendarSummaryRequestId) return;
			calendarSummary = computeSummaryStats(rows, habitCompleted);
		} catch (error) {
			console.error('calendar summary load error', error);
			if (requestId !== calendarSummaryRequestId) return;
			calendarSummary = computeSummaryStats([], 0);
		} finally {
			if (requestId === calendarSummaryRequestId) {
				calendarSummaryLoading = false;
			}
		}
	}

	function handleCalendarHover(dateStr: string, event?: MouseEvent) {
		calendarHoverDate = dateStr;
		if (event) {
			calendarHoverPosition = { x: event.clientX + 16, y: event.clientY + 16 };
		}
	}

	function updateCalendarHoverPosition(event: MouseEvent) {
		if (!calendarHoverDate) return;
		calendarHoverPosition = { x: event.clientX + 16, y: event.clientY + 16 };
	}

	function clearCalendarHover() {
		calendarHoverDate = null;
		calendarHoverPosition = null;
	}

	function handleCalendarSelect(dateStr: string, options?: { syncMonth?: boolean }) {
		const syncMonth = options?.syncMonth ?? true;
		calendarLockedDate = dateStr;
		calendarHoverDate = null;
		calendarHoverPosition = null;
		if (syncMonth) {
			setCalendarMonthFromDate(dateStr);
		}
		activeDayDateStore?.set(dateStr);
		calendarEventIndex = null;
	}

	function calendarRowStep() {
		const weekEls = calendarWeekEls.filter(Boolean) as HTMLDivElement[];
		if (!weekEls.length) return null;
		const weekEl = weekEls[0];
		const gapValue = Number.parseFloat(getComputedStyle(weekEl.parentElement ?? weekEl).gap || '0');
		const step = weekEl.offsetHeight + (Number.isFinite(gapValue) ? gapValue : 0);
		return step > 0 ? step : null;
	}

	function calendarBaseOffset() {
		const weekEls = calendarWeekEls.filter(Boolean) as HTMLDivElement[];
		if (!weekEls.length) return null;
		return weekEls[0].offsetTop;
	}

	function updateCalendarVisibleMonthFromScroll(
		scrollTop: number,
		logLabel?: string,
		meta?: Record<string, number | string>
	) {
		const step = calendarRowStep();
		const baseOffset = calendarBaseOffset();
		if (!step || baseOffset === null) return;
		const maxStart = Math.max(0, calendarWeekRange.length - 1);
		const startIndex = Math.max(0, Math.min(maxStart, Math.round((scrollTop - baseOffset) / step)));
		const countStartIndex = Math.min(maxStart, startIndex + 1);
		const groupWeeks = calendarWeekRange.slice(countStartIndex, countStartIndex + 6);
		if (!groupWeeks.length) return;
		const totals = calendarGroupMonthTotals(groupWeeks);
		let best: { monthIndex: number; year: number; dayCount: number } | null = null;
		for (const entry of totals) {
			if (!best || entry.dayCount > best.dayCount) {
				best = entry;
			}
		}
		calendarVisibleMonth = best ? { monthIndex: best.monthIndex, year: best.year } : null;
		if (logLabel) {
			console.log(
				logLabel,
				{ ...meta, startIndex, scrollTop, step },
				totals.map(
					(entry) =>
						`${MONTHS[entry.monthIndex] ?? entry.monthIndex} ${entry.year}: rows ${entry.rowCount}, days ${entry.dayCount}`
				)
			);
		}
	}

	function moveSelectedByDays(days: number) {
		const baseDate = calendarPreviewDate ?? activeDayDate;
		calendarScrollDirection = days > 0 ? 1 : -1;
		handleCalendarSelect(addDaysToDateString(baseDate, days), { syncMonth: false });
	}

	function moveSelectedByWeeks(weeks: number) {
		moveSelectedByDays(weeks * 7);
	}

	function moveSelectedByMonths(months: number) {
		const baseDate = calendarPreviewDate ?? activeDayDate;
		handleCalendarSelect(addMonthsToDateString(baseDate, months));
	}

	function disableCalendarSnap() {
		if (!calendarScrollEl) return;
		const previous = calendarScrollEl.style.scrollSnapType;
		calendarScrollEl.style.scrollSnapType = 'none';
		requestAnimationFrame(() => {
			if (!calendarScrollEl) return;
			calendarScrollEl.style.scrollSnapType = previous;
		});
	}

	function scrollCalendarToDate(dateStr: string, options?: { align?: 'top' | 'nearby' }) {
		if (!calendarScrollEl) return;
		const step = calendarRowStep();
		const baseOffset = calendarBaseOffset();
		if (!step || baseOffset === null) return;
		const weekIndex = calendarWeekRange.findIndex((week) =>
			week.some((day) => formatDateString(day) === dateStr)
		);
		if (weekIndex === -1) return;
		const maxTop = calendarScrollEl.scrollHeight - calendarScrollEl.clientHeight;
		const alignedIndex =
			options?.align === 'top' ? Math.max(0, weekIndex - 1) : Math.max(0, weekIndex - 1);
		const nextTop = Math.min(Math.max(baseOffset + alignedIndex * step, 0), maxTop);
		disableCalendarSnap();
		calendarAutoScroll = true;
		calendarScrollEl.scrollTop = nextTop;
		requestAnimationFrame(() => {
			if (!calendarScrollEl) return;
			calendarScrollEl.scrollTop = nextTop;
			updateCalendarVisibleMonthFromScroll(nextTop, 'Calendar jump', {
				source: 'today-key'
			});
			window.setTimeout(() => {
				calendarAutoScroll = false;
			}, 120);
		});
	}

	function scrollCalendarRowIfNeeded(dateStr: string, direction: 1 | -1) {
		if (!calendarScrollEl) return;
		const weekIndex = calendarWeekRange.findIndex((week) =>
			week.some((day) => formatDateString(day) === dateStr)
		);
		if (weekIndex === -1) return;
		const weekEl = calendarWeekEls[weekIndex];
		if (!weekEl) return;
		if (calendarAutoScroll) return;
		const currentTop = calendarScrollEl.scrollTop;
		const maxTop = calendarScrollEl.scrollHeight - calendarScrollEl.clientHeight;
		const gapValue = Number.parseFloat(getComputedStyle(weekEl.parentElement ?? weekEl).gap || '0');
		const rowStep = weekEl.offsetHeight + (Number.isFinite(gapValue) ? gapValue : 0);
		const baseOffset = calendarBaseOffset();
		if (baseOffset === null) return;
		const firstVisibleIndex = Math.round((currentTop - baseOffset) / rowStep) + 1;
		if (!Number.isFinite(firstVisibleIndex)) return;
		const lastVisibleIndex = Math.min(calendarWeekEls.length - 1, firstVisibleIndex + 5);
		if (direction > 0 && weekIndex > lastVisibleIndex) {
			const nextTop = Math.min(currentTop + rowStep, maxTop);
			if (nextTop - currentTop > 0.5) {
				disableCalendarSnap();
				calendarAutoScroll = true;
				calendarScrollEl.scrollTop = nextTop;
				updateCalendarVisibleMonthFromScroll(nextTop, 'Calendar snap', {
					direction: 'down',
					weekIndex
				});
				window.setTimeout(() => {
					calendarAutoScroll = false;
				}, 120);
			}
			return;
		}
		if (direction < 0 && weekIndex < firstVisibleIndex) {
			const nextTop = Math.max(currentTop - rowStep, 0);
			if (currentTop - nextTop > 0.5) {
				disableCalendarSnap();
				calendarAutoScroll = true;
				calendarScrollEl.scrollTop = nextTop;
				updateCalendarVisibleMonthFromScroll(nextTop, 'Calendar snap', {
					direction: 'up',
					weekIndex
				});
				window.setTimeout(() => {
					calendarAutoScroll = false;
				}, 120);
			}
		}
	}

	async function loadHeatmap(userId: string | null) {
		if (!userId) {
			heatmapByDate = {};
			heatmapStore.set({ userId: null, byDate: {}, loading: false });
			return;
		}
		heatmapLoading = true;
		heatmapStore.set({ userId, byDate: heatmapByDate, loading: true });
		const lookbackStart = dateStringNDaysAgo(HEATMAP_LOOKBACK_DAYS);
		try {
			const next = await fetchCompletionByDate(
				supabase,
				userId,
				lookbackStart,
				TOTAL_BLOCKS_PER_DAY,
				HEATMAP_HOURS_BATCH_SIZE
			);

			heatmapByDate = next;
			heatmapStore.set({ userId, byDate: next, loading: false });
		} catch (error) {
			console.error('heatmap load error', error);
			heatmapByDate = {};
			heatmapStore.set({ userId, byDate: {}, loading: false });
		} finally {
			heatmapLoading = false;
		}
	}

	const activeDayDate = $derived($activeDayDateStore ?? localToday());
	const heatmapDateLabel = (dateStr: string) =>
		formatDisplayDate(dateStr, { weekday: 'short', month: 'short', day: 'numeric' });
	const calendarSelectedDate = $derived(calendarLockedDate ?? activeDayDate);
	const calendarPreviewDate = $derived(calendarLockedDate ?? activeDayDate);
	const calendarSummaryTarget = $derived(calendarHoverDate ?? calendarLockedDate ?? activeDayDate);
	const calendarRangeAnchorDate = $derived(formatDateString(new Date(calendarYear, 0, 1)));
	const calendarMonthLabel = $derived(`${MONTHS[calendarMonthIndex] ?? MONTHS[0]} ${calendarYear}`);
	const calendarWeekRange = $derived(buildCalendarWeekRange(calendarRangeAnchorDate, 12));
	const calendarWeekGroups = $derived(chunkWeeks(calendarWeekRange, 6));
	const calendarEventsByDate = $derived.by(() => {
		const map = new Map<string, UpcomingEvent[]>();
		for (const event of upcomingEvents) {
			if (!event.due_date) continue;
			const list = map.get(event.due_date) ?? [];
			list.push(event);
			map.set(event.due_date, list);
		}
		return map;
	});
	const calendarSelectedEvents = $derived.by(
		() => calendarEventsByDate.get(calendarSelectedDate) ?? []
	);
	$effect(() => {
		calendarWeekEls = Array.from({ length: calendarWeekRange.length }, () => null);
	});
	const calendarHeaderLabel = $derived.by(() => {
		if (calendarVisibleMonth) {
			return `${MONTHS[calendarVisibleMonth.monthIndex] ?? MONTHS[0]} ${calendarVisibleMonth.year}`;
		}
		const group = calendarWeekGroups[calendarActiveGroupIndex];
		return group ? calendarGroupLabel(group) : calendarMonthLabel;
	});

	$effect(() => {
		if (!heatmapOpen) return;
		if (heatmapLoading) {
			heatmapAnimated = false;
			return;
		}
		heatmapAnimated = false;
		requestAnimationFrame(() => {
			heatmapAnimated = true;
		});
	});

	$effect(() => {
		if (!heatmapOpen) {
			calendarHoverDate = null;
			calendarLockedDate = null;
			return;
		}
		calendarHoverDate = null;
		if (!calendarLockedDate) {
			const today = localToday();
			calendarLockedDate = today;
			setCalendarMonthFromDate(today);
		}
	});

	$effect(() => {
		if (!heatmapOpen) {
			calendarDidInitialScroll = false;
			return;
		}
		if (calendarDidInitialScroll) return;
		if (!calendarScrollEl) return;
		const step = calendarRowStep();
		const baseOffset = calendarBaseOffset();
		if (!step || baseOffset === null) return;
		const targetDate = localToday();
		const weekIndex = calendarWeekRange.findIndex((week) =>
			week.some((day) => formatDateString(day) === targetDate)
		);
		if (weekIndex === -1) return;
		const weekEl = calendarWeekEls[weekIndex];
		if (!weekEl) return;
		const maxTop = calendarScrollEl.scrollHeight - calendarScrollEl.clientHeight;
		const alignedIndex = Math.max(0, weekIndex - 1);
		const nextTop = Math.min(Math.max(baseOffset + alignedIndex * step, 0), maxTop);
		disableCalendarSnap();
		calendarScrollEl.scrollTop = nextTop;
		requestAnimationFrame(() => {
			if (!calendarScrollEl) return;
			calendarScrollEl.scrollTop = nextTop;
			updateCalendarVisibleMonthFromScroll(nextTop);
			calendarDidInitialScroll = true;
		});
	});

	$effect(() => {
		if (!heatmapOpen) return;
		if (!viewerUserId) return;
		if (!calendarSummaryTarget) return;
		if (calendarSummaryTarget === calendarSummaryDate && calendarSummary) return;
		void loadCalendarSummary(calendarSummaryTarget);
	});

	$effect(() => {
		if (!heatmapOpen) return;
		if (!calendarScrollEl) return;
		if (!calendarPreviewDate) return;
		if (calendarScrollDirection === 0) return;
		const direction = calendarScrollDirection;
		calendarScrollDirection = 0;
		requestAnimationFrame(() => {
			scrollCalendarRowIfNeeded(calendarPreviewDate, direction);
		});
	});

	$effect(() => {
		if (!heatmapOpen) return;
		if (!calendarScrollEl) return;
		calendarGroupObserver?.disconnect();
		const groups = calendarGroupEls.filter(Boolean) as HTMLDivElement[];
		if (!groups.length) return;
		calendarGroupObserver = new IntersectionObserver(
			(entries) => {
				let best: IntersectionObserverEntry | null = null;
				for (const entry of entries) {
					if (!best || entry.intersectionRatio > best.intersectionRatio) {
						best = entry;
					}
				}
				if (!best) return;
				const indexAttr = best.target.getAttribute('data-group');
				if (indexAttr === null) return;
				const index = Number(indexAttr);
				if (Number.isNaN(index)) return;
				calendarActiveGroupIndex = index;
			},
			{
				root: calendarScrollEl,
				threshold: [0.3, 0.6, 0.9]
			}
		);
		for (const group of groups) {
			calendarGroupObserver.observe(group);
		}
		return () => {
			calendarGroupObserver?.disconnect();
		};
	});

	$effect(() => {
		if (!heatmapOpen) return;
		if (!calendarScrollEl) return;
		const readyWeeks = calendarWeekEls.filter(Boolean).length;
		if (!readyWeeks) return;
		updateCalendarVisibleMonthFromScroll(calendarScrollEl.scrollTop);
		const handleScroll = () => {
			if (calendarScrollSnapTimer !== null) {
				window.clearTimeout(calendarScrollSnapTimer);
			}
			calendarScrollSnapTimer = window.setTimeout(() => {
				calendarScrollSnapTimer = null;
				if (!calendarScrollEl) return;
				updateCalendarVisibleMonthFromScroll(calendarScrollEl.scrollTop, 'Calendar snap', {
					source: 'scroll-end'
				});
			}, 120);
		};
		calendarScrollEl.addEventListener('scroll', handleScroll, { passive: true });
		return () => {
			calendarScrollEl?.removeEventListener('scroll', handleScroll);
			if (calendarScrollSnapTimer !== null) {
				window.clearTimeout(calendarScrollSnapTimer);
				calendarScrollSnapTimer = null;
			}
		};
	});

	$effect(() => {
		if (!heatmapOpen) {
			calendarEventIndex = null;
			return;
		}
		const events = calendarSelectedEvents;
		if (events.length === 0) {
			calendarEventIndex = null;
			return;
		}
		if (calendarEventIndex !== null && calendarEventIndex >= events.length) {
			calendarEventIndex = events.length - 1;
		}
	});
	const displayDateForUser = (user_id: string) => {
		if (!viewerUserId) return localToday();
		return activeDayDateByUser[user_id] ?? localToday();
	};
	const dayLabelForUser = (user_id: string) => {
		const dateStr = displayDateForUser(user_id);
		const todayStr = localToday();
		const dateMs = parseHabitDate(dateStr);
		const todayMs = parseHabitDate(todayStr);
		if (dateMs === null || todayMs === null) return dateStr;
		const diffDays = Math.round((dateMs - todayMs) / DAY_MS);
		if (diffDays === 0) return 'Today';
		const absDays = Math.abs(diffDays);
		return diffDays > 0 ? `Today + ${absDays}` : `Today - ${absDays}`;
	};
	const canEditDayForUser = (user_id: string) => {
		if (!viewerUserId || viewerUserId !== user_id) return false;
		return displayDateForUser(user_id) >= localToday();
	};

	const undoDateForUser = (user_id: string) => displayDateForUser(user_id);

	const buildUndoEntry = (
		user_id: string,
		day_id: string,
		hour: number,
		half: 0 | 1
	): UndoEntry => {
		const block = getBlock(user_id, hour, half);
		const title = (block.title ?? '').trim();
		const status = block.status ?? null;
		const category = block.category ?? null;
		const habit = getHabitEntry(user_id, hour, half);
		const hadRow = Boolean(title) || status !== null || category !== null;
		return {
			user_id,
			day_id,
			hour,
			half,
			before: hadRow ? { title: block.title ?? '', status, category } : null,
			hadRow,
			habit
		};
	};

	const pushUndoAction = (
		user_id: string,
		day_id: string,
		blocks: { hour: number; half: 0 | 1 }[]
	) => {
		if (!canEditDayForUser(user_id)) return;
		const dateKey = undoDateForUser(user_id);
		if (!dateKey) return;
		const seen = new Set<string>();
		const entries: UndoEntry[] = [];
		for (const block of blocks) {
			const key = `${block.hour}-${block.half}`;
			if (seen.has(key)) continue;
			seen.add(key);
			entries.push(buildUndoEntry(user_id, day_id, block.hour, block.half));
		}
		if (entries.length === 0) return;
		const existing = undoStacksByDate[dateKey] ?? [];
		const next = [...existing, { entries }];
		const trimmed = next.length > 10 ? next.slice(next.length - 10) : next;
		undoStacksByDate = { ...undoStacksByDate, [dateKey]: trimmed };
	};

	const clearUndoStacks = () => {
		undoStacksByDate = {};
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
		dayIdByUser = { ...dayIdByUser, [viewerUserId]: null };
		blocksByUser = { ...blocksByUser, [viewerUserId]: {} };

		void supabase
			.from('users')
			.update({ active_day_date: dateStr })
			.eq('id', viewerUserId)
			.then(({ error }) => {
				if (error) {
					console.error('active day update error', error);
				}
			});

		const dayId = await getDayIdForUser(viewerUserId, dateStr, true);
		dayIdByUser = { ...dayIdByUser, [viewerUserId]: dayId };
		if (dayId) {
			await loadHoursForDay(viewerUserId, dayId);
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

	$effect(() => {
		if (!viewerUserId) return;
		const currentDate = displayDateForUser(viewerUserId);
		if (currentDate === lastUndoDate) return;
		clearUndoStacks();
		lastUndoDate = currentDate;
	});
	$effect(() => {
		if (!isSinglePlayerView || focusPane !== 'upcoming') return;
		if (upcomingEvents.length === 0) {
			upcomingSelectionIndex = null;
			return;
		}
		if (upcomingSelectionIndex === null || upcomingSelectionIndex >= upcomingEvents.length) {
			upcomingSelectionIndex = 0;
		}
	});

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
	function blockIsCopied(user_id: string, h: number, half01: 0 | 1) {
		return Boolean(
			copyBlock &&
				copyBlock.user_id === user_id &&
				copyBlock.hour === h &&
				copyBlock.half === half01
		);
	}

	function getTitle(user_id: string, h: number, half01: 0 | 1) {
		return getBlock(user_id, h, half01).title ?? '';
	}

	function getStatus(user_id: string, h: number, half01: 0 | 1) {
		return getBlock(user_id, h, half01).status ?? null;
	}
	function getDisplayStatus(user_id: string, h: number, half01: 0 | 1) {
		const habit = getHabitEntry(user_id, h, half01);
		if (habit) return habitCompletionStatusForBlock(user_id, h, half01);
		return getStatus(user_id, h, half01);
	}

	function setCategory(user_id: string, h: number, half01: 0 | 1, value: BlockCategory | null) {
		const row = ensureBlockRow(user_id, h);
		if (half01 === 0) row.first.category = value;
		else row.second.category = value;
	}

	function getCategory(user_id: string, h: number, half01: 0 | 1) {
		return getBlock(user_id, h, half01).category ?? null;
	}
	function getDisplayCategory(user_id: string, h: number, half01: 0 | 1) {
		const habit = getHabitEntry(user_id, h, half01);
		return habit?.category ?? getCategory(user_id, h, half01);
	}

	function ensureHabitRow(user_id: string, h: number): HabitBlockRow {
		habitsByUser[user_id] ??= {};
		habitsByUser[user_id][h] ??= { first: null, second: null };
		return habitsByUser[user_id][h];
	}
	function setHabitEntry(user_id: string, h: number, half01: 0 | 1, entry: HabitEntry | null) {
		const row = ensureHabitRow(user_id, h);
		if (half01 === 0) row.first = entry;
		else row.second = entry;
	}
	function clearHabitEntryById(user_id: string, habitId: string) {
		const userHabits = habitsByUser[user_id];
		if (!userHabits) return;
		const next: Record<number, HabitBlockRow> = { ...userHabits };
		for (const [hourStr, row] of Object.entries(next)) {
			const hour = Number(hourStr);
			const first = row.first?.id === habitId ? null : row.first;
			const second = row.second?.id === habitId ? null : row.second;
			next[hour] = { first, second };
		}
		habitsByUser[user_id] = next;
	}
	function clearHabitStatusById(user_id: string, habitId: string) {
		const userRecords = habitStatusByUser[user_id];
		if (!userRecords) return;
		const { [habitId]: _removed, ...rest } = userRecords;
		habitStatusByUser = { ...habitStatusByUser, [user_id]: rest };
	}
	function getHabitEntry(user_id: string, h: number, half01: 0 | 1) {
		const row = habitsByUser[user_id]?.[h];
		if (!row) return null;
		const entry = half01 === 0 ? row.first : row.second;
		if (!entry) return null;
		const dateStr = displayDateForUser(user_id);
		return habitScheduledOn(entry, dateStr) ? entry : null;
	}
	function getHabitTitle(user_id: string, h: number, half01: 0 | 1) {
		return getHabitEntry(user_id, h, half01)?.name ?? null;
	}
	type HabitDayStatus = { date: string; completed: boolean };
	function weekdayIndexFromDate(dateStr: string): number | null {
		const ms = parseHabitDate(dateStr);
		if (ms === null) return null;
		const day = new Date(ms).getUTCDay();
		return (day + 6) % 7;
	}
	function habitScheduledOn(habit: HabitEntry, dateStr: string): boolean {
		const idx = weekdayIndexFromDate(dateStr);
		if (idx === null) return false;
		return habit.repeatDays.includes(idx);
	}
	function latestScheduledDate(habit: HabitEntry, startDateStr: string): string | null {
		let cursor = startDateStr;
		for (let offset = 0; offset < STREAK_LOOKBACK_DAYS; offset += 1) {
			if (habitScheduledOn(habit, cursor)) return cursor;
			cursor = addDaysToDateString(cursor, -1);
		}
		return null;
	}
	function habitCompletionMap(records: HabitDayStatus[]): Map<string, boolean> {
		const map = new Map<string, boolean>();
		for (const record of records) {
			map.set(record.date, record.completed);
		}
		return map;
	}
	function calculateHabitStreak(
		habit: HabitEntry,
		records: HabitDayStatus[],
		hour: number,
		half: 0 | 1
	): PlayerStreak | null {
		if (!habit.repeatDays.length) return null;
		const completionByDate = habitCompletionMap(records);
		const today = localToday();
		const scheduledToday = habitScheduledOn(habit, today);
		const blockElapsed = blockHasElapsed(hour, half);
		const createdDate = formatDateString(new Date(habit.createdAtMs));
		const createdBoundaryMs = parseHabitDate(createdDate);
		let anchorDate: string | null = null;
		const completedToday = completionByDate.get(today) === true;
		if (scheduledToday && completedToday) {
			anchorDate = today;
		} else if (scheduledToday && blockElapsed) {
			anchorDate = today;
		} else {
			anchorDate = latestScheduledDate(habit, addDaysToDateString(today, -1));
		}
		if (!anchorDate) return null;
		const anchorMs = parseHabitDate(anchorDate);
		if (createdBoundaryMs !== null && anchorMs !== null && anchorMs < createdBoundaryMs) {
			return null;
		}
		const anchorCompleted = completionByDate.get(anchorDate) === true;
		let streakLength = 0;
		let cursor = anchorDate;
		for (let offset = 0; offset < STREAK_LOOKBACK_DAYS; offset += 1) {
			const cursorMs = parseHabitDate(cursor);
			if (createdBoundaryMs !== null && cursorMs !== null && cursorMs < createdBoundaryMs) {
				break;
			}
			if (!habitScheduledOn(habit, cursor)) {
				cursor = addDaysToDateString(cursor, -1);
				continue;
			}
			const completed = completionByDate.get(cursor) === true;
			if (anchorCompleted ? completed : !completed) {
				streakLength += 1;
			} else {
				break;
			}
			cursor = addDaysToDateString(cursor, -1);
		}
		if (streakLength === 0) return null;
		return {
			kind: anchorCompleted ? 'positive' : 'negative',
			length: streakLength,
			missesOnLatest: anchorCompleted ? 0 : 1
		};
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

	function computeBracketStreak(days: Map<string, number>): PlayerStreak | null {
		const today = localToday();
		const yesterday = dateStringNDaysAgo(1);
		if (days.size === 0) return null;
		const hasHistory = Array.from(days.keys()).some((date) => date < today);
		if (!hasHistory) return null;
		const anchorPct = days.get(yesterday) ?? 0;
		const isPositive = anchorPct >= STREAK_TOP_BRACKET_PCT;
		let streakLength = 0;
		let cursor = yesterday;
		for (let offset = 0; offset < COMPLETION_STREAK_LOOKBACK_DAYS; offset += 1) {
			const pct = days.get(cursor) ?? 0;
			if (isPositive ? pct >= STREAK_TOP_BRACKET_PCT : pct < STREAK_TOP_BRACKET_PCT) {
				streakLength += 1;
				cursor = addDaysToDateString(cursor, -1);
				continue;
			}
			break;
		}
		if (streakLength === 0) return null;
		return {
			kind: isPositive ? 'positive' : 'negative',
			length: streakLength,
			missesOnLatest: 0
		};
	}
	function completionMapFromRecord(records: Record<string, number>) {
		return new Map<string, number>(Object.entries(records));
	}
	function waitForHeatmap(
		user_id: string,
		timeoutMs = 2000
	): Promise<Record<string, number> | null> {
		if (typeof window === 'undefined') return Promise.resolve(null);
		return new Promise((resolve) => {
			const current = get(heatmapStore);
			if (current.userId === user_id && !current.loading) {
				resolve(current.byDate);
				return;
			}
			let resolved = false;
			const timeout = window.setTimeout(() => {
				if (resolved) return;
				resolved = true;
				unsub();
				resolve(null);
			}, timeoutMs);
			const unsub = heatmapStore.subscribe((state) => {
				if (state.userId !== user_id || state.loading) return;
				if (resolved) return;
				resolved = true;
				window.clearTimeout(timeout);
				unsub();
				resolve(state.byDate);
			});
		});
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
			} else {
				blocksByUser = { ...blocksByUser, [viewerUserId]: {} };
			}
		} catch (error) {
			console.error('start next day error', error);
		} finally {
			reviewSubmitting = false;
		}
	}

	function habitStatusRecordsForUser(user_id: string, habitId: string): HabitDayStatus[] {
		return habitStatusByUser[user_id]?.[habitId] ?? [];
	}
	function habitCompletionStatusForBlock(
		user_id: string,
		h: number,
		half01: 0 | 1
	): boolean | null {
		const habit = getHabitEntry(user_id, h, half01);
		if (!habit) return null;
		const dateStr = displayDateForUser(user_id);
		const records = habitStatusRecordsForUser(user_id, habit.id);
		const match = records.find((record) => record.date === dateStr);
		return match ? match.completed : null;
	}
	function habitStreakForBlock(user_id: string, h: number, half01: 0 | 1): PlayerStreak | null {
		const habit = getHabitEntry(user_id, h, half01);
		if (!habit) return null;
		const records = habitStatusRecordsForUser(user_id, habit.id);
		return calculateHabitStreak(habit, records, h, half01);
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
		if (!canEditDayForUser(user_id)) return false;
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
		const habitEntry = getHabitEntry(user_id, hour, half);
		if (!blockHasContent(user_id, hour, half)) return false;
		if (habitEntry) return false;
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
			habit: null
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
	function cancelCopyBlock() {
		copyBlock = null;
	}
	function copyBlockAt(user_id: string, hour: number, half: 0 | 1) {
		if (!viewerUserId || viewerUserId !== user_id) return false;
		const habitEntry = getHabitEntry(user_id, hour, half);
		if (!blockHasContent(user_id, hour, half)) return false;
		if (habitEntry) return false;
		const sourceValue = getBlock(user_id, hour, half);
		copyBlock = {
			user_id,
			hour,
			half,
			value: {
				title: sourceValue.title ?? '',
				status: sourceValue.status,
				category: sourceValue.category ?? null
			}
		};
		const hourIndex = getHourIndex(hour);
		if (hourIndex !== -1) {
			setSelectedBlock({ hourIndex, half });
		}
		return true;
	}
	function copySelectedBlock() {
		if (!viewerUserId || !selectedBlock) return false;
		const hour = hours[selectedBlock.hourIndex];
		if (hour === undefined) return false;
		return copyBlockAt(viewerUserId, hour, selectedBlock.half);
	}
	function pasteCutBlockToTarget(hour: number, half: 0 | 1) {
		if (!cutBlock) return false;
		const { user_id, hour: fromHour, half: fromHalf } = cutBlock;
		if (hour === fromHour && half === fromHalf) {
			cancelCutBlock();
			return true;
		}
		if (getHabitEntry(user_id, hour, half)) return false;
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
	function shouldConfirmCopy(copy: PendingCopy) {
		const { user_id, toHour, toHalf } = copy;
		const destinationTitle = getDisplayTitle(user_id, toHour, toHalf);
		return destinationTitle.length > 0;
	}
	function pasteCopyBlockToTarget(hour: number, half: 0 | 1) {
		if (!copyBlock) return false;
		const { user_id, hour: fromHour, half: fromHalf, value } = copyBlock;
		if (hour === fromHour && half === fromHalf) return true;
		if (getHabitEntry(user_id, hour, half)) return false;
		const copy: PendingCopy = {
			user_id,
			fromHour,
			fromHalf,
			toHour: hour,
			toHalf: half,
			value
		};
		if (shouldConfirmCopy(copy)) {
			pendingCopy = copy;
		} else {
			void submitCopy(copy);
		}
		return true;
	}
	function pasteCopyBlockAtSelection() {
		if (!viewerUserId || !copyBlock || !selectedBlock) return false;
		const hour = hours[selectedBlock.hourIndex];
		if (hour === undefined) return false;
		return pasteCopyBlockToTarget(hour, selectedBlock.half);
	}
	function maybeHandlePaste(user_id: string, hour: number, half: 0 | 1) {
		if (!viewerUserId || viewerUserId !== user_id) return false;
		if (cutBlock && cutBlock.user_id === user_id) {
			return pasteCutBlockToTarget(hour, half);
		}
		if (copyBlock && copyBlock.user_id === user_id) {
			return pasteCopyBlockToTarget(hour, half);
		}
		return false;
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

	function promptDeleteSelectedEvent(event: UpcomingEvent | null) {
		if (!viewerUserId || !event) return false;
		if (isMilestoneEvent(event)) return false;
		pendingEventDelete = event;
		return true;
	}

	function cutSelectedCalendarEvent() {
		const index = calendarEventIndex ?? null;
		if (index === null) return false;
		const event = calendarSelectedEvents[index];
		if (!event || isMilestoneEvent(event)) return false;
		cutEvent = event;
		cutEventSourceDate = event.due_date;
		upcomingEvents = upcomingEvents.filter((entry) => entry.id !== event.id);
		calendarEventIndex = null;
		return true;
	}

	async function pasteCutCalendarEvent() {
		if (!cutEvent) return false;
		const targetDate = calendarSelectedDate;
		const originalEvent = cutEvent;
		const previousEvents = upcomingEvents;
		const updatedEvent = { ...originalEvent, due_date: targetDate };
		upcomingEvents = [
			...upcomingEvents.filter((entry) => entry.id !== originalEvent.id),
			updatedEvent
		].sort((a, b) => a.due_date.localeCompare(b.due_date));
		cutEvent = null;
		cutEventSourceDate = null;
		calendarEventIndex = null;
		if (isOptimisticEvent(updatedEvent)) return true;
		try {
			const { error } = await supabase
				.from('events')
				.update({ due_date: targetDate })
				.eq('id', updatedEvent.id)
				.eq('user_id', viewerUserId);
			if (error) throw error;
			return true;
		} catch (error) {
			console.error('event move error', { user_id: viewerUserId, error });
			upcomingEvents = previousEvents;
			cutEvent = originalEvent;
			cutEventSourceDate = originalEvent.due_date;
			return false;
		}
	}

	function isOptimisticEvent(event: UpcomingEvent) {
		return event.id.startsWith('optimistic-');
	}

	function triggerBadStatusShake(user_id: string, hour: number, half: 0 | 1) {
		const prevNonce = badStatusShake?.nonce ?? 0;
		badStatusShake = { user_id, hour, half, nonce: prevNonce + 1 };
	}

	function activateSelectedBlockFromKeyboard() {
		if (!viewerUserId || !selectedBlock) return false;
		const hour = hours[selectedBlock.hourIndex];
		if (hour === undefined) return false;
		const habitName = (getHabitTitle(viewerUserId, hour, selectedBlock.half) ?? '').trim();
		const title = getTitle(viewerUserId, hour, selectedBlock.half).trim();
		if (!title && !habitName) return true;
		if (getCategory(viewerUserId, hour, selectedBlock.half) === 'bad') {
			triggerBadStatusShake(viewerUserId, hour, selectedBlock.half);
			return true;
		}
		void cycleStatus(viewerUserId, hour, selectedBlock.half);
		return true;
	}

	function openSelectedBlockEditorFromKeyboard(normal: boolean) {
		if (!viewerUserId || !selectedBlock) return false;
		const hour = hours[selectedBlock.hourIndex];
		if (hour === undefined) return false;
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
			const habit = getHabitEntry(user_id, hour, half);
			const hasHabit = Boolean(habit);
			const hasContent = getDisplayTitle(user_id, hour, half).length > 0;

			if (!hasContent) {
				if (idx === startIndex) return [];
				break;
			}
			entries.push({
				index: idx,
				hour,
				half,
				title: title ?? '',
				status: status ?? null,
				category: getCategory(user_id, hour, half),
				habit,
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

		const undoTargets = new Map<string, { hour: number; half: 0 | 1 }>();
		for (const entry of entries) {
			undoTargets.set(`${entry.hour}-${entry.half}`, { hour: entry.hour, half: entry.half });
		}
		for (const move of moves) {
			const { hour: targetHour, half: targetHalf } = blockFromIndex(move.toIndex);
			if (targetHour === undefined) continue;
			undoTargets.set(`${targetHour}-${targetHalf}`, { hour: targetHour, half: targetHalf });
		}
		pushUndoAction(user_id, day_id, [...undoTargets.values()]);

		const clearEntries = [...overflow, ...moves.map((move) => move.entry)];
		const movedSelection = moves.find((move) => move.fromIndex === startIndex);
		for (const entry of clearEntries) {
			setTitle(user_id, entry.hour, entry.half, '', null, null);
			if (entry.hasHabit) setHabitEntry(user_id, entry.hour, entry.half, null);
		}
		for (const move of moves) {
			const { hour: toHour, half: toHalf } = blockFromIndex(move.toIndex);
			if (toHour === undefined) continue;
			const baseTitle = move.entry.title ?? '';
			const resolvedTitle = baseTitle.trim().length > 0 ? baseTitle : '';
			setTitle(
				user_id,
				toHour,
				toHalf,
				resolvedTitle,
				move.entry.status ?? null,
				move.entry.category
			);
			if (move.entry.hasHabit) setHabitEntry(user_id, toHour, toHalf, move.entry.habit ?? null);
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
			const baseTitle = move.entry.title ?? '';
			const habitTitle = move.entry.habit?.name ?? '';
			const resolvedTitle = baseTitle.trim().length > 0 ? baseTitle : habitTitle;
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
		if (getCategory(user_id, hour, half) === 'bad') {
			triggerBadStatusShake(user_id, hour, half);
			return;
		}
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
		focusGrid();
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
		focusGrid();
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
		if (!viewerUserId || modalOverlayActive) return;
		if (isTypingTarget(event.target)) return;
		const key = event.key;
		const normalized = key.length === 1 ? key.toLowerCase() : key;
		if (event.ctrlKey && !event.metaKey && !event.altKey) {
			if (normalized === 'l') {
				focusUpcoming();
				event.preventDefault();
				return;
			}
			if (normalized === 'h') {
				focusGrid();
				ensureSelectionExists();
				event.preventDefault();
				return;
			}
		}
		if (focusPane === 'upcoming') {
			if (normalized === 'j') {
				if (moveUpcomingSelection(1)) event.preventDefault();
				return;
			}
			if (normalized === 'k') {
				if (moveUpcomingSelection(-1)) event.preventDefault();
				return;
			}
			if (normalized === 'd') {
				const idx = upcomingSelectionIndex ?? 0;
				const entry = upcomingEvents[idx];
				if (entry && !isMilestoneEvent(entry)) {
					promptDeleteSelectedEvent(entry);
					event.preventDefault();
				}
				return;
			}
			if (normalized === 'i') {
				const idx = upcomingSelectionIndex ?? 0;
				const entry = upcomingEvents[idx];
				if (entry && !isMilestoneEvent(entry)) {
					openEventModal(entry);
				}
				event.preventDefault();
				return;
			}
			return;
		}
		const allowWithModifier =
			(event.metaKey || event.ctrlKey) && (normalized === 'n' || normalized === 'p');
		if ((event.metaKey || event.ctrlKey || event.altKey) && !allowWithModifier) return;
		if (normalized === 'Escape') {
			if (cutBlock) {
				cancelCutBlock();
				event.preventDefault();
				return;
			}
			if (copyBlock) {
				cancelCopyBlock();
				event.preventDefault();
				return;
			}
			return;
		}
		if ((normalized === 'n' || normalized === 'p') && !modalOverlayActive) {
			if (!(event.metaKey || event.ctrlKey)) {
				// allow normal n/p behavior
			} else if (normalized === 'p' && (cutBlock || copyBlock)) {
				// allow paste handling
			} else {
				const currentDate = displayDateForUser(viewerUserId);
				const nextDate = addDaysToDateString(currentDate, normalized === 'n' ? 1 : -1);
				activeDayDateStore?.set(nextDate);
				event.preventDefault();
				return;
			}
		}
		if (normalized === 'u') {
			void undoLastAction();
			event.preventDefault();
			return;
		}
		if (key.length === 1 && key >= '0' && key <= '9') {
			if (key === '0' && commandCount === null) return;
			commandCount = (commandCount ?? 0) * 10 + Number(key);
			pendingG = false;
			event.preventDefault();
			return;
		}
		if (
			!['h', 'j', 'k', 'l', 'g', 'm', '>', '<', 'Enter', 'i', 'd', 'x', 'y', 'p'].includes(
				normalized
			)
		)
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
			case 'y':
				handled = copySelectedBlock();
				break;
			case 'p':
				if (cutBlock) {
					handled = pasteCutBlockAtSelection();
				} else if (copyBlock) {
					handled = pasteCopyBlockAtSelection();
				}
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
				category: normalizeBlockCategory(r.category)
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
			category: normalizeBlockCategory(row.category)
		};
		applyRealtimeBlockValue(user_id, hour, half, blockValue);
	}
	function handleHabitStatusRealtime(
		user_id: string,
		payload: RealtimePostgresChangesPayload<HabitStatusRowPayload>
	) {
		const row = (payload.new ?? payload.old) as HabitStatusRowPayload | null;
		if (!row || row.user_id !== user_id) return;
		const habitId = row.habit_id;
		const day = row.day;
		if (!habitId || !day) return;
		const userRecords = habitStatusByUser[user_id] ?? {};
		const records = userRecords[habitId] ?? [];
		if (payload.eventType === 'DELETE') {
			const nextRecords = records.filter((record) => record.date !== day);
			habitStatusByUser = {
				...habitStatusByUser,
				[user_id]: { ...userRecords, [habitId]: nextRecords }
			};
			return;
		}
		const completed = Boolean(row.completed);
		const existingIndex = records.findIndex((record) => record.date === day);
		const nextEntry: HabitDayStatus = { date: day, completed };
		const nextRecords =
			existingIndex === -1
				? [...records, nextEntry]
				: records.map((record, index) => (index === existingIndex ? nextEntry : record));
		habitStatusByUser = {
			...habitStatusByUser,
			[user_id]: { ...userRecords, [habitId]: nextRecords }
		};
	}
	function habitEntryFromRow(row: HabitRowPayload): HabitEntry {
		const createdAt = row.created_at ? new Date(row.created_at) : new Date();
		const createdAtMs = Number.isNaN(createdAt.getTime()) ? Date.now() : createdAt.getTime();
		return {
			id: row.id,
			name: row.name ?? '',
			repeatDays: row.repeat_days ?? [0, 1, 2, 3, 4, 5, 6],
			category: normalizeBlockCategory(row.category),
			createdAtMs
		};
	}
	function handleHabitsRealtime(
		user_id: string,
		payload: RealtimePostgresChangesPayload<HabitRowPayload>
	) {
		const row = (payload.new ?? payload.old) as HabitRowPayload | null;
		if (!row || row.user_id !== user_id) return;
		const half01 = row.half ? 1 : 0;
		if (payload.eventType === 'DELETE') {
			setHabitEntry(user_id, row.hour, half01, null);
			clearHabitStatusById(user_id, row.id);
			return;
		}
		const entry = habitEntryFromRow(row);
		if (payload.eventType === 'UPDATE' && payload.old) {
			const oldRow = payload.old as HabitRowPayload;
			const oldHour = Number(oldRow.hour);
			const oldHalf = oldRow.half ? 1 : 0;
			if (oldHour !== row.hour || oldHalf !== half01) {
				setHabitEntry(user_id, oldHour, oldHalf, null);
			}
		}
		setHabitEntry(user_id, row.hour, half01, entry);
	}
	function teardownHoursRealtime(user_id: string) {
		const current = hoursRealtimeByUser[user_id];
		if (!current) return;
		current.channel.unsubscribe();
		hoursRealtimeByUser[user_id] = null;
	}
	function teardownHabitsRealtime(user_id: string) {
		const current = habitsRealtimeByUser[user_id];
		if (!current) return;
		current.unsubscribe();
		habitsRealtimeByUser[user_id] = null;
	}
	function teardownHabitStatusRealtime(user_id: string) {
		const current = habitStatusRealtimeByUser[user_id];
		if (!current) return;
		current.unsubscribe();
		habitStatusRealtimeByUser[user_id] = null;
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
	function ensureHabitsRealtime(user_id: string) {
		const existing = habitsRealtimeByUser[user_id];
		if (viewerUserId && user_id === viewerUserId) {
			if (existing) teardownHabitsRealtime(user_id);
			return;
		}
		if (existing) return;
		const channel = supabase.channel(`habits:${user_id}`);
		channel.on('postgres_changes', { event: '*', schema: 'public', table: 'habits' }, (payload) =>
			handleHabitsRealtime(user_id, payload as RealtimePostgresChangesPayload<HabitRowPayload>)
		);
		channel.subscribe();
		habitsRealtimeByUser[user_id] = channel;
	}
	function ensureHabitStatusRealtime(user_id: string) {
		const existing = habitStatusRealtimeByUser[user_id];
		if (viewerUserId && user_id === viewerUserId) {
			if (existing) teardownHabitStatusRealtime(user_id);
			return;
		}
		if (existing) return;
		const channel = supabase.channel(`habit-status:${user_id}`);
		channel.on(
			'postgres_changes',
			{ event: '*', schema: 'public', table: 'habit_day_status' },
			(payload) =>
				handleHabitStatusRealtime(
					user_id,
					payload as RealtimePostgresChangesPayload<HabitStatusRowPayload>
				)
		);
		channel.subscribe();
		habitStatusRealtimeByUser[user_id] = channel;
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
		for (const userId of Object.keys(habitsRealtimeByUser)) {
			teardownHabitsRealtime(userId);
		}
		for (const userId of Object.keys(selectedBlockRealtimeByUser)) {
			teardownSelectedBlockRealtime(userId);
		}
		for (const userId of Object.keys(habitStatusRealtimeByUser)) {
			teardownHabitStatusRealtime(userId);
		}
	}
	async function loadHabitsForUser(user_id: string) {
		const { data, error } = await supabase
			.from('habits')
			.select('id, hour, half, name, repeat_days, category, created_at')
			.eq('user_id', user_id);
		if (error) throw error;
		const next: Record<number, HabitBlockRow> = {};
		for (const r of data ?? []) {
			const h = r.hour as number;
			const half01 = (r.half ? 1 : 0) as 0 | 1;
			const name = r.name ?? '';
			const createdAt = r.created_at ? new Date(r.created_at as string) : new Date();
			const createdAtMs = Number.isNaN(createdAt.getTime()) ? Date.now() : createdAt.getTime();
			const entry: HabitEntry = {
				id: r.id as string,
				name,
				repeatDays: (r.repeat_days as number[] | null) ?? [0, 1, 2, 3, 4, 5, 6],
				category: normalizeBlockCategory(r.category),
				createdAtMs
			};
			next[h] ??= { first: null, second: null };
			if (half01 === 0) next[h].first = entry;
			else next[h].second = entry;
		}
		habitsByUser[user_id] = next;
	}
	async function upsertHabitDayStatus(user_id: string, habitId: string, completed: boolean) {
		const day = localToday();
		const { error } = await supabase.from('habit_day_status').upsert(
			{
				user_id,
				habit_id: habitId,
				day,
				completed
			},
			{ onConflict: 'habit_id,day' }
		);
		if (error) {
			console.error('habit day status update error', error);
			return false;
		}
		scheduleCompletionRefresh(user_id);
		return true;
	}
	function scheduleCompletionRefresh(user_id: string) {
		if (typeof window === 'undefined') return;
		if (completionRefreshTimeout !== null) {
			window.clearTimeout(completionRefreshTimeout);
		}
		completionRefreshTimeout = window.setTimeout(() => {
			window.dispatchEvent(new CustomEvent(HEATMAP_REFRESH_EVENT));
			void loadCompletionStreakForUser(user_id);
		}, 200);
	}
	function optimisticUpdateHabitStatus(user_id: string, habitId: string, completed: boolean) {
		const day = localToday();
		const userRecords = habitStatusByUser[user_id] ?? {};
		const records = userRecords[habitId] ?? [];
		const existingIndex = records.findIndex((record) => record.date === day);
		const nextEntry: HabitDayStatus = { date: day, completed };
		const nextRecords =
			existingIndex === -1
				? [...records, nextEntry]
				: records.map((record, index) => (index === existingIndex ? nextEntry : record));
		habitStatusByUser = {
			...habitStatusByUser,
			[user_id]: { ...userRecords, [habitId]: nextRecords }
		};
	}
	async function loadHabitStatusForUser(user_id: string) {
		const lookbackStart = dateStringNDaysAgo(STREAK_LOOKBACK_DAYS);
		try {
			const { data, error } = await supabase
				.from('habit_day_status')
				.select('habit_id, day, completed')
				.eq('user_id', user_id)
				.gte('day', lookbackStart);
			if (error) throw error;
			const grouped: Record<string, HabitDayStatus[]> = {};
			for (const row of data ?? []) {
				const habitId = row.habit_id as string | null;
				if (!habitId) continue;
				const day = row.day as string | null;
				if (!day) continue;
				const completed = Boolean(row.completed);
				grouped[habitId] ??= [];
				grouped[habitId].push({
					date: day,
					completed
				});
			}
			habitStatusByUser = { ...habitStatusByUser, [user_id]: grouped };
		} catch (error) {
			console.error('load habit streak error', { user_id, error });
			habitStatusByUser = { ...habitStatusByUser, [user_id]: {} };
		}
	}

	async function loadCompletionStreakForUser(user_id: string) {
		const lookbackStart = dateStringNDaysAgo(COMPLETION_STREAK_LOOKBACK_DAYS);
		try {
			let completionByDate: Record<string, number> | null = null;
			if (viewerUserId && user_id === viewerUserId) {
				completionByDate = await waitForHeatmap(user_id);
			}
			if (!completionByDate) {
				completionByDate = await fetchCompletionByDate(
					supabase,
					user_id,
					lookbackStart,
					TOTAL_BLOCKS_PER_DAY
				);
			}

			const days = completionMapFromRecord(completionByDate);
			streakByUser = {
				...streakByUser,
				[user_id]: computeBracketStreak(days)
			};
		} catch (error) {
			console.error('load completion streak error', { user_id, error });
		}
	}

	async function loadUpcomingEvents(user_id: string) {
		upcomingEventsLoading = true;
		try {
			const now = new Date();
			const today = localToday();
			const yearEnd = formatDateString(endOfYear(now));
			const { data, error } = await supabase
				.from('events')
				.select('id, title, due_date')
				.eq('user_id', user_id)
				.order('due_date', { ascending: true });
			if (error) throw error;
			const dbEvents = (data ?? [])
				.map((row) => ({
					id: row.id as string,
					title: (row.title as string | null) ?? '',
					due_date: (row.due_date as string | null) ?? ''
				}))
				.filter((event) => Boolean(event.title && event.due_date))
				.filter((event) => event.due_date >= today && event.due_date <= yearEnd);
			const milestoneEvents: UpcomingEvent[] = [
				{
					id: 'milestone-week',
					title: 'End of week review',
					due_date: formatDateString(endOfWeek(now))
				},
				{
					id: 'milestone-month',
					title: 'End of month review',
					due_date: formatDateString(endOfMonth(now))
				},
				{
					id: 'milestone-quarter',
					title: `End of ${quarterLabel(now)} review`,
					due_date: formatDateString(endOfQuarter(now))
				},
				{ id: 'milestone-year', title: 'End of year review', due_date: yearEnd }
			].filter((event) => event.due_date >= today && event.due_date <= yearEnd);
			upcomingEvents = [...milestoneEvents, ...dbEvents].sort((a, b) =>
				a.due_date.localeCompare(b.due_date)
			);
		} catch (error) {
			console.error('events load error', { user_id, error });
			upcomingEvents = [];
		} finally {
			upcomingEventsLoading = false;
		}
	}
	function blockHasElapsed(hour: number, half: 0 | 1) {
		if (currentHour < 0) return false;
		if (currentHour > hour) return true;
		if (currentHour === hour && currentHalf > half) return true;
		return false;
	}
	function endOfWeek(date: Date) {
		const end = new Date(date);
		const day = end.getDay();
		const diff = (7 - day) % 7;
		end.setDate(end.getDate() + diff);
		return end;
	}
	function endOfMonth(date: Date) {
		return new Date(date.getFullYear(), date.getMonth() + 1, 0);
	}
	function endOfQuarter(date: Date) {
		const quarterIndex = Math.floor(date.getMonth() / 3);
		const endMonth = quarterIndex * 3 + 2;
		return new Date(date.getFullYear(), endMonth + 1, 0);
	}
	function quarterLabel(date: Date) {
		const quarterIndex = Math.floor(date.getMonth() / 3) + 1;
		return `Q${quarterIndex}`;
	}
	function endOfYear(date: Date) {
		return new Date(date.getFullYear(), 11, 31);
	}

	let editorMode = $state(false);
	function openEditor(user_id: string, h: number, half01: 0 | 1, normal?: boolean) {
		if (viewerUserId !== user_id) return;
		logEventMode = false;
		const hourIndex = getHourIndex(h);
		if (hourIndex !== -1) {
			setSelectedBlock({ hourIndex, half: half01 });
		}
		const block = getBlock(user_id, h, half01);
		const habit = getHabitEntry(user_id, h, half01);
		const resolvedTitle = habit?.name ?? block.title ?? '';
		const resolvedCategory = habit?.category ?? block.category ?? null;
		draft = {
			user_id,
			hour: h,
			half: half01,
			title: resolvedTitle,
			status: block.status ?? null,
			category: resolvedCategory,
			habit
		};
		editorMode = normal ?? editorMode;
		logOpen = true;
	}

	function openEventModal(event?: UpcomingEvent) {
		if (!viewerUserId) return;
		const fallback = localToday();
		logEventMode = true;
		logEventId = event?.id ?? null;
		logDueDate = event?.due_date ?? fallback;
		draft = {
			user_id: viewerUserId,
			hour: START_HOUR,
			half: 0,
			title: event?.title ?? '',
			status: null,
			category: null,
			habit: null
		};
		editorMode = false;
		logOpen = true;
	}

	function openEventModalForDate(dateStr: string) {
		if (!viewerUserId) return;
		logEventMode = true;
		logEventId = null;
		logDueDate = dateStr;
		draft = {
			user_id: viewerUserId,
			hour: START_HOUR,
			half: 0,
			title: '',
			status: null,
			category: null,
			habit: null
		};
		editorMode = false;
		logOpen = true;
	}

	function closeLogModal() {
		logOpen = false;
		logEventMode = false;
		logEventId = null;
		logDueDate = '';
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
		category: BlockCategory | null,
		habitConfig: HabitSaveConfig | null,
		eventMode: boolean,
		dueDate: string
	) {
		const { user_id } = draft;
		if (!user_id || hour == null || half == null) return;
		if (eventMode) {
			const trimmedTitle = text.trim();
			const trimmedDate = dueDate.trim();
			if (!trimmedTitle || !trimmedDate) return;
			const prevUpcomingEvents = upcomingEvents;
			try {
				if (logEventId) {
					upcomingEvents = upcomingEvents.map((event) =>
						event.id === logEventId
							? { ...event, title: trimmedTitle, due_date: trimmedDate }
							: event
					);
					const { error } = await supabase
						.from('events')
						.update({ title: trimmedTitle, due_date: trimmedDate })
						.eq('id', logEventId)
						.eq('user_id', user_id);
					if (error) throw error;
				} else {
					const tempId = `optimistic-${Date.now()}`;
					const optimisticEvent: UpcomingEvent = {
						id: tempId,
						title: trimmedTitle,
						due_date: trimmedDate
					};
					upcomingEvents = [...upcomingEvents, optimisticEvent].sort((a, b) =>
						a.due_date.localeCompare(b.due_date)
					);
					const { data, error } = await supabase
						.from('events')
						.insert({
							user_id,
							title: trimmedTitle,
							due_date: trimmedDate
						})
						.select('id, title, due_date')
						.single();
					if (error) throw error;
					if (data) {
						upcomingEvents = upcomingEvents
							.map((event) =>
								event.id === tempId
									? {
											id: data.id as string,
											title: (data.title as string | null) ?? trimmedTitle,
											due_date: (data.due_date as string | null) ?? trimmedDate
										}
									: event
							)
							.sort((a, b) => a.due_date.localeCompare(b.due_date));
					}
				}
				logEventId = null;
			} catch (error) {
				console.error('event save error', { user_id, error });
				upcomingEvents = prevUpcomingEvents;
			}
			return;
		}
		const day_id = dayIdByUser[user_id];
		if (!day_id) return;

		const hourIndex = getHourIndex(hour);
		if (hourIndex === -1) return;
		const trimmedTitle = text.trim();
		if (habitConfig) {
			if (!trimmedTitle) return;
			const existingHabit = getHabitEntry(user_id, hour, half);
			if (existingHabit && existingHabit.id !== habitConfig.id) return;
			const payload = {
				user_id,
				name: trimmedTitle,
				hour,
				half: half === 1,
				repeat_days: habitConfig.repeatDays,
				category
			};
			try {
				let saved: HabitEntry | null = null;
				if (habitConfig.id) {
					const { data, error } = await supabase
						.from('habits')
						.update(payload)
						.eq('id', habitConfig.id)
						.select('id, name, repeat_days, category, created_at')
						.single();
					if (error) throw error;
					const createdAt = data.created_at ? new Date(data.created_at as string) : new Date();
					const createdAtMs = Number.isNaN(createdAt.getTime()) ? Date.now() : createdAt.getTime();
					saved = {
						id: data.id as string,
						name: data.name ?? '',
						repeatDays: (data.repeat_days as number[] | null) ?? [0, 1, 2, 3, 4, 5, 6],
						category: normalizeBlockCategory(data.category),
						createdAtMs
					};
				} else {
					const { data, error } = await supabase
						.from('habits')
						.insert(payload)
						.select('id, name, repeat_days, category, created_at')
						.single();
					if (error) throw error;
					const createdAt = data.created_at ? new Date(data.created_at as string) : new Date();
					const createdAtMs = Number.isNaN(createdAt.getTime()) ? Date.now() : createdAt.getTime();
					saved = {
						id: data.id as string,
						name: data.name ?? '',
						repeatDays: (data.repeat_days as number[] | null) ?? [0, 1, 2, 3, 4, 5, 6],
						category: normalizeBlockCategory(data.category),
						createdAtMs
					};
				}
				if (saved) {
					clearHabitEntryById(user_id, saved.id);
					setHabitEntry(user_id, hour, half, saved);
					const existingBlock = getBlock(user_id, hour, half);
					const hasHoursContent =
						(existingBlock.title ?? '').trim().length > 0 ||
						existingBlock.status !== null ||
						existingBlock.category !== null;
					if (hasHoursContent) {
						const { error: deleteErr } = await supabase
							.from('hours')
							.delete()
							.eq('day_id', day_id)
							.eq('hour', hour)
							.eq('half', half === 1);
						if (deleteErr) {
							console.error('save habit clear block error', deleteErr);
						} else {
							setTitle(user_id, hour, half, '', null, null);
						}
					}
				}
			} catch (error) {
				console.error('save habit error', error);
			}
			scheduleCompletionRefresh(user_id);
			closeLogModal();
			return;
		}
		const existingHabit = getHabitEntry(user_id, hour, half);
		if (existingHabit) {
			const { error: deleteHabitErr } = await supabase
				.from('habits')
				.delete()
				.eq('id', existingHabit.id);
			if (deleteHabitErr) {
				console.error('save block habit delete error', deleteHabitErr);
				return;
			}
			setHabitEntry(user_id, hour, half, null);
			clearHabitStatusById(user_id, existingHabit.id);
		}
		const totalBlocks = hours.length * 2;
		const isNewBlock = (draft.title ?? '').trim().length === 0;
		const maxCount = maxBlockCountFor(user_id, hour, half);
		const desiredCount = isNewBlock ? Math.min(blockCount, maxCount) : 1;
		const targets: { hour: number; half: 0 | 1 }[] = [];
		let resolvedCategory = category;
		const currentCategory = getBlock(user_id, hour, half).category ?? null;
		const shouldUpdateRunCategory = !isNewBlock && resolvedCategory !== currentCategory;
		const runTargets: { hour: number; half: 0 | 1 }[] = [];
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

		if (shouldUpdateRunCategory) {
			const { startIndex, endIndex } = blockRunRange(user_id, hour, half);
			for (let idx = startIndex; idx <= endIndex; idx += 1) {
				const { hour: targetHour, half: targetHalf } = blockFromIndex(idx);
				if (targetHour === undefined) break;
				const targetTitle = getTitle(user_id, targetHour, targetHalf).trim();
				if (!targetTitle) continue;
				runTargets.push({ hour: targetHour, half: targetHalf });
			}
		}

		pushUndoAction(user_id, day_id, [...targets, ...runTargets]);

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

		if (shouldUpdateRunCategory && runTargets.length > 0) {
			const categoryPayload = runTargets.map((target) => {
				const block = getBlock(user_id, target.hour, target.half);
				return {
					day_id,
					hour: target.hour,
					half: target.half === 1,
					title: block.title ?? '',
					status: block.status,
					category: resolvedCategory
				};
			});
			const { error: categoryError } = await supabase
				.from('hours')
				.upsert(categoryPayload, { onConflict: 'day_id,hour,half' });
			if (categoryError) {
				console.error('save category error', categoryError);
				return;
			}
			for (const target of runTargets) {
				const block = getBlock(user_id, target.hour, target.half);
				setTitle(
					user_id,
					target.hour,
					target.half,
					block.title ?? '',
					block.status,
					resolvedCategory
				);
			}
		}
		if (viewerUserId && user_id === viewerUserId) {
			if (hourIndex !== -1) {
				setSelectedBlock({ hourIndex, half });
				hoverBlock = null;
				suppressHoverSelection = true;
			}
		}
		scheduleCompletionRefresh(user_id);

		closeLogModal();
	}

	async function undoLastAction() {
		if (!viewerUserId) return;
		if (!canEditDayForUser(viewerUserId)) return;
		const dateKey = undoDateForUser(viewerUserId);
		if (!dateKey) return;
		const stack = undoStacksByDate[dateKey];
		if (!stack || stack.length === 0) return;
		const action = stack[stack.length - 1];
		undoStacksByDate = { ...undoStacksByDate, [dateKey]: stack.slice(0, -1) };

		const upserts: {
			day_id: string;
			hour: number;
			half: boolean;
			title: string;
			status: boolean | null;
			category: BlockCategory | null;
		}[] = [];
		const deletions: UndoEntry[] = [];
		const habitUpserts: {
			id: string;
			user_id: string;
			name: string;
			hour: number;
			half: boolean;
			repeat_days: number[];
			category: BlockCategory | null;
		}[] = [];
		const habitDeletes: UndoEntry[] = [];

		for (const entry of action.entries) {
			if (entry.hadRow && entry.before) {
				upserts.push({
					day_id: entry.day_id,
					hour: entry.hour,
					half: entry.half === 1,
					title: entry.before.title ?? '',
					status: entry.before.status ?? null,
					category: entry.before.category ?? null
				});
			} else {
				deletions.push(entry);
			}
			if (entry.habit) {
				habitUpserts.push({
					id: entry.habit.id,
					user_id: entry.user_id,
					name: entry.habit.name,
					hour: entry.hour,
					half: entry.half === 1,
					repeat_days: entry.habit.repeatDays,
					category: entry.habit.category
				});
			} else {
				habitDeletes.push(entry);
			}
		}

		try {
			for (const entry of action.entries) {
				if (entry.hadRow && entry.before) {
					setTitle(
						entry.user_id,
						entry.hour,
						entry.half,
						entry.before.title ?? '',
						entry.before.status ?? null,
						entry.before.category ?? null
					);
				} else {
					setTitle(entry.user_id, entry.hour, entry.half, '', null, null);
				}
				setHabitEntry(entry.user_id, entry.hour, entry.half, entry.habit ?? null);
			}

			const hoursDeletes = deletions.map((entry) =>
				supabase
					.from('hours')
					.delete()
					.eq('day_id', entry.day_id)
					.eq('hour', entry.hour)
					.eq('half', entry.half === 1)
			);
			const habitDeletesCalls = habitDeletes.map((entry) =>
				entry.habit
					? supabase.from('habits').delete().eq('id', entry.habit.id)
					: supabase
							.from('habits')
							.delete()
							.eq('user_id', entry.user_id)
							.eq('hour', entry.hour)
							.eq('half', entry.half === 1)
			);
			const hoursUpsert =
				upserts.length > 0
					? supabase.from('hours').upsert(upserts, { onConflict: 'day_id,hour,half' })
					: null;
			const habitsUpsert =
				habitUpserts.length > 0
					? supabase.from('habits').upsert(habitUpserts, { onConflict: 'id' })
					: null;

			const results = await Promise.all(
				[...hoursDeletes, ...habitDeletesCalls, hoursUpsert, habitsUpsert].filter(Boolean)
			);
			const errorResult = results.find((result) => (result as { error?: unknown })?.error) as
				| { error?: unknown }
				| undefined;
			if (errorResult?.error) throw errorResult.error;
			const targetUserId = action.entries[0]?.user_id;
			if (targetUserId) scheduleCompletionRefresh(targetUserId);
		} catch (error) {
			console.error('undo error', error);
		}
	}

	async function cycleStatus(user_id: string, hour: number, half: 0 | 1) {
		if (viewerUserId !== user_id) return;
		if (suppressNextClick) return;
		const day_id = dayIdByUser[user_id];
		if (!day_id) return;
		const habitEntry = getHabitEntry(user_id, hour, half);
		const block = getBlock(user_id, hour, half);
		if (habitEntry) {
			if (displayDateForUser(user_id) !== localToday()) return;
			const currentStatus = habitCompletionStatusForBlock(user_id, hour, half);
			const nextStatus = currentStatus === true ? false : true;
			void upsertHabitDayStatus(user_id, habitEntry.id, nextStatus);
			optimisticUpdateHabitStatus(user_id, habitEntry.id, nextStatus);
			return;
		}
		const title = (block.title ?? '').trim();
		if (!title) return;
		const nextStatus = block.status === null ? false : block.status === false ? true : null;
		const hourIndex = getHourIndex(hour);
		if (hourIndex === -1) return;
		const { startIndex, endIndex } = blockRunRange(user_id, hour, half);
		const runBlocks: { hour: number; half: 0 | 1 }[] = [];
		for (let idx = startIndex; idx <= endIndex; idx += 1) {
			const { hour: targetHour, half: targetHalf } = blockFromIndex(idx);
			if (targetHour === undefined) break;
			runBlocks.push({ hour: targetHour, half: targetHalf });
		}
		pushUndoAction(user_id, day_id, runBlocks);
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
		scheduleCompletionRefresh(user_id);
	}

	function cancelPendingMove() {
		if (isMoveSubmitting) return;
		pendingMove = null;
		pendingMoveSource = null;
	}
	function cancelPendingCopy() {
		if (isCopySubmitting) return;
		pendingCopy = null;
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
	async function confirmPendingCopy() {
		if (!pendingCopy) return;
		const copy = pendingCopy;
		const success = await submitCopy(copy);
		if (success) {
			pendingCopy = null;
		}
	}
	function shouldConfirmMove(move: PendingMove) {
		const { user_id, fromHour, fromHalf, toHour, toHalf } = move;
		const sourceHabit = getHabitEntry(user_id, fromHour, fromHalf);
		if (sourceHabit) return true;
		return blockHasContent(user_id, toHour, toHalf);
	}
	async function submitCopy(copy: PendingCopy): Promise<boolean> {
		if (isCopySubmitting) return false;
		isCopySubmitting = true;
		try {
			const { user_id, toHour, toHalf, value } = copy;
			if (viewerUserId !== user_id) return false;
			const day_id = dayIdByUser[user_id];
			if (!day_id) return false;
			const destinationHabit = getHabitEntry(user_id, toHour, toHalf);
			if (destinationHabit) return false;

			pushUndoAction(user_id, day_id, [{ hour: toHour, half: toHalf }]);

			const { error } = await supabase.from('hours').upsert(
				[
					{
						day_id,
						hour: toHour,
						half: toHalf === 1,
						title: value.title ?? '',
						status: value.status ?? null,
						category: value.category ?? null
					}
				],
				{ onConflict: 'day_id,hour,half' }
			);
			if (error) {
				console.error('block copy error', error);
				return false;
			}

			setTitle(
				user_id,
				toHour,
				toHalf,
				value.title ?? '',
				value.status ?? null,
				value.category ?? null
			);
			if (viewerUserId === user_id) {
				const hourIndex = getHourIndex(toHour);
				if (hourIndex !== -1) {
					setSelectedBlock({ hourIndex, half: toHalf });
				}
			}
			scheduleCompletionRefresh(user_id);
			return true;
		} finally {
			isCopySubmitting = false;
		}
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
		const sourceHabit = getHabitEntry(user_id, fromHour, fromHalf);
		const destinationHabit = getHabitEntry(user_id, toHour, toHalf);
		if (sourceHabit) {
			if (destinationHabit) return false;
			if (blockHasContent(user_id, toHour, toHalf)) return false;
			pushUndoAction(user_id, day_id, [
				{ hour: fromHour, half: fromHalf },
				{ hour: toHour, half: toHalf }
			]);
			const { error: updateHabitErr } = await supabase
				.from('habits')
				.update({ hour: toHour, half: toHalf === 1 })
				.eq('id', sourceHabit.id);
			if (updateHabitErr) {
				console.error('habit move error', updateHabitErr);
				return false;
			}
			setHabitEntry(user_id, toHour, toHalf, sourceHabit);
			setHabitEntry(user_id, fromHour, fromHalf, null);
			if (viewerUserId === user_id) {
				const hourIndex = getHourIndex(toHour);
				if (hourIndex !== -1) {
					setSelectedBlock({ hourIndex, half: toHalf });
				}
			}
			scheduleCompletionRefresh(user_id);
			return true;
		}
		if (destinationHabit) return false;

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
		const sourceHabitName = '';
		const destinationHabitName = '';

		pushUndoAction(user_id, day_id, [
			{ hour: fromHour, half: fromHalf },
			{ hour: toHour, half: toHalf }
		]);

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

		scheduleCompletionRefresh(user_id);
		return true;
	}

	function cancelPendingDelete() {
		if (isDeleteSubmitting) return;
		pendingDelete = null;
	}
	function cancelPendingEventDelete() {
		if (isEventDeleteSubmitting) return;
		pendingEventDelete = null;
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

	async function confirmPendingEventDelete() {
		if (!pendingEventDelete || isEventDeleteSubmitting) return;
		if (!viewerUserId) return;
		isEventDeleteSubmitting = true;
		const target = pendingEventDelete;
		const previousEvents = upcomingEvents;
		upcomingEvents = upcomingEvents.filter((event) => event.id !== target.id);
		try {
			if (isOptimisticEvent(target)) {
				pendingEventDelete = null;
				return;
			}
			const { error } = await supabase
				.from('events')
				.delete()
				.eq('id', target.id)
				.eq('user_id', viewerUserId);
			if (error) throw error;
			pendingEventDelete = null;
		} catch (error) {
			console.error('event delete error', { user_id: viewerUserId, error });
			upcomingEvents = previousEvents;
		} finally {
			isEventDeleteSubmitting = false;
		}
	}
	async function deleteBlock(action: PendingDelete): Promise<boolean> {
		const { user_id, hour, half } = action;
		if (viewerUserId !== user_id) return false;
		const day_id = dayIdByUser[user_id];
		const habitEntry = getHabitEntry(user_id, hour, half);
		if (habitEntry) {
			const { error } = await supabase.from('habits').delete().eq('id', habitEntry.id);
			if (error) {
				console.error('habit delete error', error);
				return false;
			}
			setHabitEntry(user_id, hour, half, null);
			clearHabitStatusById(user_id, habitEntry.id);
			scheduleCompletionRefresh(user_id);
			return true;
		}
		const title = (getTitle(user_id, hour, half) ?? '').trim();
		const status = getStatus(user_id, hour, half);
		const hourIndex = getHourIndex(hour);
		const totalBlocks = hours.length * 2;
		if (day_id) {
			const undoTargets: { hour: number; half: 0 | 1 }[] = [{ hour, half }];
			let prevBlock: { hour: number; half: 0 | 1 } | null = null;
			let prevTitle = '';
			let nextTitle = '';
			let isMiddleOfRun = false;
			if (title && hourIndex !== -1) {
				const currentIndex = blockIndex(hourIndex, half);
				const prevIndex = currentIndex - 1;
				const nextIndex = currentIndex + 1;
				if (prevIndex >= 0 && nextIndex < totalBlocks) {
					const prev = blockFromIndex(prevIndex);
					const next = blockFromIndex(nextIndex);
					if (prev.hour !== undefined && next.hour !== undefined) {
						prevTitle = (getTitle(user_id, prev.hour, prev.half) ?? '').trim();
						nextTitle = (getTitle(user_id, next.hour, next.half) ?? '').trim();
						isMiddleOfRun = prevTitle === title && nextTitle === title;
						prevBlock = prev;
						if (isMiddleOfRun) {
							undoTargets.push({ hour: prev.hour, half: prev.half });
						}
					}
				}
			}
			pushUndoAction(user_id, day_id, undoTargets);
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
			if (isMiddleOfRun && prevBlock) {
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

		setTitle(user_id, hour, half, '', null);
		scheduleCompletionRefresh(user_id);
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
			scheduleCompletionRefresh(user_id);

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
			scheduleCompletionRefresh(user_id);
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
		console.log('autoSwitchDayIfNeeded', { should });
		if (!should) return;
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
	let alarmAudioCtx: AudioContext | null = null;
	let isDesktop = $state(false);

	function isDesktopApp() {
		if (typeof window === 'undefined') return false;
		return Boolean((window as { desktop?: { isDesktop?: boolean } }).desktop?.isDesktop);
	}

	function playDesktopAlarm() {
		if (!isDesktopApp()) return;
		const AudioCtx =
			window.AudioContext ||
			(window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
		if (!AudioCtx) return;
		try {
			if (!alarmAudioCtx) {
				alarmAudioCtx = new AudioCtx();
			}
			void alarmAudioCtx.resume();

			const now = alarmAudioCtx.currentTime;
			const osc = alarmAudioCtx.createOscillator();
			const gain = alarmAudioCtx.createGain();

			osc.type = 'sine';
			osc.frequency.value = 880;

			gain.gain.setValueAtTime(0.0001, now);
			gain.gain.exponentialRampToValueAtTime(0.2, now + 0.02);
			gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.45);

			osc.connect(gain);
			gain.connect(alarmAudioCtx.destination);
			osc.start(now);
			osc.stop(now + 0.5);
		} catch {
			// Ignore audio errors (autoplay policies, device issues, etc.)
		}
	}

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
		playDesktopAlarm();
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
		const serverHeatmap = $page.data?.heatmapByDate as Record<string, number> | null | undefined;
		const serverHeatmapUserId = $page.data?.heatmapUserId as string | null | undefined;
		if (viewerUserId && serverHeatmap && serverHeatmapUserId === viewerUserId) {
			heatmapByDate = serverHeatmap;
			heatmapLoading = false;
			heatmapStore.set({ userId: viewerUserId, byDate: serverHeatmap, loading: false });
		} else {
			await loadHeatmap(viewerUserId);
		}

		try {
			const { data: rows, error: uerr } = await supabase
				.from('users')
				.select('id, display_name, selected_block_hour, selected_block_half, active_day_date')
				.order('display_name', { ascending: true });
			if (uerr) throw uerr;

			const nextActiveDayDates: Record<string, string | null> = {};
			const nextStreaks: Record<string, PlayerStreak | null> = {};
			people = (rows ?? []).map((r) => {
				const user_id = r.id as string;
				applyRemoteSelectionFromDb(user_id, r.selected_block_hour, r.selected_block_half);
				nextActiveDayDates[user_id] = (r.active_day_date as string | null) ?? null;
				nextStreaks[user_id] = null;
				return {
					label: r.display_name as string,
					user_id
				};
			});
			activeDayDateByUser = nextActiveDayDates;
			streakByUser = nextStreaks;
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
					loadHabitStatusForUser(user_id),
					loadCompletionStreakForUser(user_id)
				];
				if (dayId) tasks.push(loadHoursForDay(user_id, dayId));
				await Promise.all(tasks);
				ensureHoursRealtime(user_id, dayId);
				ensureHabitsRealtime(user_id);
				ensureHabitStatusRealtime(user_id);
			});

			await Promise.all(perUserLoads);

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
		isDesktop = isDesktopApp();
		updateCurrentTime();
		scheduleClockTick();
		init();
		const keyHandler = (event: KeyboardEvent) => {
			lastKeyAt = Date.now();
			setCursorHidden(true);
			if (modalOverlayActive) return;
			if (isTypingTarget(event.target)) return;
			const normalized = event.key.toLowerCase();
			if (!event.metaKey && !event.ctrlKey && !event.altKey) {
				if (normalized === 'g') {
					pendingCalendarG = true;
					if (pendingCalendarTimeout !== null) window.clearTimeout(pendingCalendarTimeout);
					pendingCalendarTimeout = window.setTimeout(() => {
						pendingCalendarG = false;
						pendingCalendarTimeout = null;
					}, 900);
				} else if (pendingCalendarG && normalized === 't') {
					pendingCalendarG = false;
					if (pendingCalendarTimeout !== null) window.clearTimeout(pendingCalendarTimeout);
					pendingCalendarTimeout = null;
					const nextOpen = !heatmapOpen;
					heatmapOpen = nextOpen;
					if (nextOpen && viewerUserId) {
						void loadHeatmap(viewerUserId);
					}
					event.preventDefault();
					return;
				} else if (pendingCalendarG) {
					pendingCalendarG = false;
					if (pendingCalendarTimeout !== null) window.clearTimeout(pendingCalendarTimeout);
					pendingCalendarTimeout = null;
				}
			}
			if (heatmapOpen && event.ctrlKey && !event.metaKey && !event.altKey) {
				if (normalized === 'n' || normalized === 'p') {
					const events = calendarSelectedEvents;
					if (events.length > 0) {
						if (calendarEventIndex === null) {
							calendarEventIndex = normalized === 'n' ? 0 : events.length - 1;
						} else {
							const delta = normalized === 'n' ? 1 : -1;
							const current = calendarEventIndex;
							const next = Math.max(0, Math.min(events.length - 1, current + delta));
							calendarEventIndex = next;
						}
						event.preventDefault();
						return;
					}
				}
			}
			if (!heatmapOpen && event.key === 'T') {
				const today = localToday();
				activeDayDateStore?.set(today);
				event.preventDefault();
				return;
			}
			if (heatmapOpen) {
				let handled = true;
				switch (normalized) {
					case 'x': {
						handled = cutSelectedCalendarEvent();
						break;
					}
					case 't': {
						if (event.key !== 'T') {
							handled = false;
							break;
						}
						const today = localToday();
						handleCalendarSelect(today);
						scrollCalendarToDate(today, { align: 'top' });
						break;
					}
					case 'd': {
						const events = calendarSelectedEvents;
						const index = calendarEventIndex ?? 0;
						const event = events[index];
						if (event && !isMilestoneEvent(event)) {
							promptDeleteSelectedEvent(event);
						}
						break;
					}
					case 'h':
						moveSelectedByDays(-1);
						break;
					case 'l':
						moveSelectedByDays(1);
						break;
					case 'j':
						moveSelectedByWeeks(1);
						break;
					case 'k':
						moveSelectedByWeeks(-1);
						break;
					case 'p':
						if (cutEvent) {
							void pasteCutCalendarEvent();
							break;
						}
						handled = false;
						break;
					case 'enter':
						heatmapOpen = false;
						activeDayDateStore?.set(calendarSelectedDate);
						break;
					case 'i':
						if (calendarEventIndex !== null) {
							const event = calendarSelectedEvents[calendarEventIndex];
							if (event && !isMilestoneEvent(event)) {
								openEventModal(event);
							} else {
								openEventModalForDate(calendarSelectedDate);
							}
						} else {
							openEventModalForDate(calendarSelectedDate);
						}
						break;
					case 'escape': {
						const today = localToday();
						handleCalendarSelect(today);
						heatmapOpen = false;
						activeDayDateStore?.set(today);
						break;
					}
					default:
						handled = false;
				}
				if (handled) {
					event.preventDefault();
				}
				return;
			}
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

{#if viewerUserId}
	<div class="pointer-events-none fixed top-4 right-4 z-50 flex flex-col items-end">
		<div class="pointer-events-auto relative flex items-center">
			<button
				type="button"
				class="rounded-sm p-2 text-stone-500 transition hover:bg-stone-300/50"
				aria-label="Toggle calendar"
				onclick={() => {
					const nextOpen = !heatmapOpen;
					heatmapOpen = nextOpen;
					if (nextOpen) {
						void loadHeatmap(viewerUserId);
					}
				}}
			>
				<svg
					xmlns="http://www.w3.org/2000/svg"
					width="18"
					height="18"
					fill="currentColor"
					class="bi bi-calendar-fill"
					viewBox="0 0 16 16"
				>
					<path
						d="M3.5 0a.5.5 0 0 1 .5.5V1h8V.5a.5.5 0 0 1 1 0V1h1a2 2 0 0 1 2 2v11a2 2 0 0 1-2 2H2a2 2 0 0 1-2-2V5h16V4H0V3a2 2 0 0 1 2-2h1V.5a.5.5 0 0 1 .5-.5"
					/>
				</svg>
			</button>
		</div>
	</div>
{/if}

{#if heatmapOpen}
	<div class="calendar-shell text-stone-800">
		<div class="calendar-header">
			<div class="calendar-month-label">{calendarHeaderLabel}</div>
			<div class="calendar-weekdays">
				{#each CALENDAR_WEEKDAYS as label}
					<div class="calendar-weekday">{label}</div>
				{/each}
			</div>
		</div>
		<div class="calendar-scroll" bind:this={calendarScrollEl}>
			{#each calendarWeekGroups as group, groupIndex}
				{@const groupMonth = calendarGroupMonthInfo(group)}
				<div
					class="calendar-group"
					data-group={groupIndex}
					bind:this={calendarGroupEls[groupIndex]}
				>
					{#each group as week, weekIndex}
						{@const globalWeekIndex = groupIndex * 6 + weekIndex}
						<div class="calendar-week" bind:this={calendarWeekEls[globalWeekIndex]}>
							{#each week as day}
								{@const dateKey = formatDateString(day)}
								{@const activeMonth = calendarVisibleMonth ?? groupMonth}
								{@const isCurrentMonth =
									day.getMonth() === activeMonth.monthIndex &&
									day.getFullYear() === activeMonth.year}
								{@const isSelected = dateKey === calendarSelectedDate}
								{@const isToday = dateKey === localToday()}
								{@const pct = heatmapByDate[dateKey] ?? 0}
								{@const isStrong = pct >= 50}
								{@const dayEvents = calendarEventsByDate.get(dateKey) ?? []}
								<button
									type="button"
									class={`calendar-cell ${
										isCurrentMonth ? '' : 'calendar-cell-muted'
									} ${isSelected ? 'calendar-cell-selected' : ''} ${
										isStrong ? 'calendar-cell-strong' : ''
									} ${!isSelected && isToday ? 'calendar-cell-today' : ''}`}
									ondblclick={(event) => {
										event.preventDefault();
										event.stopPropagation();
										handleCalendarSelect(dateKey);
										openEventModalForDate(dateKey);
									}}
									onclick={(event) => {
										handleCalendarSelect(dateKey);
										if (event.detail !== 2) return;
										event.preventDefault();
										event.stopPropagation();
										openEventModalForDate(dateKey);
									}}
								>
									<span
										class={`calendar-cell-swatch ${heatmapColorClass(pct)}`}
										onmouseenter={(event) => handleCalendarHover(dateKey, event)}
										onmousemove={updateCalendarHoverPosition}
										onmouseleave={clearCalendarHover}
									></span>
									<span
										class={`calendar-cell-date text-xs font-normal ${
											isToday ? 'calendar-cell-date-today' : ''
										}`}
									>
										{day.getDate()}
									</span>
									{#if dayEvents.length > 0}
										<div class="calendar-cell-events">
											{#each dayEvents as event, index}
												{@const isPastEvent = event.due_date < localToday()}
												{@const isMilestone = isMilestoneEvent(event)}
												<button
													type="button"
													class={`calendar-event-item ${
														isSelected && calendarEventIndex === index
															? 'calendar-event-selected'
															: ''
													} ${isPastEvent && !isMilestone ? 'calendar-event-past' : ''} ${
														isMilestone ? 'calendar-event-milestone' : ''
													}`}
													disabled={isMilestoneEvent(event)}
													onclick={(e) => {
														e.stopPropagation();
														handleCalendarSelect(dateKey);
														if (!isMilestoneEvent(event)) openEventModal(event);
													}}
												>
													<span class="calendar-event-title">{event.title}</span>
												</button>
											{/each}
										</div>
									{/if}
								</button>
							{/each}
						</div>
					{/each}
				</div>
			{/each}
		</div>
		{#if calendarHoverDate && calendarHoverPosition}
			{@const hoverMatchesSummary = calendarSummaryDate === calendarHoverDate}
			<div
				class="pointer-events-none fixed z-[9999] w-[360px] rounded-2xl border border-stone-200 bg-white p-4 shadow-2xl"
				style={`left: ${calendarHoverPosition.x}px; top: ${calendarHoverPosition.y}px;`}
			>
				<div class="text-sm font-semibold text-stone-900">
					{heatmapDateLabel(calendarHoverDate)}
				</div>
				{#if calendarSummaryLoading || !hoverMatchesSummary}
					<div class="mt-2 text-xs text-stone-400">Loading summary...</div>
				{:else}
					<div class="mt-3 space-y-2 text-sm text-stone-700">
						<div class="flex items-center justify-between">
							<span>Tasks planned</span>
							<span class="font-semibold text-stone-900">{calendarSummary?.planned ?? 0}</span>
						</div>
						<div class="flex items-center justify-between">
							<span>Tasks completed</span>
							<span class="font-semibold text-stone-900">{calendarSummary?.completed ?? 0}</span>
						</div>
						<div class="flex items-center justify-between">
							<span>Productive hours</span>
							<span class="font-semibold text-stone-900"
								>{formatProductiveHours(calendarSummary?.productiveHours ?? 0)}</span
							>
						</div>
					</div>
					<div class="mt-4 flex items-start justify-between gap-4">
						<div class="flex items-center justify-center">
							<div
								class="summary-pie h-24 w-24 rounded-full"
								style={summaryPieStyle(calendarSummary)}
							></div>
						</div>
						<div class="space-y-2 text-sm text-stone-700">
							{#each calendarSummary?.categoryBreakdown ?? [] as category}
								<div class="flex w-40 items-center justify-between">
									<div class="flex items-center gap-2">
										<span class={SUMMARY_CATEGORY_CLASSES[category.key]}>
											{#if category.key === 'rest'}
												<svg
													xmlns="http://www.w3.org/2000/svg"
													viewBox="0 0 16 16"
													class="h-3 w-3"
													fill="currentColor"
												>
													<path
														d="M3 14s-1 0-1-1 1-4 6-4 6 3 6 4-1 1-1 1zm5-6a3 3 0 1 0 0-6 3 3 0 0 0 0 6"
													/>
												</svg>
											{:else if category.key === 'body'}
												<svg
													xmlns="http://www.w3.org/2000/svg"
													viewBox="0 0 16 16"
													class="h-3 w-3"
													fill="currentColor"
												>
													<path
														d="M1.828 8.9 8.9 1.827a4 4 0 1 1 5.657 5.657l-7.07 7.071A4 4 0 1 1 1.827 8.9Zm9.128.771 2.893-2.893a3 3 0 1 0-4.243-4.242L6.713 5.429z"
													/>
												</svg>
											{:else if category.key === 'work'}
												<svg
													xmlns="http://www.w3.org/2000/svg"
													viewBox="0 0 16 16"
													class="h-3 w-3"
													fill="currentColor"
												>
													<path
														d="M0 3a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H2a2 2 0 0 1-2-2zm9.5 5.5h-3a.5.5 0 0 0 0 1h3a.5.5 0 0 0 0-1m-6.354-.354a.5.5 0 1 0 .708.708l2-2a.5.5 0 0 0 0-.708l-2-2a.5.5 0 1 0-.708.708L4.793 6.5z"
													/>
												</svg>
											{:else if category.key === 'admin'}
												<svg
													xmlns="http://www.w3.org/2000/svg"
													viewBox="0 0 16 16"
													class="h-3 w-3"
													fill="currentColor"
												>
													<path
														d="M12.643 15C13.979 15 15 13.845 15 12.5V5H1v7.5C1 13.845 2.021 15 3.357 15zM5.5 7h5a.5.5 0 0 1 0 1h-5a.5.5 0 0 1 0-1M.8 1a.8.8 0 0 0-.8.8V3a.8.8 0 0 0 .8.8h14.4A.8.8 0 0 0 16 3V1.8a.8.8 0 0 0-.8-.8z"
													/>
												</svg>
											{:else}
												<svg
													xmlns="http://www.w3.org/2000/svg"
													viewBox="0 0 16 16"
													class="h-3 w-3"
													fill="currentColor"
												>
													<path
														d="M16 8A8 8 0 1 1 0 8a8 8 0 0 1 16 0M5.354 4.646a.5.5 0 1 0-.708.708L7.293 8l-2.647 2.646a.5.5 0 0 0 .708.708L8 8.707l2.646 2.647a.5.5 0 0 0 .708-.708L8.707 8l2.647-2.646a.5.5 0 0 0-.708-.708L8 7.293z"
													/>
												</svg>
											{/if}
										</span>
										<span>{category.label}</span>
									</div>
									<span class="font-semibold text-stone-900"
										>{formatProductiveHours(category.hours)}h</span
									>
								</div>
							{/each}
						</div>
					</div>
				{/if}
			</div>
		{/if}
	</div>
{:else}
	<div
		class="relative flex h-dvh w-full flex-col justify-center overflow-clip bg-white p-8 select-none"
		class:cursor-none={hideCursor}
	>
		<div class="flex flex-row space-x-4">
			{#if isLoading}
				<div class="flex flex-col space-y-2">
					<div class="h-9 w-9 text-stone-50">T</div>
					{#each hours as h, i}
						<div class="relative flex h-10 w-10 items-center justify-center"></div>
					{/each}
				</div>
			{:else}
				<div class="flex flex-col space-y-2">
					<div class="h-10 w-10 text-stone-50">T</div>
					{#each hours as h, i}
						<div class="relative flex h-10 w-10 items-center justify-center">
							{#if showTimes}
								<div
									class="z-20 flex h-10 w-10 items-center justify-center rounded text-xl text-stone-300"
									in:fly|global={{ x: 8, duration: 400, delay: 40 * i + 200 }}
								>
									{hh(h)}
								</div>
							{/if}
							{#if isCurrent(h)}
								<div
									class="absolute top-1/2 left-1/2 h-9 w-9 -translate-x-1/2 -translate-y-1/2 rounded-md bg-stone-700"
									in:scale|global={{ start: 0.6, duration: 100, delay: 1000 }}
								></div>
							{/if}
						</div>
					{/each}
				</div>
			{/if}

			<div class="flex w-full flex-col">
				<div class="flex w-full flex-row gap-6">
					{#if isLoading}
						{#each loadingPlaceholderColumns as _}
							<div class="flex w-full flex-col space-y-2" aria-hidden="true">
								<div class="flex h-10 items-center gap-3">
									<div class="loading-sheen h-6 w-32 rounded bg-stone-200"></div>
								</div>
								{#each hours as _}
									<div class="flex h-10 w-full flex-row space-x-2">
										<div class="loading-block flex w-full rounded-md bg-stone-100"></div>
										<div class="loading-block flex w-full rounded-md bg-stone-100"></div>
									</div>
								{/each}
							</div>
						{/each}
					{:else}
						{#each visiblePeople as person}
							{@const trackedKey = getTrackedPlayerKeyForUser(person.user_id)}
							<div class="flex min-w-0 flex-1 flex-col space-y-2 transition-opacity">
								<div class="flex h-10 items-center gap-3">
									{#if trackedKey}
										<PlayerStatusTag
											label={isSinglePlayerView
												? dayLabelForUser(person.user_id)
												: (playerDisplays[trackedKey]?.label ?? null)}
											status={playerStatuses[trackedKey]}
											me={person.user_id === viewerUserId}
											streak={streakByUser[person.user_id] ?? null}
										/>
									{/if}
								</div>

								{#if dayIdByUser[person.user_id] === undefined || dayIdByUser[person.user_id] === undefined}
									{#each hours as _}
										<div class="flex h-10 w-full flex-row space-x-2">
											<div class="loading-block flex w-full rounded-md bg-stone-100"></div>
											<div class="loading-block flex w-full rounded-md bg-stone-100"></div>
										</div>
									{/each}
								{:else}
									{#each hours as h, hourIndex}
										{@const blockIsCutA = blockIsCut(person.user_id, h, 0)}
										{@const blockIsCutB = blockIsCut(person.user_id, h, 1)}
										{@const blockIsCopiedA = blockIsCopied(person.user_id, h, 0)}
										{@const blockIsCopiedB = blockIsCopied(person.user_id, h, 1)}
										<div
											class="hover:none flex h-10 w-full flex-row space-x-2"
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
													status={getDisplayStatus(person.user_id, h, 0)}
													category={getDisplayCategory(person.user_id, h, 0)}
													showStatus={blockShowsStatus(person.user_id, h, 0)}
													editable={canEditDayForUser(person.user_id)}
													onPrimaryAction={() => maybeHandlePaste(person.user_id, h, 0)}
													onSelect={() => handleBlockSelect(person.user_id, h, 0, false)}
													onCycleStatus={() => handleBlockCycle(person.user_id, h, 0)}
													badShakeNonce={badStatusShake &&
													badStatusShake.user_id === person.user_id &&
													badStatusShake.hour === h &&
													badStatusShake.half === 0
														? badStatusShake.nonce
														: 0}
													habit={getHabitTitle(person.user_id, h, 0)}
													habitStreak={habitStreakForBlock(person.user_id, h, 0)}
													selected={focusPane === 'grid' &&
														blockIsHighlighted(person.user_id, hourIndex, 0)}
													isCurrent={blockIsCurrent(h, 0)}
													isCut={blockIsCutA}
													isCopied={blockIsCopiedA}
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
													status={getDisplayStatus(person.user_id, h, 1)}
													category={getDisplayCategory(person.user_id, h, 1)}
													showStatus={blockShowsStatus(person.user_id, h, 1)}
													editable={canEditDayForUser(person.user_id)}
													onPrimaryAction={() => maybeHandlePaste(person.user_id, h, 1)}
													onSelect={() => handleBlockSelect(person.user_id, h, 1, false)}
													onCycleStatus={() => handleBlockCycle(person.user_id, h, 1)}
													badShakeNonce={badStatusShake &&
													badStatusShake.user_id === person.user_id &&
													badStatusShake.hour === h &&
													badStatusShake.half === 1
														? badStatusShake.nonce
														: 0}
													habit={getHabitTitle(person.user_id, h, 1)}
													habitStreak={habitStreakForBlock(person.user_id, h, 1)}
													selected={focusPane === 'grid' &&
														blockIsHighlighted(person.user_id, hourIndex, 1)}
													isCurrent={blockIsCurrent(h, 1)}
													isCut={blockIsCutB}
													isCopied={blockIsCopiedB}
												/>
											</div>
										</div>
									{/each}
								{/if}
							</div>
						{/each}
						{#if isSinglePlayerView}
							<div class="relative flex min-w-0 flex-1 flex-col gap-2 pl-0" aria-label="Upcoming">
								<div class="flex h-10 items-center justify-between">
									<div class="text-xl font-medium text-stone-800">Upcoming</div>
									<button
										type="button"
										class="flex h-8 w-8 items-center justify-center rounded-md text-lg font-semibold text-stone-400 transition hover:bg-stone-100 hover:text-stone-800"
										aria-label="New event"
										onclick={() => openEventModal()}
									>
										<svg
											xmlns="http://www.w3.org/2000/svg"
											width="20"
											height="20"
											fill="currentColor"
											class="bi bi-plus"
											viewBox="0 0 16 16"
											aria-hidden="true"
										>
											<path
												d="M8 4a.5.5 0 0 1 .5.5v3h3a.5.5 0 0 1 0 1h-3v3a.5.5 0 0 1-1 0v-3h-3a.5.5 0 0 1 0-1h3v-3A.5.5 0 0 1 8 4"
											/>
										</svg>
									</button>
								</div>
								<div class="space-y-4">
									{#if upcomingEventsLoading}
										<div class="text-sm text-stone-400">Loading...</div>
									{:else if upcomingEvents.length === 0}
										<div class="text-sm text-stone-400">No upcoming events yet.</div>
									{:else}
										{#each upcomingEvents as event, index}
											<button
												type="button"
												disabled={isMilestoneEvent(event)}
												class={`flex w-full flex-row justify-between rounded-lg p-5 text-left transition disabled:cursor-default ${
													isMilestoneEvent(event) ? 'bg-stone-50' : 'bg-stone-100'
												}`}
												class:ring-1={focusPane === 'upcoming' && upcomingSelectionIndex === index}
												class:ring-stone-400={focusPane === 'upcoming' &&
													upcomingSelectionIndex === index}
												class:ring-offset-1={focusPane === 'upcoming' &&
													upcomingSelectionIndex === index}
												class:ring-offset-stone-50={focusPane === 'upcoming' &&
													upcomingSelectionIndex === index}
												onpointerenter={() => focusUpcoming(index)}
												onpointerdown={() => focusUpcoming(index)}
												onclick={() => {
													if (!isMilestoneEvent(event)) openEventModal(event);
												}}
											>
												<div class="text-sm font-medium text-stone-800">{event.title}</div>
												<div class="flex items-center justify-end gap-2 text-sm text-stone-500">
													<span>{daysUntilLabel(event.due_date)}</span>
													<span class="text-stone-300">·</span>
													<span>{formatDisplayDate(event.due_date)}</span>
												</div>
											</button>
										{/each}
									{/if}
								</div>
							</div>
						{/if}
					{/if}
				</div>
			</div>
		</div>
	</div>
{/if}

<button
	class="no-drag fixed bottom-4 left-4 z-50 flex h-6 w-6 items-center justify-center text-stone-200 transition hover:text-stone-500"
	type="button"
	aria-label="Open settings"
	onclick={() => (settingsOpen = true)}
>
	<svg
		xmlns="http://www.w3.org/2000/svg"
		width="14"
		height="14"
		fill="currentColor"
		class="bi bi-gear-fill"
		viewBox="0 0 16 16"
		aria-hidden="true"
	>
		<path
			d="M9.405 1.05c-.413-1.4-2.397-1.4-2.81 0l-.1.34a1.464 1.464 0 0 1-2.105.872l-.31-.17c-1.283-.698-2.686.705-1.987 1.987l.169.311c.446.82.023 1.841-.872 2.105l-.34.1c-1.4.413-1.4 2.397 0 2.81l.34.1a1.464 1.464 0 0 1 .872 2.105l-.17.31c-.698 1.283.705 2.686 1.987 1.987l.311-.169a1.464 1.464 0 0 1 2.105.872l.1.34c.413 1.4 2.397 1.4 2.81 0l.1-.34a1.464 1.464 0 0 1 2.105-.872l.31.17c1.283.698 2.686-.705 1.987-1.987l-.169-.311a1.464 1.464 0 0 1 .872-2.105l.34-.1c1.4-.413 1.4-2.397 0-2.81l-.34-.1a1.464 1.464 0 0 1-.872-2.105l.17-.31c.698-1.283-.705-2.686-1.987-1.987l-.311.169a1.464 1.464 0 0 1-2.105-.872zM8 10.93a2.929 2.929 0 1 1 0-5.86 2.929 2.929 0 0 1 0 5.858z"
		/>
	</svg>
</button>

{#if modalOverlayActive}
	<div class="pointer-events-none fixed inset-0 z-40 bg-black/40" aria-hidden="true"></div>
{/if}

<SettingsModal
	open={settingsOpen}
	onClose={() => (settingsOpen = false)}
	{singlePlayerMode}
	singlePlayerDisabled={!viewerUserId}
	onToggleSinglePlayer={(next) => {
		if (!viewerUserId) return;
		singlePlayerMode = next;
	}}
/>

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
	initialHabit={draft.habit ? { id: draft.habit.id, repeatDays: draft.habit.repeatDays } : null}
	initialEventMode={logEventMode}
	initialDueDate={logDueDate}
	maxBlockCountFor={(hour, half) => maxBlockCountFor(viewerUserId, hour, half)}
	runLengthFor={(hour, half) => blockRunLength(viewerUserId, hour, half)}
	startHour={START_HOUR}
	endHour={END_HOUR}
/>

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
	open={pendingCopy !== null}
	onCancel={cancelPendingCopy}
	onConfirm={() => void confirmPendingCopy()}
	blockLabel={pendingCopySummary?.blockLabel ?? ''}
	fromLabel={pendingCopySummary?.fromLabel ?? ''}
	toLabel={pendingCopySummary?.toLabel ?? ''}
	destinationLabel={pendingCopySummary?.destinationLabel ?? null}
	hasDestinationContent={pendingCopySummary?.hasDestinationContent ?? false}
	isHabit={false}
	mode="copy"
	loading={isCopySubmitting}
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
<ConfirmMoveModal
	open={pendingEventDelete !== null}
	onCancel={cancelPendingEventDelete}
	onConfirm={() => void confirmPendingEventDelete()}
	blockLabel={pendingEventDelete?.title ?? ''}
	fromLabel={pendingEventDelete ? formatDisplayDate(pendingEventDelete.due_date) : ''}
	toLabel={pendingEventDelete ? formatDisplayDate(pendingEventDelete.due_date) : ''}
	destinationLabel={null}
	hasDestinationContent={false}
	isHabit={false}
	mode="delete"
	itemType="event"
	warningText="This will permanently delete this event."
	loading={isEventDeleteSubmitting}
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

	:global(:root) {
		--summary-body: #fda4af;
		--summary-rest: #c4b5fd;
		--summary-work: #cbd5e1;
		--summary-admin: rgba(120, 53, 15, 0.3);
		--summary-bad: #f43f5e;
		--summary-empty: #e5e7eb;
	}

	.summary-pie {
		background: conic-gradient(var(--summary-empty) 0% 100%);
	}

	.calendar-shell {
		--calendar-top-offset: 64px;
		--calendar-header-height: 72px;
		--calendar-gap: 1px;
		--calendar-row-height: calc(
			(
					100vh - var(--calendar-top-offset) - var(--calendar-header-height) -
						(5 * var(--calendar-gap))
				) /
				6
		);
		box-sizing: border-box;
		height: 100vh;
		padding-top: var(--calendar-top-offset);
		overflow: hidden;
		background: #fff;
	}

	.calendar-header {
		position: sticky;
		top: 0;
		z-index: 20;
		background: #fff;
		padding-bottom: 0;
	}

	.calendar-month-label {
		font-size: 20px;
		font-weight: 600;
		color: #1c1917;
		padding: 8px 0 6px 16px;
	}

	.calendar-weekdays {
		display: grid;
		grid-template-columns: repeat(7, minmax(0, 1fr));
		gap: 0;
		background: transparent;
		border-bottom: 1px solid #e5e7eb;
		margin-bottom: 0;
	}

	.calendar-weekday {
		background: #fff;
		text-align: center;
		font-size: 12px;
		font-weight: 400;
		color: #6b7280;
		height: 26px;
		display: flex;
		align-items: center;
		justify-content: center;
	}

	.calendar-scroll {
		height: calc(100vh - var(--calendar-top-offset) - var(--calendar-header-height));
		overflow-y: auto;
		scroll-snap-type: y proximity;
		scroll-padding-top: 0;
	}

	.calendar-group {
		display: flex;
		flex-direction: column;
		gap: var(--calendar-gap);
		background: #e5e7eb;
	}

	.calendar-group + .calendar-group {
		border-top: var(--calendar-gap) solid #e5e7eb;
	}

	.calendar-week {
		display: grid;
		grid-template-columns: repeat(7, minmax(0, 1fr));
		gap: var(--calendar-gap);
		background: #e5e7eb;
		height: var(--calendar-row-height);
		scroll-snap-align: start;
	}

	.calendar-cell {
		border: 0;
		width: 100%;
		height: 100%;
		padding: 8px;
		position: relative;
		background: #fff;
		text-align: right;
		display: flex;
		align-items: flex-start;
		justify-content: flex-end;
		transition: box-shadow 0.2s ease;
	}

	.calendar-cell-swatch {
		position: absolute;
		top: 8px;
		left: 8px;
		width: 16px;
		height: 16px;
		border-radius: 5px;
	}

	.calendar-cell:hover:not(.calendar-cell-selected) {
		box-shadow: none;
	}

	.calendar-cell-muted {
		opacity: 1;
	}

	.calendar-cell-muted .calendar-cell-date {
		opacity: 0.35;
	}

	.calendar-cell-selected {
		box-shadow: inset 0 0 0 2px #0c0a09;
	}

	.calendar-cell-strong {
		color: inherit;
	}

	.calendar-cell-date {
		display: inline-flex;
		align-items: center;
		justify-content: flex-end;
		width: 22px;
		height: 22px;
		color: inherit;
	}

	.calendar-cell-date-today {
		justify-content: center;
		padding: 0;
		border-radius: 8px;
		background: #ef4444;
		color: #fff;
	}

	.calendar-cell-events {
		position: absolute;
		left: 8px;
		right: 8px;
		bottom: 8px;
		display: flex;
		flex-direction: column;
		gap: 6px;
	}

	.calendar-event-item {
		display: flex;
		align-items: center;
		gap: 8px;
		padding: 4px 12px 4px 10px;
		background: #fff7ed;
		color: #9a3412;
		font-size: 12.5px;
		line-height: 1.2;
		text-align: left;
		border-radius: 8px;
		cursor: pointer;
		border: 0;
		position: relative;
		overflow: hidden;
	}

	.calendar-event-item::before {
		content: '';
		position: absolute;
		left: 0;
		top: 0;
		bottom: 0;
		width: 4px;
		background: #c2410c;
		border-radius: 8px;
	}

	.calendar-event-item:disabled {
		cursor: default;
		opacity: 0.6;
	}

	.calendar-event-selected {
		background: #c2410c;
		color: #fff;
	}

	.calendar-event-selected::before {
		display: none;
	}

	.calendar-event-milestone {
		background: #f3f4f6;
		color: #6b7280;
	}

	.calendar-event-milestone::before {
		background: #9ca3af;
	}

	.calendar-event-selected.calendar-event-milestone {
		background: #9ca3af;
		color: #fff;
	}

	.calendar-event-past {
		opacity: 0.55;
	}

	.calendar-event-title {
		flex: 1;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
</style>
