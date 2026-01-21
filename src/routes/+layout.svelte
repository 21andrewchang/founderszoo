<script lang="ts">
	import OnlineCount from '$lib/components/OnlineCount.svelte';
	import { onMount, setContext } from 'svelte';
	import { fly, blur, scale, fade } from 'svelte/transition';
	import '../app.css';
	import { writable, type Writable } from 'svelte/store';
	import { browser } from '$app/environment';
	import { page } from '$app/stores';
	import { supabase } from '$lib/supabaseClient';
	import type { Session } from '$lib/session';
	import type { User } from '@supabase/supabase-js';
	import { TRACKED_PLAYERS, type TrackedPlayerKey } from '$lib/trackedPlayers';
	import { formatLocalTimestamp } from '$lib/time';
	import { useGlobalPresence } from '$lib/presence';

	type Person = { label: string; user_id: string };
	type Goal = { id: string; title: string; goal_key: string | null };
	type PlayerDisplay = { label: string; user_id: string | null };
	type HistoryRow = { date: string; values: Record<TrackedPlayerKey, number> };

	const TRACKED_ROOMS = ['/', '/manifesto', '/collection', '/fundamentals'];
	const links = [
		{ href: '/manifesto', label: 'Manifesto' },
		{ href: '/fundamentals', label: 'Fundamentals' },
		{ href: '/collection', label: 'Collection' }
	];

	const isActive = (href: string, pathname: string) => {
		if (href === '/') return pathname === '/';
		return pathname === href || pathname.startsWith(href + '/');
	};

	const START_HOUR = 8;
	const END_HOUR = 24;
	const TOTAL_BLOCKS_PER_DAY = (END_HOUR - START_HOUR) * 2;
	const HISTORY_LOOKBACK_DAYS = 30;
	const CURRENT_PROGRESS_POLL_MS = 60_000;
	const HEATMAP_LOOKBACK_DAYS = 365;

	const formatDateString = (date: Date) =>
		`${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(
			date.getDate()
		).padStart(2, '0')}`;

	// session + auth context
	const session: Writable<Session> = writable({ user: null, name: '', loading: true });
	setContext('session', session);

	const authSetStore: Writable<boolean | null> = writable(null);
	setContext('authSet', authSetStore);

	const activeDayDateStore: Writable<string | null> = writable(null);
	setContext('activeDayDate', activeDayDateStore);

	let authSet = $state<boolean | null>(null);
	let viewerId = $state<string | null>(null);
	let store = $derived(useGlobalPresence(viewerId));

	const applyUser = (u: User | null) => {
		session.set({
			user: u,
			name: u?.user_metadata?.name ?? '',
			loading: false
		});
		viewerId = u?.id ?? null;
		if (!viewerId) {
			goalsByKey = {};
			isGoalModalOpen = false;
		}
	};

	// tracked players, history, goals, etc.
	let trackedDisplays = $state<Record<TrackedPlayerKey, PlayerDisplay>>({
		andrew: { label: 'Andrew', user_id: null },
		nico: { label: 'Nico', user_id: null }
	});
	let dayHistoryRows = $state<HistoryRow[]>([]);
	let dayHistoryOpen = $state(false);
	let dayHistoryLoading = $state(false);
	let currentCombinedPct = $state<number>(0);
	let dateMenuEl = $state<HTMLDivElement | null>(null);
	let heatmapOpen = $state(false);
	let heatmapLoading = $state(false);
	let heatmapByDate = $state<Record<string, number>>({});

	type GoalEntry = {
		id: string | null;
		title: string;
		how: string;
		goal_key: string;
		due_date: string;
	};
	type GoalSection = { title: string; items: GoalEntry[] };

	const QUARTERS = ['Q1', 'Q2', 'Q3', 'Q4'];
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
	const WEEKS = ['Week 1', 'Week 2', 'Week 3', 'Week 4'];
	const QUARTER_MONTHS = [
		MONTHS.slice(0, 3),
		MONTHS.slice(3, 6),
		MONTHS.slice(6, 9),
		MONTHS.slice(9, 12)
	];
	const NOW = new Date();
	const CURRENT_YEAR = NOW.getFullYear();
	const CURRENT_MONTH_INDEX = NOW.getMonth();
	const CURRENT_WEEK_INDEX = Math.min(4, Math.max(1, Math.ceil(NOW.getDate() / 7)));
	const MONTH_INDEX_BY_KEY = Object.fromEntries(
		MONTHS.map((label, index) => [label.toLowerCase(), index])
	);
	const MONTH_ABBR_BY_KEY = Object.fromEntries(
		MONTHS.map((label) => [label.toLowerCase().slice(0, 3), label.toLowerCase()])
	);
	const CURRENT_MONTH_KEY = MONTHS[CURRENT_MONTH_INDEX]?.toLowerCase() ?? 'january';
	const CURRENT_QUARTER_INDEX = Math.floor(CURRENT_MONTH_INDEX / 3);
	const CURRENT_QUARTER_KEY = QUARTERS[CURRENT_QUARTER_INDEX]?.toLowerCase() ?? 'q1';
	const CURRENT_WEEK_KEY = `${CURRENT_MONTH_KEY}-week${CURRENT_WEEK_INDEX}`;
	const YEAR_ENTRY: GoalEntry = {
		id: null,
		title: '',
		how: '',
		goal_key: 'year',
		due_date: `${CURRENT_YEAR}-12-31`
	};
	const QUARTER_STRUCTURE = QUARTERS.map((quarter, quarterIndex) => {
		const months = QUARTER_MONTHS[quarterIndex].map((month) => {
			const monthKey = month.toLowerCase();
			return {
				label: month,
				key: monthKey,
				weeks: WEEKS.map((week, weekIndex) => ({
					label: week,
					key: `${monthKey}-week${weekIndex + 1}`
				}))
			};
		});
		return {
			label: quarter,
			key: quarter.toLowerCase(),
			months
		};
	});

	let goalsByKey = $state<Record<string, GoalEntry>>({});
	let isGoalModalOpen = $state(false);
	let savingGoals = $state<Record<string, boolean>>({});
	let goalRotationIndex = $state(0);
	let selectedQuarterKey = $state(CURRENT_QUARTER_KEY);
	const GOAL_ROTATION = ['year', 'quarter', 'month', 'week'] as const;
	const yearGoalTitle = $derived((goalsByKey.year?.title ?? '').trim() || 'Goal');
	const yearGoalEntry = $derived(mergedYearEntry());
	const currentMonthEntry = $derived(mergeGoal(CURRENT_MONTH_KEY));
	const currentQuarterEntry = $derived(mergeGoal(CURRENT_QUARTER_KEY));
	const currentWeekEntry = $derived(mergeGoal(CURRENT_WEEK_KEY));
	const currentGoalKey = $derived(GOAL_ROTATION[goalRotationIndex] ?? 'year');

	function entryForGoalKey(goalKey: (typeof GOAL_ROTATION)[number]) {
		if (goalKey === 'week') return currentWeekEntry;
		if (goalKey === 'month') return currentMonthEntry;
		if (goalKey === 'quarter') return currentQuarterEntry;
		return yearGoalEntry;
	}

	function rangeLabelForGoalKey(goalKey: (typeof GOAL_ROTATION)[number]) {
		if (goalKey === 'week') {
			return `Now`;
		}
		if (goalKey === 'month') {
			return `${MONTHS[CURRENT_MONTH_INDEX]}`;
		}
		if (goalKey === 'quarter') {
			return `${QUARTERS[CURRENT_QUARTER_INDEX]}`;
		}
		return '2026';
	}

	const currentGoalEntry = $derived(entryForGoalKey(currentGoalKey));
	const currentRangeLabel = $derived(rangeLabelForGoalKey(currentGoalKey));

	const localToday = () => formatDateString(new Date());
	const dateStringNDaysAgo = (days: number) => {
		const d = new Date();
		d.setDate(d.getDate() - days);
		return formatDateString(d);
	};
	const parseLocalDate = (dateStr: string): Date | null => {
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
	};
	const formatDisplayDate = (
		dateStr: string,
		options: Intl.DateTimeFormatOptions = { month: 'short', day: 'numeric' }
	) => {
		const parsed = parseLocalDate(dateStr);
		if (!parsed) return dateStr;
		return parsed.toLocaleDateString(undefined, options);
	};
	const activeDayDate = $derived($activeDayDateStore ?? localToday());
	const activeDayLabel = $derived(
		formatDisplayDate(activeDayDate, { weekday: 'short', month: 'short', day: 'numeric' })
	);
	const heatmapDateLabel = (dateStr: string) =>
		formatDisplayDate(dateStr, { weekday: 'short', month: 'short', day: 'numeric' });
	const msPerDay = 24 * 60 * 60 * 1000;

	function startOfDay(date: Date) {
		return new Date(date.getFullYear(), date.getMonth(), date.getDate());
	}

	function daysUntilDue(dateStr: string | null) {
		if (!dateStr) return null;
		const parsed = parseLocalDate(dateStr);
		if (!parsed) return null;
		const due = startOfDay(parsed);
		const today = startOfDay(new Date());
		return Math.round((due.getTime() - today.getTime()) / msPerDay);
	}

	function formatDaysUntilText(days: number | null) {
		if (days === null) return null;
		if (days > 1) return `${days} days left`;
		if (days === 1) return '1 day left';
		if (days === 0) return 'Due today';
		if (days === -1) return '1 day overdue';
		return `${Math.abs(days)} days overdue`;
	}

	function endOfMonthDate(year: number, monthIndex: number) {
		return new Date(year, monthIndex + 1, 0);
	}

	function normalizeGoalKey(goalKey: string): string {
		const trimmed = goalKey.trim().toLowerCase();
		if (!trimmed) return trimmed;
		if (trimmed === 'year') return 'year';
		if (QUARTERS.some((q) => q.toLowerCase() === trimmed)) return trimmed;
		if (MONTH_INDEX_BY_KEY[trimmed] !== undefined) return trimmed;
		const abbrMatch = MONTH_ABBR_BY_KEY[trimmed];
		if (abbrMatch) return abbrMatch;
		const weekMatch = trimmed.match(/^([a-z]{3,9})-?week(\d)$/);
		if (weekMatch) {
			const monthKey = weekMatch[1];
			const weekIndex = weekMatch[2];
			const fullMonth =
				MONTH_INDEX_BY_KEY[monthKey] !== undefined ? monthKey : MONTH_ABBR_BY_KEY[monthKey];
			if (fullMonth) {
				return `${fullMonth}-week${weekIndex}`;
			}
		}
		return trimmed;
	}

	function goalDueDateForKey(goalKey: string): string {
		if (goalKey === 'year') return formatDateString(new Date(CURRENT_YEAR, 11, 31));
		const quarterIndex = QUARTERS.findIndex((q) => q.toLowerCase() === goalKey);
		if (quarterIndex !== -1) {
			const monthIndex = (quarterIndex + 1) * 3 - 1;
			return formatDateString(endOfMonthDate(CURRENT_YEAR, monthIndex));
		}
		const monthIndex = MONTH_INDEX_BY_KEY[goalKey];
		if (typeof monthIndex === 'number') {
			return formatDateString(endOfMonthDate(CURRENT_YEAR, monthIndex));
		}
		const [monthKey, weekKey] = goalKey.split('-week');
		const weekIndex = weekKey ? Number(weekKey) : Number.NaN;
		const weekMonthIndex = MONTH_INDEX_BY_KEY[monthKey];
		if (typeof weekMonthIndex === 'number' && Number.isFinite(weekIndex)) {
			const lastDay = endOfMonthDate(CURRENT_YEAR, weekMonthIndex).getDate();
			const day = weekIndex >= 4 ? lastDay : Math.min(lastDay, weekIndex * 7);
			return formatDateString(new Date(CURRENT_YEAR, weekMonthIndex, day));
		}
		return formatDateString(new Date(CURRENT_YEAR, 11, 31));
	}

	function mergedYearEntry() {
		return { ...YEAR_ENTRY, ...(goalsByKey.year ?? {}) };
	}

	function mergeGoal(goalKey: string): GoalEntry {
		const existing = goalsByKey[goalKey];
		const due_date = goalDueDateForKey(goalKey);
		if (!existing) {
			return { id: null, title: '', how: '', goal_key: goalKey, due_date };
		}
		return {
			id: existing.id,
			title: existing.title,
			how: existing.how ?? '',
			goal_key: goalKey,
			due_date: existing.due_date ?? due_date
		};
	}

	function heatmapColorClass(pct: number | null) {
		if (pct === null || Number.isNaN(pct)) return 'bg-stone-200';
		if (pct >= 75) return 'bg-green-800';
		if (pct >= 50) return 'bg-green-500';
		if (pct >= 25) return 'bg-green-200';
		return 'bg-stone-200';
	}

	function buildHeatmapWeeks() {
		const today = new Date();
		const year = today.getFullYear();
		const start = new Date(year, 0, 1);
		const end = new Date(year, 11, 31);
		const startDay = start.getDay();
		start.setDate(start.getDate() - startDay);
		const endDay = end.getDay();
		end.setDate(end.getDate() + (6 - endDay));
		const weeks: { days: Date[] }[] = [];
		let cursor = new Date(start);
		while (cursor <= end) {
			const days: Date[] = [];
			for (let i = 0; i < 7; i += 1) {
				days.push(new Date(cursor));
				cursor.setDate(cursor.getDate() + 1);
			}
			weeks.push({ days });
		}
		return weeks;
	}

	const heatmapWeeks = $derived(buildHeatmapWeeks());
	const heatmapMonthLabels = $derived(
		heatmapWeeks.map((week) => {
			const firstDay = week.days[0];
			return firstDay.getDate() <= 7
				? firstDay.toLocaleDateString(undefined, { month: 'short' })
				: '';
		})
	);

	function mergedQuarterStructure() {
		return QUARTER_STRUCTURE.map((quarter) => ({
			...quarter,
			goal: mergeGoal(quarter.key),
			months: quarter.months.map((month) => ({
				...month,
				goal: mergeGoal(month.key),
				weeks: month.weeks.map((week) => ({
					...week,
					goal: mergeGoal(week.key)
				}))
			}))
		}));
	}

	function openGoalModal() {
		isGoalModalOpen = true;
	}

	function closeGoalModal() {
		isGoalModalOpen = false;
	}

	function updateGoalDraft(goalKey: string, value: string) {
		const existing = goalsByKey[goalKey] ?? mergeGoal(goalKey);
		goalsByKey = {
			...goalsByKey,
			[goalKey]: {
				...existing,
				title: value,
				goal_key: goalKey
			}
		};
	}

	function updateGoalHowDraft(goalKey: string, value: string) {
		const existing = goalsByKey[goalKey] ?? mergeGoal(goalKey);
		goalsByKey = {
			...goalsByKey,
			[goalKey]: {
				...existing,
				how: value,
				goal_key: goalKey
			}
		};
	}

	function handleGoalKeydown(goalKey: string, event: KeyboardEvent) {
		if (event.key !== 'Enter') return;
		event.preventDefault();
		void saveGoal(goalKey);
		(event.currentTarget as HTMLInputElement).blur();
	}

	async function saveGoal(goalKey: string) {
		const entry = goalsByKey[goalKey] ?? mergeGoal(goalKey);
		if (!entry.title.trim() && !entry.how.trim()) return;
		const dueDate = goalDueDateForKey(goalKey);
		savingGoals = { ...savingGoals, [goalKey]: true };
		try {
			const { data, error } = await supabase
				.from('goals')
				.upsert(
					{
						goal_key: goalKey,
						title: entry.title.trim(),
						how: entry.how?.trim() ?? '',
						due_date: dueDate,
						created_at: formatLocalTimestamp(new Date())
					},
					{ onConflict: 'goal_key' }
				)
				.select('id, title, how, goal_key, due_date')
				.single();
			if (error) throw error;
			if (data) {
				goalsByKey = {
					...goalsByKey,
					[goalKey]: {
						id: data.id as string,
						title: (data.title ?? '').trim(),
						how: (data.how ?? entry.how ?? '').toString(),
						goal_key: (data.goal_key ?? goalKey).toString(),
						due_date: (data.due_date as string | null) ?? dueDate
					}
				};
			}
		} catch (error) {
			console.error('goal save error', error);
		} finally {
			savingGoals = { ...savingGoals, [goalKey]: false };
		}
	}

	async function saveAllGoals() {
		const keys = Object.keys(goalsByKey);
		if (keys.length === 0) return;
		await Promise.all(keys.map((key) => saveGoal(key)));
	}

	function updateTrackedPlayersFromPeople(list: Person[]) {
		const next = { ...trackedDisplays };
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
		trackedDisplays = next;
	}

	function emptyHistoryRecord(): Record<TrackedPlayerKey, number> {
		return TRACKED_PLAYERS.reduce(
			(acc, player) => ({ ...acc, [player.key]: null }),
			{} as Record<TrackedPlayerKey, number>
		);
	}

	function combinedPercent(values: Record<TrackedPlayerKey, number>): number {
		const percents = TRACKED_PLAYERS.map((player) => values[player.key]).filter(
			(pct): pct is number => typeof pct === 'number'
		);
		if (percents.length !== TRACKED_PLAYERS.length) return 0;
		const product = percents.reduce((acc, pct) => acc * (pct / 100), 1);
		return Math.max(1, Math.round(product * 100));
	}

	function getCurrentBlockInfo() {
		const now = new Date();
		const hour = now.getHours();
		const half = now.getMinutes() < 30 ? 0 : 1;
		const blocksDue = calculateBlocksDue(now);
		return { now, hour, half, blocksDue };
	}

	function calculateBlocksDue(now: Date) {
		const hour = now.getHours();
		const minute = now.getMinutes();
		if (hour < START_HOUR) return 0;
		if (hour >= END_HOUR) return TOTAL_BLOCKS_PER_DAY;
		const minutesSinceStart = (hour - START_HOUR) * 60 + minute;
		const blocksCompleted = Math.floor(minutesSinceStart / 30);
		return Math.min(TOTAL_BLOCKS_PER_DAY, Math.max(0, blocksCompleted));
	}

	function blockIsDue(hour: number, half: number, currentHour: number, currentHalf: number) {
		if (hour < START_HOUR) return false;
		if (hour > currentHour) return false;
		if (hour < currentHour) return true;
		return half < currentHalf;
	}

	async function refreshCurrentCombined() {
		const ids = Object.values(trackedDisplays)
			.map((display) => display.user_id)
			.filter((id): id is string => Boolean(id));
		if (ids.length === 0) {
			currentCombinedPct = 0;
			return;
		}
		const { hour: currentHour, half: currentHalf, blocksDue } = getCurrentBlockInfo();
		if (blocksDue === 0) {
			currentCombinedPct = 0;
			return;
		}
		const today = localToday();
		try {
			const idToKey = new Map<string, TrackedPlayerKey>();
			for (const [key, display] of Object.entries(trackedDisplays)) {
				if (display.user_id) idToKey.set(display.user_id, key as TrackedPlayerKey);
			}

			const { data: dayRows, error: dayErr } = await supabase
				.from('days')
				.select('id, user_id')
				.in('user_id', ids)
				.eq('date', today);
			if (dayErr) throw dayErr;

			const dayIdByUser = new Map<string, string>();
			for (const row of dayRows ?? []) {
				const id = (row.id as string | null) ?? null;
				const userId = (row.user_id as string | null) ?? null;
				if (!id || !userId) continue;
				dayIdByUser.set(userId, id);
			}
			const dayIds = Array.from(dayIdByUser.values());
			if (dayIds.length === 0) {
				currentCombinedPct = 0;
				return;
			}

			const dayToKey = new Map<string, TrackedPlayerKey>();
			for (const [userId, dayId] of dayIdByUser.entries()) {
				const key = idToKey.get(userId);
				if (key) dayToKey.set(dayId, key);
			}

			const { data: hoursRows, error: hoursErr } = await supabase
				.from('hours')
				.select('day_id, hour, half, title, status')
				.in('day_id', dayIds);
			if (hoursErr) throw hoursErr;

			const filledCounts = TRACKED_PLAYERS.reduce(
				(acc, player) => ({ ...acc, [player.key]: 0 }),
				{} as Record<TrackedPlayerKey, number>
			);

			for (const row of hoursRows ?? []) {
				const dayId = (row.day_id as string | null) ?? null;
				const hour = Number(row.hour);
				const half = ((row.half as boolean) ? 1 : 0) as 0 | 1;
				const title = (row.title as string | null) ?? '';
				const status = row.status as boolean | null;

				if (!dayId || Number.isNaN(hour)) continue;
				const key = dayToKey.get(dayId);
				if (!key) continue;
				if (!blockIsDue(hour, half, currentHour, currentHalf)) continue;
				const trimmed = title.trim();
				// status === false means explicitly in progress
				const isComplete = status === false ? false : trimmed.length > 0 || status === true;

				if (!isComplete) continue;
				filledCounts[key] += 1;
			}

			const percentageValues = TRACKED_PLAYERS.reduce(
				(acc, player) => {
					const filled = filledCounts[player.key];
					const pct = blocksDue > 0 ? Math.round((filled / blocksDue) * 100) : null;
					return { ...acc, [player.key]: pct };
				},
				{} as Record<TrackedPlayerKey, number>
			);

			currentCombinedPct = combinedPercent(percentageValues);
		} catch (error) {
			console.error('current combined load error', error);
			currentCombinedPct = 0;
		}
	}

	async function loadTrackedPlayerHistory() {
		const ids = Object.values(trackedDisplays)
			.map((display) => display.user_id)
			.filter((id): id is string => Boolean(id));
		if (ids.length === 0) {
			dayHistoryRows = [];
			return;
		}
		dayHistoryLoading = true;
		const today = localToday();
		const startDate = dateStringNDaysAgo(HISTORY_LOOKBACK_DAYS);
		const idToKey = new Map(
			Object.entries(trackedDisplays)
				.filter(([, display]) => display.user_id)
				.map(([key, display]) => [display.user_id as string, key as TrackedPlayerKey])
		);
		try {
			const { data, error } = await supabase
				.from('day_block_stats')
				.select('user_id, date, filled_blocks')
				.in('user_id', ids)
				.gte('date', startDate)
				.order('date', { ascending: false });
			if (error) throw error;

			const rows = new Map<string, Record<TrackedPlayerKey, number>>();
			for (const row of data ?? []) {
				const date = (row.date as string | null) ?? null;
				const userId = (row.user_id as string | null) ?? null;
				if (!date || date === today || !userId) continue;
				const key = idToKey.get(userId);
				if (!key) continue;
				const filled = Number(row.filled_blocks ?? 0);
				if (Number.isNaN(filled)) continue;
				const pct = Math.max(0, Math.min(100, Math.round((filled / TOTAL_BLOCKS_PER_DAY) * 100)));
				if (!rows.has(date)) rows.set(date, emptyHistoryRecord());
				rows.get(date)![key] = pct;
			}

			dayHistoryRows = Array.from(rows.entries())
				.sort((a, b) => (a[0] > b[0] ? -1 : 1))
				.map(([date, values]) => ({ date, values }));
		} catch (error) {
			console.error('tracked player history load error', error);
			dayHistoryRows = [];
		} finally {
			dayHistoryLoading = false;
		}
	}

	async function refreshTrackedPlayers() {
		try {
			const { data: rows, error } = await supabase
				.from('users')
				.select('id, display_name')
				.order('display_name', { ascending: true });
			if (error) throw error;
			const people = (rows ?? []).map((row) => ({
				label: row.display_name as string,
				user_id: row.id as string
			}));
			updateTrackedPlayersFromPeople(people);
			await loadTrackedPlayerHistory();
			await refreshCurrentCombined();
		} catch (error) {
			console.error('tracked player load error', error);
			dayHistoryRows = [];
			currentCombinedPct = 0;
		}
	}

	async function loadGoals() {
		try {
			const { data, error } = await supabase
				.from('goals')
				.select('id, title, how, goal_key, due_date');
			if (error) throw error;
			const next: Record<string, GoalEntry> = {};
			for (const row of data ?? []) {
				const rawKey = (row.goal_key as string | null) ?? '';
				if (!rawKey) continue;
				const goalKey = normalizeGoalKey(rawKey);
				next[goalKey] = {
					id: row.id as string,
					title: (row.title ?? '').trim(),
					how: (row.how ?? '').toString(),
					goal_key: goalKey,
					due_date: (row.due_date as string | null) ?? goalDueDateForKey(goalKey)
				};
			}
			goalsByKey = next;
		} catch (error) {
			console.error('goal load error', error);
			goalsByKey = {};
		}
	}

	async function loadHeatmap(userId: string | null) {
		if (!userId) {
			heatmapByDate = {};
			return;
		}
		heatmapLoading = true;
		const lookbackStart = dateStringNDaysAgo(HEATMAP_LOOKBACK_DAYS);
		try {
			const { data, error } = await supabase
				.from('day_block_stats')
				.select('date, filled_blocks')
				.eq('user_id', userId)
				.gte('date', lookbackStart)
				.order('date', { ascending: true });
			if (error) throw error;
			const next: Record<string, number> = {};
			for (const row of data ?? []) {
				const date = (row.date as string | null) ?? null;
				if (!date) continue;
				const filled = Number(row.filled_blocks ?? 0);
				const pct = Math.max(0, Math.min(100, Math.round((filled / TOTAL_BLOCKS_PER_DAY) * 100)));
				next[date] = pct;
			}
			heatmapByDate = next;
		} catch (error) {
			console.error('heatmap load error', error);
			heatmapByDate = {};
		} finally {
			heatmapLoading = false;
		}
	}

	let presenceCounts = $state({ tabs: 0, unique: 0, connected: false });

	$effect(() => {
		if (!browser) {
			presenceCounts = { tabs: 0, unique: 0, connected: false };
			return;
		}
		const unsubscribe = store.subscribe((v) => {
			presenceCounts = v;
		});
		return () => unsubscribe();
	});

	onMount(() => {
		let mounted = true;
		let currentProgressInterval: number | null = null;

		const init = async () => {
			let authUser: User | null = null;
			try {
				const { data } = await supabase.auth.getUser();
				if (!mounted) return;
				authUser = data.user ?? null;
				applyUser(authUser);
				authSet = authUser ? true : false;
				authSetStore.set(authSet);
			} catch {
				if (!mounted) return;
				applyUser(null);
				authSet = false;
				authSetStore.set(authSet);
				authUser = null;
			}
			if (!mounted) return;
			await loadGoals();
			await loadHeatmap(authUser?.id ?? null);
			await refreshTrackedPlayers();
		};

		void init();

		currentProgressInterval = window.setInterval(() => {
			void refreshCurrentCombined();
		}, CURRENT_PROGRESS_POLL_MS);

		const goalRotationInterval = window.setInterval(() => {
			goalRotationIndex = (goalRotationIndex + 1) % GOAL_ROTATION.length;
		}, 5000);

		const handleKeyDown = (event: KeyboardEvent) => {
			if (event.key === 'Escape' && heatmapOpen) {
				heatmapOpen = false;
			}
		};
		document.addEventListener('keydown', handleKeyDown);

		return () => {
			mounted = false;
			document.removeEventListener('keydown', handleKeyDown);
			if (currentProgressInterval !== null) {
				window.clearInterval(currentProgressInterval);
				currentProgressInterval = null;
			}
			window.clearInterval(goalRotationInterval);
		};
	});
	$inspect(authSet);
	$inspect($session.user);
	$inspect(currentCombinedPct);
	$inspect(presenceCounts.connected);

	let { children } = $props();
