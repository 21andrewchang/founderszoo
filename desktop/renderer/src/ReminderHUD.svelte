<script lang="ts">
	import { onDestroy, onMount } from 'svelte';
	import Block from '$lib/components/Block.svelte';
	import { supabase } from '$lib/supabaseClient';

	type GoalEntry = { id: string | null; title: string; goal_key: string; due_date: string | null };
	type BlockValue = { title: string; status: boolean | null; category: string | null };

	const START_HOUR = 8;
	const END_HOUR = 24;
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
	const MONTH_INDEX_BY_KEY = Object.fromEntries(
		MONTHS.map((label, index) => [label.toLowerCase(), index])
	);
	const MONTH_ABBR_BY_KEY = Object.fromEntries(
		MONTHS.map((label) => [label.toLowerCase().slice(0, 3), label.toLowerCase()])
	);

	let viewerUserId: string | null = null;
	let dayId: string | null = null;
	let goalTitle = 'Milestone';
	let currentBlock: BlockValue = { title: '', status: null, category: null };
	let blockTitle = '';
	let blockCategory: string | null = null;
	let currentHour = new Date().getHours();
	let currentHalf: 0 | 1 = new Date().getMinutes() < 30 ? 0 : 1;
	let progress = 0;
	let authUnsub: (() => void) | null = null;
	let timer: number | null = null;

	const formatDateString = (date: Date) =>
		`${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(
			date.getDate()
		).padStart(2, '0')}`;
	const localToday = () => formatDateString(new Date());
	const hh = (n: number) => n.toString().padStart(2, '0');
	const timeLabel = (hour: number, half: 0 | 1) =>
		`${String(hour).padStart(2, '0')}${half === 0 ? 'A' : 'B'}`;

	const normalizeGoalKey = (goalKey: string): string => {
		const trimmed = goalKey.trim().toLowerCase();
		if (!trimmed) return trimmed;
		if (MONTH_INDEX_BY_KEY[trimmed] !== undefined) return trimmed;
		const abbrMatch = MONTH_ABBR_BY_KEY[trimmed];
		if (abbrMatch) return abbrMatch;
		const weekMatch = trimmed.match(/^([a-z]{3,9})-?week(\d)$/);
		if (weekMatch) {
			const monthKey = weekMatch[1];
			const weekIndex = weekMatch[2];
			const fullMonth =
				MONTH_INDEX_BY_KEY[monthKey] !== undefined ? monthKey : MONTH_ABBR_BY_KEY[monthKey];
			if (fullMonth) return `${fullMonth}-week${weekIndex}`;
		}
		return trimmed;
	};

	const currentWeekKey = () => {
		const now = new Date();
		const monthKey = MONTHS[now.getMonth()]?.toLowerCase() ?? 'january';
		const weekIndex = Math.min(4, Math.max(1, Math.ceil(now.getDate() / 7)));
		return `${monthKey}-week${weekIndex}`;
	};

	const getDayIdForUser = async (
		user_id: string,
		dateStr: string,
		createIfMissing: boolean
	) => {
		const { data: found, error: findErr } = await supabase
			.from('days')
			.select('id')
			.eq('user_id', user_id)
			.eq('date', dateStr)
			.maybeSingle();
		if (findErr) throw findErr;
		if (found?.id) return found.id as string;
		if (!createIfMissing) return null;
		const createdAt = new Date().toISOString();
		const { data: created, error: insErr } = await supabase
			.from('days')
			.insert({ user_id, date: dateStr, created_at: createdAt })
			.select('id')
			.single();
		if (insErr) throw insErr;
		return created.id as string;
	};

	const loadGoal = async () => {
		try {
			const { data, error } = await supabase.from('goals').select('id, title, goal_key, due_date');
			if (error) throw error;
			const currentKey = currentWeekKey();
			for (const row of data ?? []) {
				const rawKey = (row.goal_key as string | null) ?? '';
				const goalKey = normalizeGoalKey(rawKey);
				if (goalKey !== currentKey) continue;
				const entry: GoalEntry = {
					id: row.id as string,
					title: (row.title ?? '').trim(),
					goal_key: goalKey,
					due_date: (row.due_date as string | null) ?? null
				};
				goalTitle = entry.title || 'Milestone';
				return;
			}
			goalTitle = 'Milestone';
		} catch (error) {
			console.error('hud load goal error', error);
			goalTitle = 'Milestone';
		}
	};

	const loadCurrentBlock = async () => {
		if (!viewerUserId || !dayId) return;
		const { data, error } = await supabase
			.from('hours')
			.select('hour, half, title, status, category')
			.eq('day_id', dayId)
			.eq('hour', currentHour)
			.eq('half', currentHalf === 1)
			.maybeSingle();
		if (error) {
			console.error('hud load block error', error);
			return;
		}
		currentBlock = {
			title: (data?.title ?? '').toString(),
			status: (data?.status as boolean | null) ?? null,
			category: (data?.category as string | null) ?? null
		};
		blockTitle = currentBlock.title.trim();
		blockCategory = currentBlock.category ?? null;
	};

	const updateClock = () => {
		const now = new Date();
		currentHour = now.getHours();
		currentHalf = now.getMinutes() < 30 ? 0 : 1;
		const minutesInto = (now.getMinutes() % 30) + now.getSeconds() / 60;
		progress = Math.max(0, Math.min(1, minutesInto / 30));
	};

	const loadUserAndData = async () => {
		const { data: userData } = await supabase.auth.getUser();
		viewerUserId = userData.user?.id ?? null;
		if (!viewerUserId) {
			const { data } = await supabase.auth.getSession();
			viewerUserId = data.session?.user?.id ?? null;
		}
		if (!viewerUserId) return;
		dayId = await getDayIdForUser(viewerUserId, localToday(), true);
		await Promise.all([loadGoal(), loadCurrentBlock()]);
	};

	const handleKeydown = (event: KeyboardEvent) => {
		if (
			(event.metaKey && event.key.toLowerCase() === 'k') ||
			(event.ctrlKey && event.key.toLowerCase() === 'k')
		) {
			event.preventDefault();
			event.stopPropagation();
		}
	};

	onMount(() => {
		document.documentElement.style.background = 'transparent';
		document.body.style.background = 'transparent';
		document.body.classList.add('panel-mode');
		void loadUserAndData();
		updateClock();
		timer = window.setInterval(() => {
			updateClock();
			void loadCurrentBlock();
		}, 1_000);
		const { data } = supabase.auth.onAuthStateChange(() => {
			void loadUserAndData();
		});
		authUnsub = data.subscription.unsubscribe;
		return () => {
			document.body.classList.remove('panel-mode');
			if (timer !== null) window.clearInterval(timer);
			authUnsub?.();
		};
	});

	onDestroy(() => {
		document.body.classList.remove('panel-mode');
		document.documentElement.style.background = '';
		document.body.style.background = '';
		if (timer !== null) window.clearInterval(timer);
		authUnsub?.();
	});
</script>

<svelte:window on:keydown={handleKeydown} />

<div class="h-full rounded-full bg-black/0 px-2 justify-center flex flex-col text-slate-900">
	<div class="mt-0 flex items-center gap-1">
		<!-- <div class="text-xs font-medium uppercase rounded-md text-stone-200 bg-stone-700 p-2"> -->
		<!-- 	{timeLabel(currentHour, currentHalf)} -->
		<!-- </div> -->
		<div class="relative flex-1 origin-left w-[300px]">
			<div
				class="pointer-events-none absolute inset-0 rounded-l-md rounded-r-none bg-black/10"
				style={`width: ${Math.max(0, Math.min(1, progress)) * 100}%`}
			/>
			<Block
				title={blockTitle || ''}
				status={currentBlock.status}
				category={blockCategory}
				showStatus={false}
				editable={false}
				isCurrent
			/>
		</div>
	</div>
</div>
