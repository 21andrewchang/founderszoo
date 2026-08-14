const DAY_MS = 86_400_000;
export const MIN_COMPLETION_FOR_STREAK = 0.75;

export type PlayerStreakKind = 'positive' | 'negative';
export type PlayerStreak = {
	kind: PlayerStreakKind;
	length: number;
	missesOnLatest: number;
};

export type DayCompletionSummary = {
	date: string;
	completionPct: number;
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

function qualifiesForStreak(completionPct: number): boolean {
	return completionPct >= MIN_COMPLETION_FOR_STREAK;
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
	if (!qualifiesForStreak(first.completionPct)) return null;

	let streakLength = 0;
	let previousUtcMs: number | null = null;

	for (const entry of normalized) {
		if (!qualifiesForStreak(entry.completionPct)) break;

		if (previousUtcMs !== null) {
			const diffDays = (previousUtcMs - entry.utcMs) / DAY_MS;
			if (diffDays !== 1) break;
		}

		streakLength += 1;
		previousUtcMs = entry.utcMs;
	}

	return {
		kind: 'positive',
		length: streakLength,
		missesOnLatest: 0
	};
}