</script>

<svelte:head>
	<link rel="icon" href="/fz.svg" type="image/svg+xml" />
	<title>founders zoo.</title>
	<meta name="application-name" content="founders zoo." />
</svelte:head>

{#if authSet == null}
	<div></div>
{:else if !authSet && presenceCounts.connected}
	<div in:fly={{ y: 2, duration: 400 }}>
		<OnlineCount dedupe={false} counts={presenceCounts} />
		<nav
			class="fixed left-0 z-67 flex h-15 w-full items-center justify-center bg-white pt-5 pb-5 select-none selection:bg-stone-600 selection:text-stone-100"
			style="font-family: 'Cormorant Garamond', serif"
		>
			<a href="/" class="absolute left-5 text-xl tracking-wide text-stone-700"> founders zoo. </a>

			<div class="flex gap-6 text-sm text-stone-400">
				{#each links as link}
					<a
						href={link.href}
						class={`transition-colors duration-200 ease-out ${
							isActive(link.href, $page.url.pathname)
								? 'text-stone-800'
								: 'text-stone-400 hover:text-stone-800'
						}`}
					>
						{link.label}
					</a>
				{/each}
			</div>
		</nav>
	</div>
{:else if authSet && $session.user && presenceCounts.connected}
	<div in:fly={{ y: 2, duration: 200, delay: 100 }}>
		<OnlineCount dedupe={false} counts={presenceCounts} />
		<div
			class="pointer-events-none fixed top-4 left-4 z-50 flex flex-col items-start"
			bind:this={dateMenuEl}
		>
			<div class="pointer-events-auto relative">
				<button
					type="button"
					class="flex items-center justify-center gap-2 rounded-sm px-2 py-1 text-xs text-stone-700 transition hover:bg-stone-200/50"
					onclick={() => {
						heatmapOpen = true;
						void loadHeatmap(viewerId);
					}}
					aria-expanded={heatmapOpen}
				>
					<span>{activeDayLabel}</span>
					<div class="w-9 text-end text-xs font-semibold text-stone-800">
						{currentCombinedPct != null ? `${currentCombinedPct}%` : '—%'}
					</div>
				</button>
			</div>
		</div>
		<div class="pointer-events-none fixed top-4 left-1/2 z-40 -translate-x-1/2">
			{#if viewerId}
				<button
					type="button"
					class="pointer-events-auto flex flex-col items-center gap-0.5 text-xs font-semibold tracking-wide text-stone-800 uppercase transition"
					onclick={openGoalModal}
				>
					{#key currentGoalKey}
						<span
							in:fly={{ y: 4, delay: 400, duration: 200 }}
							out:fade={{ duration: 160 }}
							class="flex gap-1 rounded-md px-2 py-1 hover:bg-stone-100"
						>
							<span class="font-semibold tracking-wide text-stone-400">
								{currentRangeLabel}
							</span>
							<span>
								{currentGoalEntry.title || 'Goal'}
							</span>
						</span>
					{/key}
				</button>
			{:else}
				<div
					class="pointer-events-auto flex flex-col items-center gap-0.5 text-xs font-semibold tracking-wide text-stone-800 uppercase"
				>
					<span>{yearGoalTitle}</span>
					<span class="text-[10px] font-semibold tracking-wide text-stone-400">
						{currentRangeLabel}
					</span>
				</div>
			{/if}
		</div>
	</div>
{/if}

{#if isGoalModalOpen}
	<div
		class="fixed inset-0 z-[1800] bg-white text-stone-800"
		role="dialog"
		aria-modal="true"
		aria-label="Goals"
	>
		<div class="flex h-full flex-col">
			<div class="flex items-center justify-between border-b border-stone-200 px-6 py-4">
				<div class="text-[11px] font-semibold tracking-wide text-stone-500 uppercase">Goals</div>
				<div class="flex items-center gap-2">
					<button
						type="button"
						class="rounded-md border border-stone-300 px-3 py-1 text-xs font-semibold text-stone-600"
						onclick={() => {
							void saveAllGoals();
							closeGoalModal();
						}}
					>
						Close
					</button>
				</div>
			</div>
			<div class="flex-1 overflow-y-auto px-6 py-6">
				<div class="space-y-10">
					<div class="flex w-full items-center justify-between gap-12">
						<div class="flex items-center justify-end gap-2">
							{#each QUARTERS as quarterLabel}
								{@const quarterKey = quarterLabel.toLowerCase()}
								<button
									type="button"
									class="rounded-md border border-stone-200 px-3 py-1 text-xs font-semibold text-stone-600 transition"
									class:bg-stone-900={selectedQuarterKey === quarterKey}
									class:text-white={selectedQuarterKey === quarterKey}
									onclick={() => (selectedQuarterKey = quarterKey)}
								>
									{quarterLabel}
								</button>
							{/each}
						</div>
						<div class="flex w-full items-center gap-1">
							<div
								class="shrink-0 py-2 text-2xl font-semibold tracking-wide text-stone-400 uppercase"
							>
								2026
							</div>
							<input
								class="w-full p-2 text-2xl text-stone-800 outline-none"
								placeholder="Year goal"
								value={yearGoalEntry.title}
								oninput={(event) =>
									updateGoalDraft(
										yearGoalEntry.goal_key,
										(event.currentTarget as HTMLInputElement).value
									)}
								onchange={() => void saveGoal(yearGoalEntry.goal_key)}
								onkeydown={(event) => handleGoalKeydown(yearGoalEntry.goal_key, event)}
								onblur={() => void saveGoal(yearGoalEntry.goal_key)}
							/>
						</div>
					</div>

					<div class="space-y-6">
						{#each mergedQuarterStructure() as quarter}
							{#if quarter.key === selectedQuarterKey}
								<div class="space-y-4">
									<div class="flex items-center gap-1">
										<div class="pl-2 text-2xl font-semibold tracking-wide text-stone-400 uppercase">
											{quarter.label}
										</div>
										<input
											class="w-full rounded-md p-2 text-2xl text-stone-800 outline-none"
											placeholder={`${quarter.label} goal`}
											value={quarter.goal.title}
											oninput={(event) =>
												updateGoalDraft(
													quarter.goal.goal_key,
													(event.currentTarget as HTMLInputElement).value
												)}
											onchange={() => void saveGoal(quarter.goal.goal_key)}
											onkeydown={(event) => handleGoalKeydown(quarter.goal.goal_key, event)}
											onblur={() => void saveGoal(quarter.goal.goal_key)}
										/>
									</div>

									<div class="grid gap-6 lg:grid-cols-3">
										{#each quarter.months as month}
											<div class="space-y-3 rounded-md p-3">
												<div class="flex items-center gap-2">
													<div class="text-md font-semibold tracking-wide text-stone-500 uppercase">
														{month.label.slice(0, 3)}
													</div>
													<input
														class="text-md w-full rounded-md p-1 text-stone-800 outline-none"
														placeholder={`${month.label} goal`}
														value={month.goal.title}
														oninput={(event) =>
															updateGoalDraft(
																month.goal.goal_key,
																(event.currentTarget as HTMLInputElement).value
															)}
														onchange={() => void saveGoal(month.goal.goal_key)}
														onkeydown={(event) => handleGoalKeydown(month.goal.goal_key, event)}
														onblur={() => void saveGoal(month.goal.goal_key)}
													/>
												</div>
												<div class="space-y-2">
													{#each month.weeks as week}
														<div class="space-y-2">
															<div
																class="text-[10px] font-semibold tracking-wide text-stone-400 uppercase"
															>
																{week.label}
															</div>
															<input
																class="w-full rounded-md border border-stone-200 p-2 text-base text-stone-700 outline-none"
																placeholder={`${week.label} goal`}
																value={week.goal.title}
																oninput={(event) =>
																	updateGoalDraft(
																		week.goal.goal_key,
																		(event.currentTarget as HTMLInputElement).value
																	)}
																onchange={() => void saveGoal(week.goal.goal_key)}
																onkeydown={(event) => handleGoalKeydown(week.goal.goal_key, event)}
																onblur={() => void saveGoal(week.goal.goal_key)}
															/>
															<div
																class="text-[10px] font-semibold tracking-wide text-stone-400 uppercase"
															>
																How
															</div>
															<input
																class="w-full rounded-md border border-stone-200 p-2 text-sm text-stone-600 outline-none"
																placeholder="Daily how"
																value={week.goal.how}
																oninput={(event) =>
																	updateGoalHowDraft(
																		week.goal.goal_key,
																		(event.currentTarget as HTMLInputElement).value
																	)}
																onchange={() => void saveGoal(week.goal.goal_key)}
																onkeydown={(event) => handleGoalKeydown(week.goal.goal_key, event)}
																onblur={() => void saveGoal(week.goal.goal_key)}
															/>
														</div>
													{/each}
												</div>
											</div>
										{/each}
									</div>
								</div>
							{/if}
						{/each}
					</div>
				</div>
			</div>
		</div>
	</div>
{/if}

{#if heatmapOpen}
	<div
		class="fixed inset-0 z-[1800] bg-white text-stone-800"
		role="dialog"
		aria-modal="true"
		aria-label="Daily completion heatmap"
	>
		<div class="flex h-full flex-col">
			<div class="flex items-center justify-between border-b border-stone-200 px-6 py-4">
				<div class="text-[11px] font-semibold tracking-wide text-stone-500 uppercase">
					Daily completion
				</div>
				<button
					type="button"
					class="rounded-md border border-stone-300 px-3 py-1 text-xs font-semibold text-stone-600"
					onclick={() => (heatmapOpen = false)}
				>
					Close
				</button>
			</div>
			<div class="flex items-center bg-red-400 justify-center px-6 py-8">
				{#if heatmapLoading}
					<div class="text-sm text-stone-500"></div>
				{:else}
					<div class="flex flex-col gap-6">
						<div class="flex items-start gap-4">
							<div class="flex flex-col gap-1 pt-4 text-[10px] text-stone-400">
								<div class="h-3"></div>
								<div class="h-3">Mon</div>
								<div class="h-3"></div>
								<div class="h-3">Wed</div>
								<div class="h-3"></div>
								<div class="h-3">Fri</div>
							</div>
							<div class="flex flex-col gap-2">
								<div class="flex gap-1 text-[10px] text-stone-400">
									{#each heatmapMonthLabels as label}
										<div class="w-3 text-center">{label}</div>
									{/each}
								</div>
								<div class="flex gap-1">
									{#each heatmapWeeks as week}
										<div class="flex flex-col gap-1">
											{#each week.days as day}
												{@const dateKey = formatDateString(day)}
												<button
													type="button"
													class={`group relative h-3 w-3 rounded-xs ${heatmapColorClass(
														heatmapByDate[dateKey] ?? 0
													)}`}
													onclick={() => {
														activeDayDateStore.set(dateKey);
														heatmapOpen = false;
													}}
												>
													<span
														class="pointer-events-none absolute bottom-full left-1/2 z-[9999] mb-1 -translate-x-1/2 rounded-md bg-stone-700 px-2 py-1 text-xs font-medium whitespace-nowrap text-white opacity-0 shadow-lg transition-opacity duration-150 group-hover:opacity-100"
													>
														{heatmapDateLabel(dateKey)}
													</span>
												</button>
											{/each}
										</div>
									{/each}
								</div>
							</div>
						</div>
					</div>
				{/if}
			</div>
		</div>
	</div>
{/if}

{@render children()}
