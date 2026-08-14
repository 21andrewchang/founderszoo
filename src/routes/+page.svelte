<script lang="ts">
	import Block from '$lib/components/Block.svelte';
	import PlayerStatusTag from '$lib/components/PlayerStatusTag.svelte';
	import { fly, scale } from 'svelte/transition';
	import { onDestroy, onMount } from 'svelte';
	import { supabase } from '$lib/supabaseClient';
	import { useGlobalPresence } from '$lib/presence';
	import { watchPlayerStatus, type PlayerStatus } from '$lib/playerPresence';
	import { fetchCompletionByDate } from '$lib/heatmap';
	import type { PlayerStreak } from '$lib/streaks';

	const START_HOUR = 6;
	const END_HOUR = START_HOUR + 16;
	const hours = Array.from({ length: END_HOUR - START_HOUR }, (_, i) => START_HOUR + i);
	const TOTAL_BLOCKS_PER_DAY = hours.length * 2;
	const COMPLETION_STREAK_LOOKBACK_DAYS = 365;
	const STREAK_TOP_BRACKET_PCT = 75;
	const profileLineDelay = 0.09;
	const hh = (n: number) => n.toString().padStart(2, '0');

	type BlockValue = { title: string; status: boolean | null; category: string | null };
	type BlockRow = { first: BlockValue; second: BlockValue };
	const createEmptyBlock = (): BlockValue => ({ title: '', status: null, category: null });

	const presenceStore = useGlobalPresence(null);

	let isLoading = $state(true);
	let showTimes = $state(false);
	let blocks = $state<Record<number, BlockRow>>({});
	let andrewStatus = $state<PlayerStatus>('offline');
	let andrewStreak = $state<PlayerStreak | null>(null);
	let currentHour = $state(-1);
	let currentHalf = $state<0 | 1>(0);

	let statusUnsub: (() => void) | null = null;
	let clockTimer: number | null = null;

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
	const addDaysToDateString = (dateStr: string, days: number) => {
		const [y, m, d] = dateStr.split('-').map(Number);
		const date = new Date(y, (m ?? 1) - 1, d ?? 1);
		date.setDate(date.getDate() + days);
		return formatDateString(date);
	};

	const isCurrent = (h: number) => h === currentHour;
	const getBlock = (h: number, half: 0 | 1): BlockValue => {
		const row = blocks[h];
		if (!row) return createEmptyBlock();
		return half === 0 ? row.first : row.second;
	};

	function updateCurrentTime() {
		const now = new Date();
		currentHour = now.getHours();
		currentHalf = now.getMinutes() < 30 ? 0 : 1;
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

	async function init() {
		try {
			const { data: rows, error: uerr } = await supabase
				.from('users')
				.select('id, display_name, username');
			if (uerr) throw uerr;
			const andrew =
				(rows ?? []).find((r) => (r.username as string | null) === 'andrew') ??
				(rows ?? []).find((r) =>
					['andrew', 'graves'].some((t) =>
						((r.display_name as string | null) ?? '').toLowerCase().includes(t)
					)
				) ??
				null;
			if (!andrew) return;
			const userId = andrew.id as string;

			const statusStore = watchPlayerStatus(userId);
			statusUnsub = statusStore.subscribe((status) => {
				andrewStatus = status;
			});

			const loadBlocks = async () => {
				const { data: day, error: dayErr } = await supabase
					.from('days')
					.select('id')
					.eq('user_id', userId)
					.eq('date', localToday())
					.maybeSingle();
				if (dayErr) throw dayErr;
				if (!day?.id) return;
				const { data, error } = await supabase
					.from('hours')
					.select('hour, half, title, status, category')
					.eq('day_id', day.id as string);
				if (error) throw error;
				const next: Record<number, BlockRow> = {};
				for (const r of data ?? []) {
					const h = r.hour as number;
					const half01 = (r.half ? 1 : 0) as 0 | 1;
					const value: BlockValue = {
						title: (r.title as string | null) ?? '',
						status: r.status as boolean | null,
						category: (r.category as string | null) ?? null
					};
					next[h] ??= { first: createEmptyBlock(), second: createEmptyBlock() };
					if (half01 === 0) next[h].first = value;
					else next[h].second = value;
				}
				blocks = next;
			};

			const loadStreak = async () => {
				const completionByDate = await fetchCompletionByDate(
					supabase,
					userId,
					dateStringNDaysAgo(COMPLETION_STREAK_LOOKBACK_DAYS),
					TOTAL_BLOCKS_PER_DAY
				);
				andrewStreak = computeBracketStreak(
					new Map<string, number>(Object.entries(completionByDate))
				);
			};

			await Promise.all([loadBlocks(), loadStreak()]);
		} catch (error) {
			console.error('landing init failed', error);
		} finally {
			isLoading = false;
		}
	}

	onMount(() => {
		updateCurrentTime();
		clockTimer = window.setInterval(updateCurrentTime, 30_000);
		void init();
		requestAnimationFrame(() => (showTimes = true));
	});

	onDestroy(() => {
		statusUnsub?.();
		if (clockTimer !== null) window.clearInterval(clockTimer);
	});
</script>

<nav
	class="fixed left-0 z-67 flex h-15 w-full items-center justify-center bg-white pt-5 pb-5 select-none selection:bg-stone-600 selection:text-stone-100"
	style="font-family: 'Cormorant Garamond', serif"
>
	<a href="/" class="absolute left-5 text-xl tracking-wide text-stone-700"> founders zoo. </a>

	<div class="absolute right-6 flex items-center gap-5 text-sm">
		<a
			href="/login"
			class="text-stone-400 transition-colors duration-200 ease-out hover:text-stone-800"
		>
			create account
		</a>
		<a
			href="/login"
			class="text-stone-700 transition-colors duration-200 ease-out hover:text-stone-900"
		>
			log in
		</a>
	</div>
</nav>

<div class="flex h-dvh w-full flex-row gap-16 overflow-clip bg-white p-10 pt-20 select-none">
	<div class="flex w-full flex-col pt-10">
		<div class="flex items-center gap-6">
			<div
				class="profile-line h-24 w-24 shrink-0 rounded-full bg-stone-200"
				style={`animation-delay: ${0 * profileLineDelay}s;`}
			></div>
			<div class="flex flex-col">
				<div
					class="profile-line flex items-center gap-3 text-xl"
					style={`animation-delay: ${1 * profileLineDelay}s;`}
				>
					<PlayerStatusTag label="Andrew" status={andrewStatus} streak={andrewStreak} />
					{#if $presenceStore.connected}
						<div class="group relative flex items-center" aria-label="Live spectator count">
							<span class="flex items-center gap-1 text-[12px] text-red-400">
								<svg
									viewBox="0 0 24 24"
									fill="currentColor"
									stroke="currentColor"
									stroke-width="2"
									stroke-linecap="round"
									stroke-linejoin="round"
									shape-rendering="geometricPrecision"
									class="h-2.5 w-2.5"
								>
									<path d="M20 21.5v-2.5a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2.5h16" />
									<circle cx="12" cy="7" r="4" />
								</svg>
								{$presenceStore.tabs}
							</span>
							<div
								role="tooltip"
								class="pointer-events-none absolute top-full left-0 mt-1 rounded-md bg-stone-700 px-2 py-1 text-xs font-medium whitespace-nowrap text-white opacity-0 shadow-lg transition-opacity duration-150 group-hover:opacity-100"
							>
								Live spectator count
							</div>
						</div>
					{/if}
				</div>
				<div
					class="profile-line text-xl text-stone-500"
					style={`animation-delay: ${2 * profileLineDelay}s;`}
				>
					building founderszoo
				</div>
				<div
					class="profile-line mt-2 flex items-center gap-4 text-stone-500"
					style={`animation-delay: ${3 * profileLineDelay}s;`}
				>
					<span>friends <span class="font-semibold text-stone-800">13</span></span>
					<span>followers <span class="font-semibold text-stone-800">100k</span></span>
				</div>
			</div>
		</div>
		<p
			class="profile-line mt-14 max-w-sm leading-relaxed text-stone-700"
			style={`animation-delay: ${4 * profileLineDelay}s;`}
		>
			hi, this is a short summary of who i am and stuff i did in the past that is important to who i
			am today
		</p>
	</div>

	<div class="flex w-full max-w-2xl flex-col justify-center">
		<div class="flex flex-row space-x-4">
			{#if isLoading}
				<div class="flex flex-col space-y-1">
					{#each hours as h (h)}
						<div class="relative flex h-7 w-7 items-center justify-center"></div>
					{/each}
				</div>
			{:else}
				<div class="flex flex-col space-y-1">
					{#each hours as h, i (h)}
						<div class="relative flex h-7 w-7 items-center justify-center">
							{#if showTimes}
								<div
									class="z-20 flex h-7 items-center justify-center rounded px-1 text-stone-300"
									in:fly|global={{ x: 8, duration: 400, delay: 40 * i + 600 }}
								>
									{hh(h)}
								</div>
							{/if}
							{#if isCurrent(h)}
								<div
									class="absolute h-7 w-7 rounded-md bg-stone-700"
									in:scale|global={{ start: 0.6, duration: 100, delay: 1400 }}
								></div>
							{/if}
						</div>
					{/each}
				</div>
			{/if}

			<div class="flex w-full flex-col space-y-1">
				{#if isLoading}
					{#each hours as h (h)}
						<div class="flex h-7 w-full flex-row space-x-1" aria-hidden="true">
							<div class="loading-slot flex w-full rounded-md bg-stone-100"></div>
							<div class="loading-slot flex w-full rounded-md bg-stone-100"></div>
						</div>
					{/each}
				{:else}
					{#each hours as h (h)}
						{@const first = getBlock(h, 0)}
						{@const second = getBlock(h, 1)}
						<div class="flex h-7 w-full flex-row space-x-1">
							<div class="flex w-full min-w-0">
								<Block
									title={first.title}
									status={first.status}
									category={first.category}
									editable={false}
									isCurrent={currentHour === h && currentHalf === 0}
								/>
							</div>
							<div class="flex w-full min-w-0">
								<Block
									title={second.title}
									status={second.status}
									category={second.category}
									editable={false}
									isCurrent={currentHour === h && currentHalf === 1}
								/>
							</div>
						</div>
					{/each}
				{/if}
			</div>
		</div>
	</div>
</div>

<style>
	.profile-line {
		opacity: 0;
		transform: translateY(0.5rem);
		animation-name: profile-fade-up;
		animation-duration: 0.6s;
		animation-timing-function: cubic-bezier(0.235, 0.51, 0.355, 1);
		animation-fill-mode: forwards;
	}

	@keyframes profile-fade-up {
		from {
			opacity: 0;
			transform: translateY(0.5rem);
		}
		to {
			opacity: 1;
			transform: translateY(0);
		}
	}

	.loading-slot {
		position: relative;
		overflow: hidden;
	}

	.loading-slot::after {
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
