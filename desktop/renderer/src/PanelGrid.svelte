<script lang="ts">
	import { onDestroy, onMount } from 'svelte';
	import Block from '$lib/components/Block.svelte';
	import { supabase } from '$lib/supabaseClient';

	type BlockValue = {
		title: string;
		status: boolean | null;
		category: string | null;
	};

	type BlockRow = {
		first: BlockValue;
		second: BlockValue;
	};

	const START_HOUR = 6;
	const END_HOUR = START_HOUR + 16;
	const hours = Array.from({ length: END_HOUR - START_HOUR }, (_, i) => START_HOUR + i);
	const hh = (n: number) => n.toString().padStart(2, '0');
	const blockTimeLabel = (hour: number, half: 0 | 1) => `${hh(hour)}:${half === 0 ? '00' : '30'}`;

	const formatDateString = (date: Date) =>
		`${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(
			date.getDate()
		).padStart(2, '0')}`;
	const localToday = () => formatDateString(new Date());

	const createEmptyBlock = (): BlockValue => ({ title: '', status: null, category: null });

	let rowsByHour: Record<number, BlockRow> = {};
	let viewerUserId: string | null = null;
	let dayId: string | null = null;
	let selectedIndex = 0;
	let currentHour = new Date().getHours();
	let currentHalf: 0 | 1 = new Date().getMinutes() < 30 ? 0 : 1;
	let clockTimer: number | null = null;
	let authUnsub: (() => void) | null = null;

	const blockIndex = (hour: number, half: 0 | 1) => (hour - START_HOUR) * 2 + half;
	const indexToBlock = (index: number) => {
		const hourIndex = Math.floor(index / 2);
		const half = (index % 2) as 0 | 1;
		const hour = hours[hourIndex];
		return { hour, half };
	};

	const getRow = (hour: number) => rowsByHour[hour] ?? { first: createEmptyBlock(), second: createEmptyBlock() };
	const getBlockValue = (hour: number, half: 0 | 1) => {
		const row = getRow(hour);
		return half === 0 ? row.first : row.second;
	};

	const setBlockValue = (hour: number, half: 0 | 1, next: BlockValue) => {
		const row = getRow(hour);
		rowsByHour = {
			...rowsByHour,
			[hour]: half === 0 ? { ...row, first: next } : { ...row, second: next }
		};
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

	const loadHoursForDay = async (user_id: string, day_id: string) => {
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
				status: (r.status as boolean | null) ?? null,
				category: (r.category as string | null) ?? null
			};
			next[h] ??= { first: createEmptyBlock(), second: createEmptyBlock() };
			if (half01 === 0) next[h].first = blockValue;
			else next[h].second = blockValue;
		}
		rowsByHour = next;
		const idx = blockIndex(
			Math.min(Math.max(currentHour, START_HOUR), END_HOUR - 1),
			currentHalf
		);
		selectedIndex = Math.max(0, Math.min(hours.length * 2 - 1, idx));
	};

	const loadPanelData = async () => {
		const { data: userData } = await supabase.auth.getUser();
		viewerUserId = userData.user?.id ?? null;
		if (!viewerUserId) {
			const { data } = await supabase.auth.getSession();
			viewerUserId = data.session?.user?.id ?? null;
		}
		if (!viewerUserId) {
			rowsByHour = {};
			return;
		}
		const dateStr = localToday();
		dayId = await getDayIdForUser(viewerUserId, dateStr, true);
		if (!dayId) {
			rowsByHour = {};
			return;
		}
		await loadHoursForDay(viewerUserId, dayId);
	};

	const moveSelection = (delta: number) => {
		const total = hours.length * 2;
		selectedIndex = Math.max(0, Math.min(total - 1, selectedIndex + delta));
	};

	const cycleStatus = async (hour: number, half: 0 | 1) => {
		if (!dayId) return;
		const block = getBlockValue(hour, half);
		const title = block.title.trim();
		if (!title) return;
		const nextStatus = block.status === null ? false : block.status === false ? true : null;

		const total = hours.length * 2;
		const startIndex = blockIndex(hour, half);
		const matches = (index: number) => {
			const { hour: h, half: hf } = indexToBlock(index);
			if (h === undefined) return false;
			return getBlockValue(h, hf).title.trim() === title;
		};
		let first = startIndex;
		while (first - 1 >= 0 && matches(first - 1)) first -= 1;
		let last = startIndex;
		while (last + 1 < total && matches(last + 1)) last += 1;

		const payload = [] as {
			day_id: string;
			hour: number;
			half: boolean;
			title: string;
			status: boolean | null;
			category: string | null;
		}[];

		for (let idx = first; idx <= last; idx += 1) {
			const { hour: h, half: hf } = indexToBlock(idx);
			if (h === undefined) continue;
			const value = getBlockValue(h, hf);
			if (value.title.trim() !== title) continue;
			setBlockValue(h, hf, { ...value, status: nextStatus });
			payload.push({
				day_id: dayId,
				hour: h,
				half: hf === 1,
				title: value.title,
				status: nextStatus,
				category: value.category ?? null
			});
		}

		if (payload.length === 0) return;
		const { error } = await supabase.from('hours').upsert(payload, {
			onConflict: 'day_id,hour,half'
		});
		if (error) {
			console.error('panel grid cycle status error', error);
		}
	};

	const handleKeydown = (event: KeyboardEvent) => {
		if (
			(event.metaKey && event.key.toLowerCase() === 'k') ||
			(event.ctrlKey && event.key.toLowerCase() === 'k')
		) {
			event.preventDefault();
			event.stopPropagation();
			return;
		}
		if (event.key === 'j') {
			event.preventDefault();
			moveSelection(1);
		} else if (event.key === 'k') {
			event.preventDefault();
			moveSelection(-1);
		} else if (event.key === 'Enter') {
			event.preventDefault();
			const { hour, half } = indexToBlock(selectedIndex);
			if (hour !== undefined) void cycleStatus(hour, half);
		}
	};

	const updateCurrentTime = () => {
		const now = new Date();
		currentHour = now.getHours();
		currentHalf = now.getMinutes() < 30 ? 0 : 1;
	};

	onMount(() => {
		document.body.classList.add('panel-mode');
		void loadPanelData();
		const { data } = supabase.auth.onAuthStateChange(() => {
			void loadPanelData();
		});
		authUnsub = data.subscription.unsubscribe;
		updateCurrentTime();
		clockTimer = window.setInterval(updateCurrentTime, 60_000);
		return () => {
			if (clockTimer !== null) window.clearInterval(clockTimer);
			document.body.classList.remove('panel-mode');
			authUnsub?.();
		};
	});

	onDestroy(() => {
		if (clockTimer !== null) window.clearInterval(clockTimer);
		document.body.classList.remove('panel-mode');
		authUnsub?.();
	});
</script>

<svelte:window on:keydown={handleKeydown} />

<div class="panel-grid">
	<div class="panel-dragbar"></div>
	<div class="panel-grid-content">
		{#each hours as hour, hourIndex}
			<div class="panel-grid-row">
				<div class="panel-grid-time">{hh(hour)}</div>
				<div class="panel-grid-blocks">
					{#each [0, 1] as half}
						{@const half01 = half as 0 | 1}
						{@const idx = hourIndex * 2 + half01}
						{@const value = getBlockValue(hour, half01)}
						<Block
							title={value.title}
							status={value.status}
							category={value.category}
							editable
							selected={idx === selectedIndex}
							isCurrent={hour === currentHour && half01 === currentHalf}
							onSelect={() => {
								selectedIndex = idx;
							}}
							onCycleStatus={() => void cycleStatus(hour, half01)}
						/>
					{/each}
				</div>
			</div>
		{/each}
	</div>
</div>
