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
	import GrogathLogin from './grogath/+page.svelte';

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
	const YC_APP_DUE_DATE = '2026-02-09';

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

	const applyAuthState = (u: User | null) => {
		applyUser(u);
		authSet = u ? true : false;
		authSetStore.set(authSet);
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
		badBlocks: number;
		categoryBreakdown: SummaryCategory[];
	};

	let heatmapOpen = $state(false);
	let heatmapLoading = $state(false);
	let heatmapAnimated = $state(false);
	let heatmapByDate = $state<Record<string, number>>({});
	let heatmapScrollEl = $state<HTMLDivElement | null>(null);
	let heatmapTooltip = $state({ text: '', x: 0, y: 0, visible: false });
	let calendarLockedDate = $state<string | null>(null);
	let calendarHoverDate = $state<string | null>(null);
	let calendarMonthIndex = $state<number>(new Date().getMonth());
	let calendarYear = $state<number>(new Date().getFullYear());
	let calendarSummary = $state<SummaryStats | null>(null);
	let calendarSummaryDate = $state<string | null>(null);
	let calendarSummaryLabel = $state<string | null>(null);
	let calendarSummaryLoading = $state(false);
	let calendarSummaryRequestId = 0;

	type GoalEntry = {
		id: string | null;
		title: string;
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
	const MONTH_LABELS = [
		'Jan',
		'Feb',
		'Mar',
		'Apr',
		'May',
		'Jun',
		'Jul',
		'Aug',
		'Sep',
		'Oct',
		'Nov',
		'Dec'
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
		goal_key: 'year',
		due_date: `${CURRENT_YEAR}-12-31`
	};
	const QUARTER_STRUCTURE = QUARTERS.map((quarter, quarterIndex) => {
		const months = QUARTER_MONTHS[quarterIndex].map((month, monthIndex) => {
			const monthKey = month.toLowerCase();
			return {
				label: MONTH_LABELS[quarterIndex * 3 + monthIndex] ?? month,
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
	let pendingNavG = false;
	let navGTimeout: number | null = null;
	let savingGoals = $state<Record<string, boolean>>({});
	let goalRotationIndex = $state(0);
	let selectedQuarterKey = $state(CURRENT_QUARTER_KEY);
	type GoalRotationKey = 'year' | 'quarter' | 'month' | 'week' | 'yc-app';
	const msPerDay = 24 * 60 * 60 * 1000;

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
	const GOAL_ROTATION = $derived.by<GoalRotationKey[]>(() => {
		const base: GoalRotationKey[] = ['year', 'quarter', 'month', 'week'];
		const days = daysUntilDue(YC_APP_DUE_DATE);
		if (days !== null && days >= 0) base.push('yc-app');
		return base;
	});
	const yearGoalTitle = $derived((goalsByKey.year?.title ?? '').trim() || 'Milestone');
	const yearGoalEntry = $derived(mergedYearEntry());
	const currentMonthEntry = $derived(mergeGoal(CURRENT_MONTH_KEY));
	const currentQuarterEntry = $derived(mergeGoal(CURRENT_QUARTER_KEY));
	const currentWeekEntry = $derived(mergeGoal(CURRENT_WEEK_KEY));
	const currentGoalKey = $derived(GOAL_ROTATION[goalRotationIndex] ?? 'year');

	function entryForGoalKey(goalKey: GoalRotationKey) {
		if (goalKey === 'week') return currentWeekEntry;
		if (goalKey === 'month') return currentMonthEntry;
		if (goalKey === 'quarter') return currentQuarterEntry;
		if (goalKey === 'yc-app') {
			return {
				id: null,
				title: 'YC App',
				goal_key: 'yc-app',
				due_date: YC_APP_DUE_DATE
			};
		}
		return yearGoalEntry;
	}

	function rangeLabelForGoalKey(goalKey: GoalRotationKey) {
		if (goalKey === 'week') {
			return `W${CURRENT_WEEK_INDEX}`;
		}
		if (goalKey === 'month') {
			return `${MONTH_LABELS[CURRENT_MONTH_INDEX]}`;
		}
		if (goalKey === 'quarter') {
			return `${QUARTERS[CURRENT_QUARTER_INDEX]}`;
		}
		if (goalKey === 'yc-app') {
			const days = daysUntilDue(YC_APP_DUE_DATE);
			if (days === null) return 'Days';
			if (days > 1) return `${days} Days`;
			if (days === 1) return '1 Day';
			if (days === 0) return 'Due Today';
			return 'Days';
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
	const isActiveDayToday = $derived(activeDayDate === localToday());
	const heatmapDateLabel = (dateStr: string) =>
		formatDisplayDate(dateStr, { weekday: 'short', month: 'short', day: 'numeric' });
	const calendarSelectedDate = $derived(calendarLockedDate ?? activeDayDate);
	const calendarPreviewDate = $derived(calendarLockedDate ?? activeDayDate);
	const calendarMonthLabel = $derived(`${MONTHS[calendarMonthIndex] ?? MONTHS[0]} ${calendarYear}`);
	const calendarWeeks = $derived(buildCalendarWeeks(calendarYear, calendarMonthIndex));
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
		if (!heatmapOpen) return;
		calendarHoverDate = null;
		if (!calendarLockedDate) {
			setCalendarMonthFromDate(activeDayDate);
		}
	});

	$effect(() => {
		if (!heatmapOpen) return;
		if (!viewerId) return;
		if (!calendarPreviewDate) return;
		if (calendarPreviewDate === calendarSummaryDate && calendarSummary) return;
		void loadCalendarSummary(calendarPreviewDate);
	});

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
			return { id: null, title: '', goal_key: goalKey, due_date };
		}
		return {
			id: existing.id,
			title: existing.title,
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

	const CALENDAR_WEEKDAYS = ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su'];
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

	function formatProductiveHours(value: number) {
		const rounded = Math.round(value * 10) / 10;
		return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
	}

	function summaryScoreColor(score: number) {
		if (score >= 75) return 'bg-emerald-700';
		if (score >= 50) return 'bg-emerald-500';
		if (score >= 25) return 'bg-emerald-300';
		return 'bg-stone-500';
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
		let badBlocks = 0;
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
			const isBad = category === 'bad';
			if (title.length > 0 && isBad) badBlocks += 1;
			if (!isBad) {
				if (title.length > 0) planned += 1;
				if (title.length > 0 && row.status !== false) completed += 1;
			}
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
			badBlocks,
			categoryBreakdown
		};
	}

	function buildCalendarWeeks(year: number, monthIndex: number) {
		const firstDay = new Date(year, monthIndex, 1);
		const firstWeekday = (firstDay.getDay() + 6) % 7;
		const start = new Date(firstDay);
		start.setDate(firstDay.getDate() - firstWeekday);
		const end = new Date(start);
		end.setDate(start.getDate() + 6 * 7 - 1);
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

	function addDaysToDateString(dateStr: string, days: number) {
		const parsed = parseLocalDate(dateStr);
		if (!parsed) return localToday();
		parsed.setDate(parsed.getDate() + days);
		return formatDateString(parsed);
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

	function handleHeatmapWheel(event: WheelEvent) {
		if (!heatmapScrollEl) return;
		const rect = heatmapScrollEl.getBoundingClientRect();
		if (
			event.clientX < rect.left ||
			event.clientX > rect.right ||
			event.clientY < rect.top ||
			event.clientY > rect.bottom
		) {
			return;
		}
		if (Math.abs(event.deltaX) > Math.abs(event.deltaY)) return;
		if (heatmapScrollEl.scrollWidth <= heatmapScrollEl.clientWidth) return;
		heatmapScrollEl.scrollLeft += event.deltaY;
		event.preventDefault();
	}

	function showHeatmapTooltip(event: MouseEvent, label: string) {
		heatmapTooltip = {
			text: label,
			x: event.clientX,
			y: event.clientY - 10,
			visible: true
		};
	}

	function moveHeatmapTooltip(event: MouseEvent) {
		if (!heatmapTooltip.visible) return;
		heatmapTooltip = {
			...heatmapTooltip,
			x: event.clientX,
			y: event.clientY - 10
		};
	}

	function hideHeatmapTooltip() {
		heatmapTooltip = { ...heatmapTooltip, visible: false };
	}

	const UPCOMING_EVENTS = [
		{ id: 'yc-app', title: 'YC App Due', date: YC_APP_DUE_DATE },
		{
			id: 'yc-final-pass',
			title: 'YC App Final Pass',
			date: addDaysToDateString(YC_APP_DUE_DATE, -3)
		},
		{
			id: 'yc-demo',
			title: 'YC Demo Ready',
			date: addDaysToDateString(YC_APP_DUE_DATE, 7)
		}
	];

	function setCalendarMonthFromDate(dateStr: string) {
		const parsed = parseLocalDate(dateStr);
		if (!parsed) return;
		calendarMonthIndex = parsed.getMonth();
		calendarYear = parsed.getFullYear();
	}

	async function loadCalendarSummary(dateStr: string) {
		if (!viewerId) return;
		const requestId = (calendarSummaryRequestId += 1);
		calendarSummaryLoading = true;
		calendarSummaryDate = dateStr;
		calendarSummaryLabel = heatmapDateLabel(dateStr);
		try {
			let habitCompleted = 0;
			const { data: habitRows, error: habitError } = await supabase
				.from('habit_day_status')
				.select('completed')
				.eq('user_id', viewerId)
				.eq('day', dateStr)
				.eq('completed', true);
			if (habitError) throw habitError;
			habitCompleted = (habitRows ?? []).length;

			const { data: dayRow, error: dayError } = await supabase
				.from('days')
				.select('id')
				.eq('user_id', viewerId)
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

	function handleCalendarHover(dateStr: string) {
		calendarHoverDate = dateStr;
	}

	function clearCalendarHover() {
		calendarHoverDate = null;
	}

	function handleCalendarSelect(dateStr: string) {
		calendarLockedDate = dateStr;
		calendarHoverDate = null;
		setCalendarMonthFromDate(dateStr);
		activeDayDateStore.set(dateStr);
	}

	function moveSelectedByDays(days: number) {
		const baseDate = calendarLockedDate ?? activeDayDate;
		handleCalendarSelect(addDaysToDateString(baseDate, days));
	}

	function moveSelectedByWeeks(weeks: number) {
		moveSelectedByDays(weeks * 7);
	}

	function moveSelectedByMonths(months: number) {
		const baseDate = calendarLockedDate ?? activeDayDate;
		handleCalendarSelect(addMonthsToDateString(baseDate, months));
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
		const nextOpen = !isGoalModalOpen;
		isGoalModalOpen = nextOpen;
		if (nextOpen) {
			heatmapOpen = false;
		} else {
			void saveAllGoals();
		}
	}

	function closeGoalModal() {
		isGoalModalOpen = false;
	}

	function resetNavG() {
		pendingNavG = false;
		if (navGTimeout !== null) {
			window.clearTimeout(navGTimeout);
			navGTimeout = null;
		}
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

	function handleGoalKeydown(goalKey: string, event: KeyboardEvent) {
		if (event.key !== 'Enter') return;
		event.preventDefault();
		void saveGoal(goalKey);
		(event.currentTarget as HTMLInputElement).blur();
	}

	async function saveGoal(goalKey: string) {
		const entry = goalsByKey[goalKey] ?? mergeGoal(goalKey);
		if (!entry.title.trim()) return;
		const dueDate = goalDueDateForKey(goalKey);
		savingGoals = { ...savingGoals, [goalKey]: true };
		try {
			const { data, error } = await supabase
				.from('goals')
				.upsert(
					{
						goal_key: goalKey,
						title: entry.title.trim(),
						due_date: dueDate,
						created_at: formatLocalTimestamp(new Date())
					},
					{ onConflict: 'goal_key' }
				)
				.select('id, title, goal_key, due_date')
				.single();
			if (error) throw error;
			if (data) {
				goalsByKey = {
					...goalsByKey,
					[goalKey]: {
						id: data.id as string,
						title: (data.title ?? '').trim(),
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
				.select('day_id, hour, half, title, status, category')
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
				const category = (row.category as string | null) ?? null;

				if (!dayId || Number.isNaN(hour)) continue;
				const key = dayToKey.get(dayId);
				if (!key) continue;
				if (!blockIsDue(hour, half, currentHour, currentHalf)) continue;
				if (category === 'bad') continue;
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
			const { data, error } = await supabase.from('goals').select('id, title, goal_key, due_date');
			if (error) throw error;
			const next: Record<string, GoalEntry> = {};
			for (const row of data ?? []) {
				const rawKey = (row.goal_key as string | null) ?? '';
				if (!rawKey) continue;
				const goalKey = normalizeGoalKey(rawKey);
				next[goalKey] = {
					id: row.id as string,
					title: (row.title ?? '').trim(),
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
			const { data: daysData, error: daysError } = await supabase
				.from('days')
				.select('id, date')
				.eq('user_id', userId)
				.gte('date', lookbackStart)
				.order('date', { ascending: true });
			if (daysError) throw daysError;
			const dayIdByDate = new Map<string, string>();
			for (const row of daysData ?? []) {
				const date = (row.date as string | null) ?? null;
				const id = (row.id as string | null) ?? null;
				if (!date || !id) continue;
				dayIdByDate.set(id, date);
			}

			const { data: habitData, error: habitError } = await supabase
				.from('habit_day_status')
				.select('day, completed')
				.eq('user_id', userId)
				.gte('day', lookbackStart);
			if (habitError) throw habitError;

			const habitCounts = new Map<string, number>();
			for (const row of habitData ?? []) {
				const day = (row.day as string | null) ?? null;
				if (!day || !row.completed) continue;
				habitCounts.set(day, (habitCounts.get(day) ?? 0) + 1);
			}

			const completedCounts = new Map<string, number>();
			if (dayIdByDate.size > 0) {
				const dayIds = Array.from(dayIdByDate.keys());
				const { data: hoursData, error: hoursError } = await supabase
					.from('hours')
					.select('day_id, status, title')
					.in('day_id', dayIds)
					.or('status.is.null,status.eq.true');
				if (hoursError) throw hoursError;

				for (const row of hoursData ?? []) {
					const dayId = (row.day_id as string | null) ?? null;
					const title = (row.title as string | null) ?? '';
					const status = row.status as boolean | null;
					if (!dayId) continue;
					if (title.trim().length === 0) continue;
					if (status === false) continue;
					completedCounts.set(dayId, (completedCounts.get(dayId) ?? 0) + 1);
				}
			}

			const next: Record<string, number> = {};
			for (const [dayId, date] of dayIdByDate.entries()) {
				const completed = (completedCounts.get(dayId) ?? 0) + (habitCounts.get(date) ?? 0);
				const pct = Math.max(
					0,
					Math.min(100, Math.round((completed / TOTAL_BLOCKS_PER_DAY) * 100))
				);
				next[date] = pct;
			}

			for (const [date, completed] of habitCounts.entries()) {
				if (next[date] !== undefined) continue;
				const pct = Math.max(
					0,
					Math.min(100, Math.round((completed / TOTAL_BLOCKS_PER_DAY) * 100))
				);
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
		let authSubscription: { unsubscribe: () => void } | null = null;
		let goalRotationInterval: number | null = null;
		const goalRotationIntervalMs = 10000;
		let lastGoalRotationAt = Date.now();

		const init = async () => {
			let authUser: User | null = null;
			try {
				const { data } = await supabase.auth.getUser();
				if (!mounted) return;
				authUser = data.user ?? null;
				applyAuthState(authUser);
			} catch {
				if (!mounted) return;
				applyAuthState(null);
				authUser = null;
			}
			if (!mounted) return;
			await loadGoals();
			await loadHeatmap(authUser?.id ?? null);
			await refreshTrackedPlayers();
		};

		void init();

		const { data } = supabase.auth.onAuthStateChange((_event, session) => {
			if (!mounted) return;
			const nextUser = session?.user ?? null;
			applyAuthState(nextUser);
			void loadGoals();
			void loadHeatmap(nextUser?.id ?? null);
			void refreshTrackedPlayers();
		});
		authSubscription = data.subscription;

		currentProgressInterval = window.setInterval(() => {
			void refreshCurrentCombined();
		}, CURRENT_PROGRESS_POLL_MS);

		const rotateGoal = () => {
			if (document.visibilityState !== 'visible') return;
			const now = Date.now();
			if (now - lastGoalRotationAt < goalRotationIntervalMs * 0.9) return;
			lastGoalRotationAt = now;
			const total = GOAL_ROTATION.length;
			if (total === 0) return;
			goalRotationIndex = (goalRotationIndex + 1) % total;
		};

		const startGoalRotation = () => {
			if (goalRotationInterval !== null) return;
			lastGoalRotationAt = Date.now();
			goalRotationInterval = window.setInterval(rotateGoal, goalRotationIntervalMs);
		};

		const stopGoalRotation = () => {
			if (goalRotationInterval === null) return;
			window.clearInterval(goalRotationInterval);
			goalRotationInterval = null;
		};

		const handleGoalVisibility = () => {
			if (document.visibilityState === 'visible') {
				startGoalRotation();
			} else {
				stopGoalRotation();
			}
		};

		handleGoalVisibility();
		document.addEventListener('visibilitychange', handleGoalVisibility);
		window.addEventListener('focus', handleGoalVisibility);
		window.addEventListener('blur', handleGoalVisibility);

		const handleKeyDown = (event: KeyboardEvent) => {
			const target = event.target as HTMLElement | null;
			if (target) {
				const tag = target.tagName?.toLowerCase();
				if (tag === 'input' || tag === 'textarea' || target.isContentEditable) return;
			}
			const normalized = event.key.toLowerCase();
			if (event.key === 'T') {
				activeDayDateStore.set(localToday());
				event.preventDefault();
				return;
			}
			if (!event.metaKey && !event.ctrlKey && !event.altKey) {
				if (normalized === 'g') {
					pendingNavG = true;
					if (navGTimeout !== null) window.clearTimeout(navGTimeout);
					navGTimeout = window.setTimeout(() => {
						pendingNavG = false;
						navGTimeout = null;
					}, 900);
					return;
				}
				if (pendingNavG && (normalized === 't' || normalized === 'm')) {
					if (normalized === 't') {
						const nextOpen = !heatmapOpen;
						heatmapOpen = nextOpen;
						if (nextOpen) {
							isGoalModalOpen = false;
							void loadHeatmap(viewerId);
						}
					} else {
						openGoalModal();
					}
					resetNavG();
					event.preventDefault();
					return;
				}
			}
			if (pendingNavG) resetNavG();
			if (event.key === 'Escape' && heatmapOpen) {
				heatmapOpen = false;
				return;
			}
			if (event.key === 'Escape' && isGoalModalOpen) {
				isGoalModalOpen = false;
				void saveAllGoals();
				return;
			}
			if (!heatmapOpen) return;
			let handled = true;
			switch (normalized) {
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
				case 'n':
					moveSelectedByMonths(1);
					break;
				case 'p':
					moveSelectedByMonths(-1);
					break;
				case 'enter':
					heatmapOpen = false;
					activeDayDateStore.set(calendarSelectedDate);
					break;
				default:
					handled = false;
			}
			if (handled) {
				event.preventDefault();
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
			document.removeEventListener('visibilitychange', handleGoalVisibility);
			window.removeEventListener('focus', handleGoalVisibility);
			window.removeEventListener('blur', handleGoalVisibility);
			stopGoalRotation();
			authSubscription?.unsubscribe();
		};
	});
	$inspect(authSet);
	$inspect($session.user);
	$inspect(currentCombinedPct);
	$inspect(presenceCounts.connected);

	let { children, suppressSpectator = false, desktopMode = false } = $props();
</script>

<svelte:head>
	<link rel="icon" href="/fz.svg" type="image/svg+xml" />
	<title>founders zoo.</title>
	<meta name="application-name" content="founders zoo." />
</svelte:head>

{#if authSet == null}
	<div></div>
{:else if !authSet && !suppressSpectator}
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
{:else if authSet && $session.user}
	<div in:fly={{ y: 2, duration: 200, delay: 100 }}>
		<OnlineCount dedupe={false} counts={presenceCounts} />
		<div
			class="pointer-events-none fixed top-4 left-4 z-50 flex flex-col items-start"
			bind:this={dateMenuEl}
		>
			<div class="pointer-events-auto relative flex items-center">
				<button
					type="button"
					class="rounded-sm p-2 text-stone-500 transition hover:bg-stone-300/50"
					aria-label="Toggle timeline"
					onclick={() => {
						const nextOpen = !heatmapOpen;
						heatmapOpen = nextOpen;
						if (nextOpen) {
							isGoalModalOpen = false;
							void loadHeatmap(viewerId);
						}
					}}
				>
					<svg
						xmlns="http://www.w3.org/2000/svg"
						width="10"
						height="10"
						fill="currentColor"
						class="bi bi-calendar-fill"
						viewBox="0 0 16 16"
					>
						<path
							d="M3.5 0a.5.5 0 0 1 .5.5V1h8V.5a.5.5 0 0 1 1 0V1h1a2 2 0 0 1 2 2v11a2 2 0 0 1-2 2H2a2 2 0 0 1-2-2V5h16V4H0V3a2 2 0 0 1 2-2h1V.5a.5.5 0 0 1 .5-.5"
						/>
					</svg>
				</button>
				<div class="flex items-center">
					<button
						type="button"
						class="flex w-22 items-center justify-center gap-2 rounded-sm px-2 py-1 text-xs font-medium text-stone-700 transition hover:bg-stone-200/50"
						disabled={isActiveDayToday}
						onclick={() => {
							activeDayDateStore.set(localToday());
						}}
						aria-label="Jump to today"
					>
						<span>{activeDayLabel}</span>
					</button>
					<div class="flex items-center">
						<button
							type="button"
							class="flex h-6 w-6 items-center justify-center rounded-md text-xs text-stone-600 hover:bg-stone-100"
							aria-label="Previous day"
							onclick={() => activeDayDateStore.set(addDaysToDateString(activeDayDate, -1))}
						>
							<svg
								xmlns="http://www.w3.org/2000/svg"
								width="10"
								height="10"
								fill="currentColor"
								class="bi bi-chevron-left"
								viewBox="0 0 16 16"
							>
								<path
									fill-rule="evenodd"
									d="M11.354 1.646a.5.5 0 0 1 0 .708L5.707 8l5.647 5.646a.5.5 0 0 1-.708.708l-6-6a.5.5 0 0 1 0-.708l6-6a.5.5 0 0 1 .708 0"
								/>
							</svg>
						</button>
						<button
							type="button"
							class="flex h-6 w-6 items-center justify-center rounded-md text-xs text-stone-600 hover:bg-stone-100"
							aria-label="Next day"
							onclick={() => activeDayDateStore.set(addDaysToDateString(activeDayDate, 1))}
						>
							<svg
								xmlns="http://www.w3.org/2000/svg"
								width="10"
								height="10"
								fill="currentColor"
								class="bi bi-chevron-right"
								viewBox="0 0 16 16"
							>
								<path
									fill-rule="evenodd"
									d="M4.646 1.646a.5.5 0 0 1 .708 0l6 6a.5.5 0 0 1 0 .708l-6 6a.5.5 0 0 1-.708-.708L10.293 8 4.646 2.354a.5.5 0 0 1 0-.708"
								/>
							</svg>
						</button>
					</div>
				</div>
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
								{currentGoalEntry.title || 'Milestone'}
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
	<div class="min-h-screen bg-white text-stone-800">
		<div class="mx-auto flex h-full w-full max-w-[1200px] flex-col pt-16">
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
								placeholder="Year milestone"
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
											placeholder={`${quarter.label} milestone`}
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
														placeholder={`${month.label} milestone`}
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
																placeholder={`${week.label} milestone`}
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
	<div class="min-h-screen text-stone-800">
		<div class="mx-auto flex h-full w-full max-w-[1200px] flex-col pt-16">
			<div class="flex min-h-[calc(100vh-64px)] flex-1 gap-0 overflow-y-auto px-6 py-2">
				<div
					class="relative z-30 flex min-w-0 flex-[2] flex-col gap-6 overflow-x-hidden pr-6"
					onwheel={handleHeatmapWheel}
				>
					<div class="flex w-full flex-col gap-6">
						<div
							class="flex w-full justify-center overflow-x-auto overflow-y-visible rounded-2xl p-2"
							bind:this={heatmapScrollEl}
						>
							<div class="mx-auto flex min-w-max items-start justify-start gap-2">
								<div class="flex flex-col gap-1 pt-[20px] text-[9px] text-stone-400">
									<div class="h-2.5"></div>
									<div class="h-2.5 leading-none">M</div>
									<div class="h-2.5"></div>
									<div class="h-2.5 leading-none">W</div>
									<div class="h-2.5"></div>
									<div class="h-2.5 leading-none">F</div>
									<div class="h-2.5"></div>
								</div>
								<div class="flex flex-col gap-2">
									<div class="flex h-2.5 items-center gap-0.5 text-[9px] leading-3 text-stone-400">
										{#each heatmapMonthLabels as label}
											<div class="w-2.5 text-center">{label}</div>
										{/each}
									</div>
									<div class="relative overflow-visible">
										<div class="flex gap-0.5">
											{#each heatmapWeeks as week, weekIndex}
												<div class="flex flex-col gap-0.5">
													{#each week.days as day}
														{@const dateKey = formatDateString(day)}
														<button
															type="button"
															class={`group relative h-2.5 w-2.5 rounded-xs transition-colors transition-opacity duration-300 ${
																heatmapLoading
																	? 'bg-stone-200'
																	: heatmapColorClass(heatmapByDate[dateKey] ?? 0)
															} ${!heatmapLoading && !heatmapAnimated ? 'opacity-0' : ''} ${
																dateKey === calendarSelectedDate
																	? 'ring-2 ring-stone-400 ring-offset-1 ring-offset-white'
																	: ''
															}`}
															style={`transition-delay: ${heatmapLoading ? 0 : weekIndex * 40}ms`}
															disabled={heatmapLoading}
															onclick={() => handleCalendarSelect(dateKey)}
															onmouseenter={(event) =>
																showHeatmapTooltip(event, heatmapDateLabel(dateKey))}
															onmousemove={moveHeatmapTooltip}
															onmouseleave={hideHeatmapTooltip}
														>
														</button>
													{/each}
												</div>
											{/each}
										</div>
										{#if heatmapLoading}
											<div class="heatmap-sheen pointer-events-none absolute inset-0"></div>
										{/if}
									</div>
								</div>
							</div>
						</div>
						{#if heatmapTooltip.visible}
							<div
								class="pointer-events-none fixed z-[9999] rounded-md bg-stone-700 px-2 py-1 text-xs font-medium whitespace-nowrap text-white shadow-lg"
								style={`left: ${heatmapTooltip.x}px; top: ${heatmapTooltip.y}px; transform: translate(-50%, -100%);`}
							>
								{heatmapTooltip.text}
							</div>
						{/if}
					</div>
					<div class="grid w-full gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
						<div class="rounded-2xl border border-stone-200 bg-white p-4">
							<div class="flex items-center justify-between">
								<div class="text-sm font-semibold text-stone-900">{calendarMonthLabel}</div>
								<div class="flex items-center gap-1">
									<button
										type="button"
										class="flex h-6 w-6 items-center justify-center rounded-md text-xs text-stone-600 hover:bg-stone-100"
										aria-label="Previous month"
										onclick={() => moveSelectedByMonths(-1)}
									>
										<svg
											xmlns="http://www.w3.org/2000/svg"
											width="14"
											height="14"
											fill="currentColor"
											class="bi bi-chevron-up"
											viewBox="0 0 16 16"
										>
											<path
												fill-rule="evenodd"
												d="M7.646 4.646a.5.5 0 0 1 .708 0l6 6a.5.5 0 0 1-.708.708L8 5.707 1.646 11.354a.5.5 0 0 1-.708-.708l6-6z"
											/>
										</svg>
									</button>
									<button
										type="button"
										class="flex h-6 w-6 items-center justify-center rounded-md text-xs text-stone-600 hover:bg-stone-100"
										aria-label="Next month"
										onclick={() => moveSelectedByMonths(1)}
									>
										<svg
											xmlns="http://www.w3.org/2000/svg"
											width="14"
											height="14"
											fill="currentColor"
											class="bi bi-chevron-down"
											viewBox="0 0 16 16"
										>
											<path
												fill-rule="evenodd"
												d="M1.646 4.646a.5.5 0 0 1 .708 0L8 10.293l5.646-5.647a.5.5 0 0 1 .708.708l-6 6a.5.5 0 0 1-.708 0l-6-6a.5.5 0 0 1 0-.708"
											/>
										</svg>
									</button>
								</div>
							</div>
							<div class="mt-4 grid grid-cols-[32px_repeat(7,minmax(0,1fr))] gap-1 text-xs">
								<div
									class="flex h-8 items-center justify-center text-[10px] font-semibold text-stone-400"
								>
									W
								</div>
								{#each CALENDAR_WEEKDAYS as label}
									<div
										class="flex h-8 items-center justify-center text-[10px] font-semibold text-stone-400"
									>
										{label}
									</div>
								{/each}
								{#each calendarWeeks as week, weekIndex}
									<div
										class="flex h-9 items-center justify-center text-[10px] font-semibold text-stone-400"
									>
										{weekIndex + 1}
									</div>
									{#each week as day}
										{@const dateKey = formatDateString(day)}
										{@const isCurrentMonth = day.getMonth() === calendarMonthIndex}
										{@const isSelected = dateKey === calendarSelectedDate}
										{@const isHovered = dateKey === calendarHoverDate}
										{@const isToday = dateKey === localToday()}
										<button
											type="button"
											class={`group flex h-9 w-full flex-col items-center justify-center rounded-md border border-transparent text-xs transition ${
												isSelected
													? 'bg-stone-900 text-white'
													: isHovered
														? 'bg-stone-100'
														: 'hover:bg-stone-100'
											} ${
												isSelected ? '' : isCurrentMonth ? 'text-stone-800' : 'text-stone-400'
											} ${!isSelected && isToday ? 'ring-1 ring-stone-300' : ''}`}
											onclick={() => handleCalendarSelect(dateKey)}
										>
											<span class="leading-none">{day.getDate()}</span>
											<span
												class={`mt-1 h-1 w-1 rounded-full ${heatmapColorClass(heatmapByDate[dateKey] ?? 0)}`}
											></span>
										</button>
									{/each}
								{/each}
							</div>
						</div>
						<div class="rounded-2xl border border-stone-200 bg-white p-4">
							<div class="flex items-start justify-between">
								<div>
									<div class="mt-1 text-sm font-medium text-stone-900">
										{calendarSummaryLabel ?? '—'}
									</div>
								</div>
								<div class="flex flex-col items-end gap-2">
									<div
										class={`flex items-center justify-center rounded-md p-2 text-xs font-medium text-white ${summaryScoreColor(
											calendarSummary?.score ?? 0
										)}`}
									>
										{calendarSummary?.score ?? 0}
									</div>
								</div>
							</div>
							{#if calendarSummaryLoading}
								<div class="mt-4 text-xs text-stone-400">Loading summary...</div>
							{:else}
								<div class="mt-4 space-y-2 text-sm text-stone-700">
									<div class="flex items-center justify-between">
										<span>Tasks planned</span>
										<span class="font-semibold text-stone-900">
											{calendarSummary?.planned ?? 0}
										</span>
									</div>
									<div class="flex items-center justify-between">
										<span>Tasks completed</span>
										<span class="font-semibold text-stone-900">
											{calendarSummary?.completed ?? 0}
										</span>
									</div>
									<div class="flex items-center justify-between">
										<span>Productive hours</span>
										<span class="font-semibold text-stone-900">
											{formatProductiveHours(calendarSummary?.productiveHours ?? 0)}
										</span>
									</div>
								</div>
								<div class="mt-4">
									<div class="mt-3 flex justify-between gap-2">
										<div class="flex items-center justify-center">
											<div
												class="summary-pie h-30 w-30 rounded-full"
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
																	aria-hidden="true"
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
																	aria-hidden="true"
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
																	aria-hidden="true"
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
																	aria-hidden="true"
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
																	aria-hidden="true"
																>
																	<path
																		d="M16 8A8 8 0 1 1 0 8a8 8 0 0 1 16 0M5.354 4.646a.5.5 0 1 0-.708.708L7.293 8l-2.647 2.646a.5.5 0 0 0 .708.708L8 8.707l2.646 2.647a.5.5 0 0 0 .708-.708L8.707 8l2.647-2.646a.5.5 0 0 0-.708-.708L8 7.293z"
																	/>
																</svg>
															{/if}
														</span>
														<span>{category.label}</span>
													</div>
													<span class="font-semibold text-stone-900">
														{formatProductiveHours(category.hours)}h
													</span>
												</div>
											{/each}
										</div>
									</div>
								</div>
							{/if}
						</div>
					</div>
				</div>
				<div
					class="relative z-0 flex min-h-full min-w-0 flex-[0.8] flex-col gap-4 border-l border-stone-100 pl-6"
				>
					<div class="text-base font-medium text-stone-800">Upcoming</div>
					<div class="space-y-3">
						{#each UPCOMING_EVENTS as event}
							<div class="flex flex-row justify-between rounded-xl bg-stone-50 p-4">
								<div class="text-xs font-medium text-stone-800">{event.title}</div>
								<div class="text-xs text-stone-500">
									{formatDisplayDate(event.date, {
										month: 'short',
										day: 'numeric',
										year: 'numeric'
									})}
								</div>
							</div>
						{/each}
					</div>
				</div>
			</div>
		</div>
	</div>
{/if}

{#if desktopMode}
	{#if authSet && $session.user}
		{#if !heatmapOpen && !isGoalModalOpen}
			{@render children()}
		{/if}
	{:else}
		<GrogathLogin />
	{/if}
{:else if !heatmapOpen && !isGoalModalOpen}
	{@render children()}
{/if}

<style>
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

	.heatmap-sheen {
		overflow: hidden;
	}

	.heatmap-sheen::after {
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
