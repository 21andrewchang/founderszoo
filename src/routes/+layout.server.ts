import { createServerClient } from '@supabase/ssr';
import { PUBLIC_SUPABASE_ANON_KEY, PUBLIC_SUPABASE_URL } from '$env/static/public';
import type { Cookies } from '@sveltejs/kit';
import { fetchCompletionByDate } from '$lib/heatmap';

const HEATMAP_LOOKBACK_DAYS = 365;
const TOTAL_BLOCKS_PER_DAY = 32;

const formatDateString = (date: Date) =>
	`${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(
		date.getDate()
	).padStart(2, '0')}`;

const dateStringNDaysAgo = (days: number) => {
	const d = new Date();
	d.setDate(d.getDate() - days);
	return formatDateString(d);
};

export const load = async ({ cookies }: { cookies: Cookies }) => {
	const supabase = createServerClient(PUBLIC_SUPABASE_URL, PUBLIC_SUPABASE_ANON_KEY, {
		cookies: {
			get: (key) => cookies.get(key),
			set: (key, value, options) => {
				cookies.set(key, value, options as any);
			},
			remove: (key, options) => {
				cookies.delete(key, options as any);
			}
		}
	});

	const {
		data: { user }
	} = await supabase.auth.getUser();

	if (!user) {
		return {
			heatmapByDate: null,
			heatmapUserId: null
		};
	}

	const lookbackStart = dateStringNDaysAgo(HEATMAP_LOOKBACK_DAYS);
	const heatmapByDate = await fetchCompletionByDate(
		supabase,
		user.id,
		lookbackStart,
		TOTAL_BLOCKS_PER_DAY
	);

	return {
		heatmapByDate,
		heatmapUserId: user.id
	};
};
