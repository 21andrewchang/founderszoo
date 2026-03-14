import { writable } from 'svelte/store';

export type HeatmapState = {
	userId: string | null;
	byDate: Record<string, number>;
	loading: boolean;
};

export const heatmapStore = writable<HeatmapState>({
	userId: null,
	byDate: {},
	loading: false
});
