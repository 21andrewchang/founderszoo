<script lang="ts">
	import OnlineCount from '$lib/components/OnlineCount.svelte';
	import { onMount, setContext } from 'svelte';
	import { fly, blur } from 'svelte/transition';
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
	type Goal = { title: string; due_date: string };
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

	// session + auth context
	const session: Writable<Session> = writable({ user: null, name: '', loading: true });
	setContext('session', session);

	const authSetStore: Writable<boolean | null> = writable(null);
	setContext('authSet', authSetStore);

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
			activeGoal = null;
			newGoalTitle = '';
			newGoalDueDate = '';
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
	let activeGoal = $state<Goal | null>(null);
	let newGoalTitle = $state('');
	let newGoalDueDate = $state('');
	let isCreatingGoal = $state(false);

	const formatDateString = (date: Date) =>
		`${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(
			date.getDate()
		).padStart(2, '0')}`;
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
	const todayLabel = formatDisplayDate(localToday());
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

	async function handleCreateGoal(event?: Event) {
		event?.preventDefault();
		if (!viewerId) return;
		const title = newGoalTitle.trim();
		if (!title || !newGoalDueDate) return;
		isCreatingGoal = true;
		try {
			const { data, error } = await supabase
				.from('goals')
				.insert({
					user_id: viewerId,
					title,
					due_date: newGoalDueDate,
					created_at: formatLocalTimestamp(new Date())
				})
				.select('title, due_date')
				.single();
			if (error) throw error;
			activeGoal = {
				title: (data.title ?? title).trim(),
				due_date: data.due_date as string
			};
			newGoalTitle = '';
			newGoalDueDate = '';
		} catch (error) {
			console.error('goal create error', error);
		} finally {
			isCreatingGoal = false;
		}
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
				.select('day_id, hour, half, title, todo')
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
				const todo = row.todo as boolean | null;
				if (!dayId || Number.isNaN(hour)) continue;
				const key = dayToKey.get(dayId);
				if (!key) continue;
				if (!blockIsDue(hour, half, currentHour, currentHalf)) continue;
				const trimmed = title.trim();
				// todo === false means explicitly incomplete
				const isComplete = todo === false ? false : trimmed.length > 0 || todo === true;
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

	async function loadActiveGoal(userId: string | null) {
		if (!userId) {
			activeGoal = null;
			return;
		}
		try {
			const { data, error } = await supabase
				.from('goals')
				.select('title, due_date')
				.order('due_date', { ascending: true })
				.limit(1)
				.maybeSingle();
			if (error) {
				if (error.code === 'PGRST116') {
					activeGoal = null;
					return;
				}
				throw error;
			}
			activeGoal = data
				? { title: (data.title ?? '').trim(), due_date: data.due_date as string }
				: null;
		} catch (error) {
			console.error('goal load error', error);
			activeGoal = null;
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
			await loadActiveGoal(authUser?.id ?? null);
			await refreshTrackedPlayers();
		};

		void init();

		currentProgressInterval = window.setInterval(() => {
			void refreshCurrentCombined();
		}, CURRENT_PROGRESS_POLL_MS);

		const handleDocumentClick = (event: MouseEvent) => {
			if (!dayHistoryOpen || !dateMenuEl) return;
			if (!dateMenuEl.contains(event.target as Node)) {
				dayHistoryOpen = false;
			}
		};
		const handleKeyDown = (event: KeyboardEvent) => {
			if (event.key === 'Escape' && dayHistoryOpen) {
				dayHistoryOpen = false;
			}
		};
		document.addEventListener('click', handleDocumentClick);
		document.addEventListener('keydown', handleKeyDown);

		return () => {
			mounted = false;
			document.removeEventListener('click', handleDocumentClick);
			document.removeEventListener('keydown', handleKeyDown);
			if (currentProgressInterval !== null) {
				window.clearInterval(currentProgressInterval);
				currentProgressInterval = null;
			}
		};
	});

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
		<nav class="z-67 fixed pt-5 pb-5 h-15 left-0 flex w-full items-center justify-center bg-white selection:bg-stone-600 selection:text-stone-100 select-none" style="font-family: 'Cormorant Garamond', serif">
			<a
				href="/"
				class="absolute left-5 text-xl tracking-wide text-stone-700"
			>
				founders zoo.
			</a>

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
{:else if authSet && $session.user && currentCombinedPct && presenceCounts.connected}
	<div in:fly={{ y: 2, duration: 200, delay: 100 }}>
		<OnlineCount dedupe={false} counts={presenceCounts} />
		<div
			class="pointer-events-none fixed top-5 left-4 z-50 flex flex-col items-start"
			bind:this={dateMenuEl}
		>
			<div class="pointer-events-auto relative">
				<button
					type="button"
					class="flex w-23 items-center justify-center gap-2 rounded-sm px-1 text-xs text-stone-700 transition hover:bg-stone-200/50"
					onclick={() => {
						dayHistoryOpen = !dayHistoryOpen;
					}}
					aria-expanded={dayHistoryOpen}
				>
					<span>{todayLabel}</span>
					<div class="w-9 text-end text-xs font-semibold text-stone-800">
						{currentCombinedPct != null ? `${currentCombinedPct}%` : '—%'}
					</div>
				</button>
				{#if dayHistoryOpen}
					<div
						class="absolute top-full left-0 z-50 rounded-sm bg-white text-xs text-stone-700"
						role="dialog"
						aria-label="Previous days completion"
					>
						{#if dayHistoryRows.length === 0}
							<div class="text-sm text-stone-500">No recent history yet.</div>
						{:else}
							<div class="flex flex-col overflow-y-auto">
								{#each dayHistoryRows as row}
									{@const jointPct = combinedPercent(row.values)}
									<div
										class="flex w-23 items-center justify-center gap-2 rounded-sm text-xs text-stone-700 transition hover:bg-stone-200/50"
									>
										<span>
											{formatDisplayDate(row.date, {
												month: 'short',
												day: 'numeric'
											})}
										</span>
										<div class="w-9 text-end text-xs font-semibold text-stone-800">
											{jointPct ?? '—'}%
										</div>
									</div>
								{/each}
							</div>
						{/if}
					</div>
				{/if}
			</div>
		</div>
		{#if activeGoal}
			{@const daysRemaining = daysUntilDue(activeGoal.due_date)}
			{@const dueLabel = formatDaysUntilText(daysRemaining)}
			<div class="pointer-events-none fixed top-5 left-1/2 z-40 -translate-x-1/2">
				<div
					class="pointer-events-auto flex items-center gap-2 text-xs font-semibold tracking-wide text-stone-800 uppercase"
				>
					<span>{activeGoal.title || 'Goal'}</span>
					{#if dueLabel}
						<span class="text-xs font-semibold tracking-wide text-stone-500">
							{dueLabel}
						</span>
					{/if}
				</div>
			</div>
		{/if}
	</div>
{/if}

{@render children()}
