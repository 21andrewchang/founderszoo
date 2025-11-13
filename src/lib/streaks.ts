const DAY_MS = 86_400_000;
export const MAX_MISSES_FOR_POSITIVE = 2;

export type PlayerStreakKind = 'positive' | 'negative';
export type PlayerStreak = {
	kind: PlayerStreakKind;
	length: number;
	missesOnLatest: number;
};

export type DayCompletionSummary = {
	date: string;
	missingBlocks: number;
};

function parseDateToUtcMs(dateStr: string): number | null {
	const parts = dateStr.split('-');
	if (parts.length !== 3) return null;
	const [yearStr, monthStr, dayStr] = parts;
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
	return Date.UTC(year, month - 1, day);
}

function classifyDay(missingBlocks: number): PlayerStreakKind {
	return missingBlocks <= MAX_MISSES_FOR_POSITIVE ? 'positive' : 'negative';
}

export function calculateStreak(summaries: DayCompletionSummary[]): PlayerStreak | null {
	const normalized = summaries
		.map((summary) => {
			const utcMs = parseDateToUtcMs(summary.date);
			if (utcMs === null) return null;
			return { ...summary, utcMs };
		})
		.filter((entry): entry is DayCompletionSummary & { utcMs: number } => entry !== null)
		.sort((a, b) => b.utcMs - a.utcMs);

	if (normalized.length === 0) return null;

	const first = normalized[0];
	const targetKind = classifyDay(first.missingBlocks);
	let streakLength = 0;
	let previousUtcMs: number | null = null;

	for (const entry of normalized) {
		const currentKind = classifyDay(entry.missingBlocks);
		if (currentKind !== targetKind) break;

		if (previousUtcMs !== null) {
			const diffDays = (previousUtcMs - entry.utcMs) / DAY_MS;
			if (diffDays !== 1) break;
		}

		streakLength += 1;
		previousUtcMs = entry.utcMs;
	}

	return {
		kind: targetKind,
		length: streakLength,
		missesOnLatest: first.missingBlocks
	};
}
