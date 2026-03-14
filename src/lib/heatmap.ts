import type { SupabaseClient } from '@supabase/supabase-js';

export type CompletionByDate = Record<string, number>;

export async function fetchCompletionByDate(
	supabase: SupabaseClient,
	userId: string,
	lookbackStart: string,
	totalBlocksPerDay: number,
	batchSize = 25
): Promise<CompletionByDate> {
	if (!userId) return {};

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
		for (let i = 0; i < dayIds.length; i += batchSize) {
			const batch = dayIds.slice(i, i + batchSize);
			const { data: hoursData, error: hoursError } = await supabase
				.from('hours')
				.select('day_id, status, title')
				.in('day_id', batch);
			if (hoursError) throw hoursError;

			for (const row of hoursData ?? []) {
				const dayId = (row.day_id as string | null) ?? null;
				const title = (row.title as string | null) ?? '';
				const status = row.status as boolean | null;
				if (!dayId) continue;
				const isComplete = title.trim().length > 0 && status !== false;
				if (!isComplete) continue;
				completedCounts.set(dayId, (completedCounts.get(dayId) ?? 0) + 1);
			}
		}
	}

	const next: CompletionByDate = {};
	for (const [dayId, date] of dayIdByDate.entries()) {
		const completed = (completedCounts.get(dayId) ?? 0) + (habitCounts.get(date) ?? 0);
		const pct = Math.max(0, Math.min(100, Math.round((completed / totalBlocksPerDay) * 100)));
		next[date] = pct;
	}

	for (const [date, completed] of habitCounts.entries()) {
		if (next[date] !== undefined) continue;
		const pct = Math.max(0, Math.min(100, Math.round((completed / totalBlocksPerDay) * 100)));
		next[date] = pct;
	}

	return next;
}
